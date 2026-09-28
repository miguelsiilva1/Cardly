import { getServerByName, routePartykitRequest, Server, type Connection } from "partyserver";
import { CLOSE_KICKED, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type CreateRoomResponse, type ServerMessage } from "@cardly/protocol";
import type { sueca } from "@cardly/engine";
import { allowedOrigins, MAX_CONNECTIONS, roomRequestAllowed } from "./gate";
import { parseClientMessage } from "./parse";
import { recordMatch, verifyAccessToken, type SupabaseEnv } from "./supabase";
import {
  createRoom,
  handleAlarm,
  handleMessage,
  isExpired,
  isIdle,
  nextAlarmAt,
  stateFor,
  type Deps,
  type Outcome,
  type RoomState,
} from "./room";

export interface Env extends SupabaseEnv {
  Room: DurableObjectNamespace<RoomServer>;
  /** Comma-separated list of web origins allowed to create and open rooms. */
  ALLOWED_ORIGINS: string;
  /** Room creations per client IP. */
  CREATE_LIMITER: RateLimit;
}

interface ConnState {
  playerId: string;
}

/** Unbiased random float in [0, 1) from the platform CSPRNG. */
function cryptoRng(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 4294967296;
}

/** Per connection. A person clicking fast sends a few messages a second; more is a script. */
const RATE_LIMIT = { windowMs: 1000, max: 15 };

const deps = (): Deps => ({ now: Date.now(), rng: cryptoRng, newId: () => crypto.randomUUID() });

export class RoomServer extends Server<Env> {
  static override options = { hibernate: false };

  private room: RoomState | null = null;
  /** In-memory only; resets on hibernation, which is fine for a rate limit. */
  private rate = new Map<string, { start: number; count: number }>();

  override async onStart(): Promise<void> {
    this.room = (await this.ctx.storage.get<RoomState>("room")) ?? null;
  }

  /** Internal: called by the Worker when a room is created. */
  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "POST") {
      if (this.room) return new Response("exists", { status: 409 });
      this.room = createRoom(this.name, Date.now());
      await this.save();
      return new Response("created", { status: 201 });
    }
    return new Response(this.room ? "ok" : "not found", { status: this.room ? 200 : 404 });
  }

  override onConnect(conn: Connection<ConnState>): void {
    if (!this.room) {
      this.send(conn, { type: "ERROR", code: "INVALID_ROOM" });
      conn.close(4404, "INVALID_ROOM");
      return;
    }
    if ([...this.getConnections()].length > MAX_CONNECTIONS) conn.close(4429, "TOO_MANY_CONNECTIONS");
  }

  override async onMessage(conn: Connection<ConnState>, raw: string | ArrayBuffer): Promise<void> {
    if (!this.room || this.overLimit(conn.id)) return;
    const msg = typeof raw === "string" ? parseClientMessage(raw) : null;
    if (!msg) {
      this.send(conn, { type: "ERROR", code: "INVALID_MESSAGE" });
      return;
    }
    let userId: string | null = null;
    if (msg.type === "HELLO" && msg.accessToken) {
      userId = await verifyAccessToken(this.env, msg.accessToken);
      if (!userId) {
        this.send(conn, { type: "ERROR", code: "AUTH_FAILED" });
        return;
      }
    }
    const outcome = handleMessage(this.room, conn.state?.playerId ?? null, msg, deps(), userId);
    if (outcome.bindPlayerId) conn.setState({ playerId: outcome.bindPlayerId });
    for (const m of outcome.reply) this.send(conn, m);
    await this.commit(outcome);
    if (outcome.close) conn.close(1000, "LEAVE");
    if (outcome.kickedPlayerId) {
      for (const c of this.getConnections<ConnState>()) {
        if (c.state?.playerId === outcome.kickedPlayerId) c.close(CLOSE_KICKED, "KICKED");
      }
    }
  }

  override onClose(conn: Connection): void {
    this.rate.delete(conn.id);
    // Connection status changed; everyone sees the disconnected indicator.
    if (this.room) this.broadcastState([]);
  }

  override async onAlarm(): Promise<void> {
    if (!this.room) return;
    const d = deps();
    if (isExpired(this.room, d.now)) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      for (const conn of this.getConnections()) conn.close(4410, "EXPIRED");
      return;
    }
    const outcome = handleAlarm(this.room, d);
    if (outcome) {
      await this.commit(outcome);
      return;
    }
    if (isIdle(this.room, d.now)) {
      for (const conn of this.getConnections()) conn.close(4408, "IDLE");
    }
    await this.ctx.storage.setAlarm(nextAlarmAt(this.room, d.now));
  }

  private overLimit(connId: string): boolean {
    const now = Date.now();
    const r = this.rate.get(connId);
    if (!r || now - r.start >= RATE_LIMIT.windowMs) {
      this.rate.set(connId, { start: now, count: 1 });
      return false;
    }
    r.count++;
    return r.count > RATE_LIMIT.max;
  }

  private async commit(outcome: Outcome): Promise<void> {
    if (outcome.room === this.room) return;
    this.room = outcome.room;
    await this.save();
    // History is best effort: a failed write never blocks the game.
    if (outcome.record) this.ctx.waitUntil(recordMatch(this.env, outcome.record).catch((e) => console.error(e)));
    if (outcome.broadcast) this.broadcastState(outcome.events);
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put("room", this.room);
    await this.ctx.storage.setAlarm(nextAlarmAt(this.room!, Date.now()));
  }

  private broadcastState(events: sueca.SuecaEvent[]): void {
    const conns = [...this.getConnections<ConnState>()].filter((c) => c.readyState === WebSocket.OPEN);
    const connected = new Set(conns.map((c) => c.state?.playerId).filter((id): id is string => !!id));
    const now = Date.now();
    for (const conn of conns) {
      const playerId = conn.state?.playerId ?? null;
      if (!playerId) continue;
      this.send(conn, stateFor(this.room!, playerId, connected, events, now));
    }
  }

  private send(conn: Connection, msg: ServerMessage): void {
    conn.send(JSON.stringify(msg));
  }
}

function newCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(cryptoRng() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  if (!allowedOrigins(env.ALLOWED_ORIGINS).includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms") {
      const cors = corsHeaders(request, env);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (!(await env.CREATE_LIMITER.limit({ key: ip })).success) {
        return new Response("Too Many Requests", { status: 429, headers: cors });
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        const stub = await getServerByName(env.Room, code);
        const res = await stub.fetch(new Request(`https://room/${code}`, { method: "POST" }));
        if (res.status === 201) {
          const body: CreateRoomResponse = { code };
          return Response.json(body, { headers: cors });
        }
      }
      return new Response("Could not allocate a room code", { status: 503, headers: cors });
    }

    if (!roomRequestAllowed(request, allowedOrigins(env.ALLOWED_ORIGINS))) return new Response("Not Found", { status: 404 });
    return (await routePartykitRequest(request, env)) ?? new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
