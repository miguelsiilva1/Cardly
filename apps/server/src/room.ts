import { sueca, type Rng } from "@cardly/engine";
import {
  HAND_RESULT_SECONDS,
  NAME_MAX_LENGTH,
  TRICK_PAUSE_MS,
  type ClientMessage,
  type ErrorCode,
  type RoomSnapshot,
  type ServerMessage,
  type Vacancy,
} from "@cardly/protocol";

/** Rooms nobody touched for this long are deleted. */
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * With no action for this long, the server closes every connection so the
 * Durable Object can be evicted and stops using free-plan compute time.
 */
export const IDLE_CLOSE_MS = 20 * 60 * 1000;

const SEATS = 4;
/** A bot "thinks" this long so humans can follow its plays. */
export const BOT_DELAY_MS = 1200;

export interface Player {
  id: string;
  name: string;
  /** Secret reconnect token. Never leaves the server except in this player's WELCOME. */
  token: string;
  seat: number | null;
  ready: boolean;
  continued: boolean;
  bot?: boolean;
}

export interface RoomState {
  code: string;
  game: "sueca";
  createdAt: number;
  lastActivity: number;
  hostId: string | null;
  status: "LOBBY" | "PLAYING";
  settings: sueca.SuecaRules;
  players: Player[];
  sueca: sueca.SuecaState | null;
  turnDeadline: number | null;
  continueDeadline: number | null;
  /** Seats emptied mid-match; while non-empty, all timers stop until the host decides. */
  vacancies?: Vacancy[];
}

export interface Deps {
  now: number;
  rng: Rng;
  newId: () => string;
}

export interface Outcome {
  room: RoomState;
  /** Messages for the sender only. */
  reply: ServerMessage[];
  /** Send a fresh STATE to every connection. */
  broadcast: boolean;
  events: sueca.SuecaEvent[];
  /** The sender's connection now belongs to this player. */
  bindPlayerId?: string;
  /** Close the sender's connection (after LEAVE). */
  close?: boolean;
  /** Close every connection of this player (removed by the host). */
  kickedPlayerId?: string;
}

export function createRoom(code: string, now: number): RoomState {
  return {
    code,
    game: "sueca",
    createdAt: now,
    lastActivity: now,
    hostId: null,
    status: "LOBBY",
    settings: { ...sueca.DEFAULT_SUECA_RULES },
    players: [],
    sueca: null,
    turnDeadline: null,
    continueDeadline: null,
  };
}

const fail = (room: RoomState, code: ErrorCode): Outcome => ({
  room,
  reply: [{ type: "ERROR", code }],
  broadcast: false,
  events: [],
});

const unchanged = (room: RoomState): Outcome => ({ room, reply: [], broadcast: false, events: [] });

const changed = (room: RoomState, events: sueca.SuecaEvent[] = []): Outcome => ({
  room,
  reply: [],
  broadcast: true,
  events,
});

function freeSeat(room: RoomState): number | null {
  for (let s = 0; s < SEATS; s++) {
    if (!room.players.some((p) => p.seat === s)) return s;
  }
  return null;
}

const paused = (room: RoomState) => (room.vacancies?.length ?? 0) > 0;

const isBotSeat = (room: RoomState, seat: number) => room.players.some((p) => p.seat === seat && p.bot);

/** Sets deadlines after any game change. */
function schedule(room: RoomState, now: number, trickCompleted: boolean): void {
  const s = room.sueca;
  room.turnDeadline = null;
  room.continueDeadline = null;
  if (!s || paused(room)) return;
  const pause = trickCompleted ? TRICK_PAUSE_MS : 0;
  if (s.phase === "PLAYING") {
    const secs = s.rules.turnTimerSeconds;
    // A bot seat always gets a short deadline; the alarm then plays for it.
    if (isBotSeat(room, s.turnSeat)) room.turnDeadline = now + BOT_DELAY_MS + pause;
    else if (secs > 0) room.turnDeadline = now + secs * 1000 + pause;
  } else if (s.phase === "HAND_RESULT") {
    room.continueDeadline = now + HAND_RESULT_SECONDS * 1000;
    for (const p of room.players) p.continued = !!p.bot;
  }
}

