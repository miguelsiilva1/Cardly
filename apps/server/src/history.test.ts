import { describe, expect, it } from "vitest";
import { seededRng } from "@cardly/engine";
import type { ClientMessage, ServerMessage } from "@cardly/protocol";
import { parseClientMessage } from "./parse";
import { createRoom, handleAlarm, handleMessage, nextAlarmAt, type Deps, type Outcome, type RoomState } from "./room";
import type { MatchRecord } from "./supabase";

let clock = 9_000_000;
let ids = 0;
const rng = seededRng(3);
const deps = (): Deps => ({ now: clock, rng, newId: () => `id${++ids}` });

const send = (room: RoomState, playerId: string | null, msg: ClientMessage, userId: string | null = null): Outcome =>
  handleMessage(room, playerId, msg, deps(), userId);

function playerIdOf(o: Outcome): string {
  const w = o.reply.find((m): m is Extract<ServerMessage, { type: "WELCOME" }> => m.type === "WELCOME");
  if (!w) throw new Error(`No WELCOME: ${JSON.stringify(o.reply)}`);
  return w.playerId;
}

/** Ready lobby; the first player is signed in as "user-1" when `signedIn`. */
function lobby(game: "sueca" | "gringo", n: number, signedIn: boolean) {
  let room = createRoom("HIST01", clock);
  const pids: string[] = [];
  for (let i = 0; i < n; i++) {
    const o = send(room, null, { type: "HELLO", name: `P${i}` }, signedIn && i === 0 ? "user-1" : null);
    room = o.room;
    pids.push(playerIdOf(o));
    if (i === 0 && game === "gringo") room = send(room, pids[0]!, { type: "SET_GAME", game }).room;
  }
  if (game === "sueca") room = send(room, pids[0]!, { type: "UPDATE_SETTINGS", settings: { targetRisks: 3 } }).room;
  for (const id of pids) room = send(room, id, { type: "SET_READY", ready: true }).room;
  return send(room, pids[0]!, { type: "START" }).room;
}

/** Runs alarms until `stop`, collecting every history record. */
function runAlarms(room: RoomState, stop: (r: RoomState) => boolean) {
  const records: MatchRecord[] = [];
  let guard = 0;
  while (!stop(room) && guard++ < 5000) {
    clock = nextAlarmAt(room, clock);
    const o = handleAlarm(room, deps());
    if (!o) throw new Error("alarm did nothing");
    if (o.record) records.push(o.record);
    room = o.room;
  }
  return { room, records };
}

describe("history records", () => {
  it("a signed-in player is linked to their Supabase user; the id never reaches clients", () => {
    const o = send(createRoom("HIST01", clock), null, { type: "HELLO", name: "Ana" }, "user-1");
    expect(o.room.players[0]!.userId).toBe("user-1");
    expect(JSON.stringify(o.reply)).not.toContain("user-1");
  });

  it("a finished Sueca match yields one record with teams, riscos and the winner", () => {
    const { room, records } = runAlarms(lobby("sueca", 4, true), (r) => r.sueca!.phase === "MATCH_RESULT");
    expect(records).toHaveLength(1);
    const rec = records[0]!;
    const s = room.sueca!;
    expect(rec.game).toBe("sueca");
    expect(rec.room_code).toBe("HIST01");
    expect(rec.players).toHaveLength(4);
    expect(rec.players.filter((p) => p.user_id === "user-1")).toHaveLength(1);
    for (const p of rec.players) {
      expect(p.team).toBe(p.seat % 2 === 0 ? "A" : "B");
      expect(p.score).toBe(s.risks[p.team!]);
      expect(p.won).toBe(p.team === s.winner);
    }
  });

  it("every finished Gringo round yields a record; lowest totals win", () => {
    const start = lobby("gringo", 3, true);
    const first = runAlarms(start, (r) => r.gringo!.phase === "ROUND_RESULT");
    expect(first.records).toHaveLength(1);
    const rec = first.records[0]!;
    const res = first.room.gringo!.result!;
    expect(rec.game).toBe("gringo");
    expect(rec.summary.round).toBe(1);
    expect(rec.players.map((p) => p.score)).toEqual(res.totals);
    expect(rec.players.filter((p) => p.won).map((p) => p.seat)).toEqual(res.winners);

    // The result screen and the next round's deal add nothing; the second round adds one.
    const second = runAlarms(first.room, (r) => r.gringo!.roundNumber === 2 && r.gringo!.phase === "ROUND_RESULT");
    expect(second.records).toHaveLength(1);
    expect(second.records[0]!.summary.round).toBe(2);
  });

  it("no record when nobody at the table is signed in", () => {
    expect(runAlarms(lobby("sueca", 4, false), (r) => r.sueca!.phase === "MATCH_RESULT").records).toHaveLength(0);
    expect(runAlarms(lobby("gringo", 3, false), (r) => r.gringo!.phase === "ROUND_RESULT").records).toHaveLength(0);
  });

  it("HELLO keeps a bounded access token", () => {
    expect(parseClientMessage(JSON.stringify({ type: "HELLO", name: "Ana", accessToken: "jwt" }))).toEqual({
      type: "HELLO",
      name: "Ana",
      accessToken: "jwt",
    });
    expect(parseClientMessage(JSON.stringify({ type: "HELLO", name: "Ana", accessToken: 5 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "HELLO", name: "Ana", accessToken: "x".repeat(3001) }))).toBeNull();
  });
});