function applyGame(room: RoomState, t: sueca.Transition, now: number): Outcome {
  room.sueca = t.state;
  schedule(
    room,
    now,
    t.events.some((e) => e.type === "TRICK_COMPLETED"),
  );
  return changed(room, t.events);
}

function nextHand(room: RoomState, deps: Deps): Outcome {
  const r = sueca.startNextHand(room.sueca!, deps.rng);
  if (!r.ok) return fail(room, r.error);
  return applyGame(room, r.value, deps.now);
}

const TARGETS: readonly number[] = sueca.TARGET_RISK_OPTIONS;
const TIE_RULES: readonly string[] = ["EACH_TEAM_GETS_ONE", "NO_POINTS", "CARRY_TO_NEXT_HAND"];
const CAPOTE_RULES: readonly string[] = ["120_POINTS", "ALL_TEN_TRICKS"];
export const TIMER_OPTIONS: readonly number[] = [0, 15, 30, 60];

export function handleMessage(
  input: RoomState,
  playerId: string | null,
  msg: ClientMessage,
  deps: Deps,
): Outcome {
  const outcome = apply(input, playerId, msg, deps);
  // A rejected action changes nothing: hand back the same object so the
  // caller skips the storage write. Spammed invalid actions stay cheap.
  if (!outcome.broadcast) return { ...outcome, room: input };
  return outcome;
}

function apply(input: RoomState, playerId: string | null, msg: ClientMessage, deps: Deps): Outcome {
  const room: RoomState = structuredClone(input);
  room.lastActivity = deps.now;

  if (msg.type === "HELLO") {
    const known = msg.token ? room.players.find((p) => p.token === msg.token) : undefined;
    if (known) {
      return {
        room,
        reply: [{ type: "WELCOME", playerId: known.id, token: known.token }],
        broadcast: true,
        events: [],
        bindPlayerId: known.id,
      };
    }
    if (room.status !== "LOBBY") return fail(room, "MATCH_ALREADY_STARTED");
    if (room.players.length >= SEATS) return fail(room, "ROOM_FULL");
    const name = msg.name.trim();
    if (name.length === 0 || name.length > NAME_MAX_LENGTH) return fail(room, "INVALID_NAME");
    const player: Player = {
      id: deps.newId(),
      name,
      token: deps.newId() + deps.newId(),
      seat: freeSeat(room),
      ready: false,
      continued: false,
    };
    room.players.push(player);
    room.hostId ??= player.id;
    return {
      room,
      reply: [{ type: "WELCOME", playerId: player.id, token: player.token }],
      broadcast: true,
      events: [],
      bindPlayerId: player.id,
    };
  }

  const me = room.players.find((p) => p.id === playerId);
  if (!me) return fail(room, "PLAYER_NOT_FOUND");
  const isHost = room.hostId === me.id;

  switch (msg.type) {
    case "TAKE_SEAT": {
      if (room.status !== "LOBBY") return fail(room, "MATCH_ALREADY_STARTED");
      if (!Number.isInteger(msg.seat) || msg.seat < 0 || msg.seat >= SEATS) return fail(room, "INVALID_MESSAGE");
      if (room.players.some((p) => p.seat === msg.seat && p.id !== me.id)) return fail(room, "SEAT_TAKEN");
      me.seat = msg.seat;
      me.ready = false;
      return changed(room);
    }

    case "SET_READY": {
      if (room.status !== "LOBBY") return fail(room, "MATCH_ALREADY_STARTED");
      if (me.seat === null) return fail(room, "NOT_SEATED");
      if (me.ready === msg.ready) return unchanged(room);
      me.ready = msg.ready;
      return changed(room);
    }

    case "UPDATE_SETTINGS": {
      if (!isHost) return fail(room, "NOT_HOST");
      if (room.status !== "LOBBY") return fail(room, "MATCH_ALREADY_STARTED");
      const s = msg.settings;
      if (s.targetRisks !== undefined && !TARGETS.includes(s.targetRisks)) return fail(room, "INVALID_MESSAGE");
      if (s.tieAt60Rule !== undefined && !TIE_RULES.includes(s.tieAt60Rule)) return fail(room, "INVALID_MESSAGE");
      if (s.capoteRule !== undefined && !CAPOTE_RULES.includes(s.capoteRule)) return fail(room, "INVALID_MESSAGE");
      if (s.turnTimerSeconds !== undefined && !TIMER_OPTIONS.includes(s.turnTimerSeconds))
        return fail(room, "INVALID_MESSAGE");
      room.settings = { ...room.settings, ...s };
      for (const p of room.players) p.ready = !!p.bot;
      return changed(room);
    }

    case "START": {
      if (!isHost) return fail(room, "NOT_HOST");
      if (room.status !== "LOBBY") return fail(room, "MATCH_ALREADY_STARTED");
      const seated = room.players.filter((p) => p.seat !== null);
      if (seated.length < SEATS || !seated.every((p) => p.ready)) return fail(room, "NOT_ALL_READY");
      room.status = "PLAYING";
      return applyGame(room, sueca.createMatch(room.settings, deps.rng), deps.now);
    }

    case "PLAY_CARD": {
      if (room.status !== "PLAYING" || !room.sueca) return fail(room, "GAME_NOT_ACTIVE");
      if (paused(room)) return fail(room, "GAME_PAUSED");
      if (me.seat === null) return fail(room, "NOT_SEATED");
      if (msg.version !== room.sueca.version) return fail(room, "STALE_ACTION");
      const r = sueca.playCard(room.sueca, me.seat, msg.cardId);
      if (!r.ok) return fail(room, r.error);
      return applyGame(room, r.value, deps.now);
    }

    case "CONTINUE": {
      if (room.sueca?.phase !== "HAND_RESULT") return fail(room, "GAME_NOT_ACTIVE");
      if (paused(room)) return fail(room, "GAME_PAUSED");
      if (me.continued) return unchanged(room);
      me.continued = true;
      if (room.players.every((p) => p.continued)) return nextHand(room, deps);
      return changed(room);
    }

    case "PLAY_AGAIN": {
      if (!isHost) return fail(room, "NOT_HOST");
      if (room.sueca?.phase !== "MATCH_RESULT") return fail(room, "GAME_NOT_ACTIVE");
      backToLobby(room);
      return changed(room);
    }

    case "REPLACE_WITH_BOT": {
      if (!isHost) return fail(room, "NOT_HOST");
      if (!paused(room)) return fail(room, "NO_VACANCY");
      for (const v of room.vacancies!) {
        room.players.push({
          id: deps.newId(),
          name: `Bot ${v.name}`.slice(0, NAME_MAX_LENGTH),
          token: deps.newId() + deps.newId(),
          seat: v.seat,
          ready: true,
          continued: true,
          bot: true,
        });
      }
      room.vacancies = [];
      schedule(room, deps.now, false);
      return changed(room);
    }

    case "END_MATCH": {
      if (!isHost) return fail(room, "NOT_HOST");
      if (!paused(room)) return fail(room, "NO_VACANCY");
      backToLobby(room);
      return changed(room);
    }

    case "KICK": {
      if (!isHost) return fail(room, "NOT_HOST");
      if (room.status !== "LOBBY") return fail(room, "MATCH_ALREADY_STARTED");
      if (msg.playerId === me.id) return fail(room, "INVALID_MESSAGE");
      if (!room.players.some((p) => p.id === msg.playerId)) return fail(room, "PLAYER_NOT_FOUND");
      room.players = room.players.filter((p) => p.id !== msg.playerId);
      return { ...changed(room), kickedPlayerId: msg.playerId };
    }

    case "LEAVE": {
      room.players = room.players.filter((p) => p.id !== me.id);
      if (isHost) room.hostId = room.players.find((p) => !p.bot)?.id ?? null;
      const midMatch = room.status === "PLAYING" && room.sueca?.phase !== "MATCH_RESULT";
      if (midMatch && me.seat !== null) {
        room.vacancies = [...(room.vacancies ?? []), { seat: me.seat, name: me.name }];
        schedule(room, deps.now, false);
      }
      return { ...changed(room), close: true };
    }
  }
}

/** Back to the lobby with the same people; bots stay seated and ready. */
function backToLobby(room: RoomState): void {
  room.status = "LOBBY";
  room.sueca = null;
  room.vacancies = [];
  room.turnDeadline = null;
  room.continueDeadline = null;
  for (const p of room.players) {
    p.ready = !!p.bot;
    p.continued = false;
  }
}

/** Server timers: bot moves, auto-play on turn timeout, next hand after the result screen. */
export function handleAlarm(input: RoomState, deps: Deps): Outcome | null {
  const room: RoomState = structuredClone(input);
  const s = room.sueca;
  if (paused(room)) return null;
  if (s?.phase === "PLAYING" && room.turnDeadline !== null && deps.now >= room.turnDeadline) {
    const cardId = isBotSeat(room, s.turnSeat) ? sueca.botCardId(s) : sueca.autoPlayCardId(s);
    const r = sueca.playCard(s, s.turnSeat, cardId);
    if (!r.ok) throw new Error(`Auto-play rejected: ${r.error}`);
    return applyGame(room, r.value, deps.now);
  }
  if (s?.phase === "HAND_RESULT" && room.continueDeadline !== null && deps.now >= room.continueDeadline) {
    return nextHand(room, deps);
  }
  return null;
}

export function nextAlarmAt(room: RoomState, now: number): number {
  const deadline = room.turnDeadline ?? room.continueDeadline;
  if (deadline !== null) return deadline;
  const idleAt = room.lastActivity + IDLE_CLOSE_MS;
  return now < idleAt ? idleAt : room.lastActivity + ROOM_TTL_MS;
}

export function isIdle(room: RoomState, now: number): boolean {
  return room.turnDeadline === null && room.continueDeadline === null && now >= room.lastActivity + IDLE_CLOSE_MS;
}

export function isExpired(room: RoomState, now: number): boolean {
  return room.turnDeadline === null && room.continueDeadline === null && now >= room.lastActivity + ROOM_TTL_MS;
}

export function snapshot(room: RoomState, connectedIds: ReadonlySet<string>): RoomSnapshot {
  return {
    code: room.code,
    game: room.game,
    hostId: room.hostId ?? "",
    status: room.status,
    settings: room.settings,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      ready: p.ready,
      connected: !!p.bot || connectedIds.has(p.id),
      continued: p.continued,
      bot: !!p.bot,
    })),
    turnDeadline: room.turnDeadline,
    continueDeadline: room.continueDeadline,
    vacancies: room.vacancies ?? [],
  };
}

/** The only STATE builder: public room + this player's private Sueca view. */
export function stateFor(
  room: RoomState,
  playerId: string | null,
  connectedIds: ReadonlySet<string>,
  events: sueca.SuecaEvent[],
  now: number,
): ServerMessage {
  const seat = room.players.find((p) => p.id === playerId)?.seat ?? null;
  return {
    type: "STATE",
    room: snapshot(room, connectedIds),
    sueca: room.sueca && seat !== null ? sueca.viewFor(room.sueca, seat) : null,
    events,
    serverNow: now,
  };
}
