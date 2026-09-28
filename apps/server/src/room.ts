import { gringo, sueca, type Rng } from "@cardly/engine";
import {
  GRINGO_RESULT_SECONDS,
  HAND_RESULT_SECONDS,
  NAME_MAX_LENGTH,
  SEATS,
  TRICK_PAUSE_MS,
  type ClientMessage,
  type ErrorCode,
  type GameKind,
  type RoomSnapshot,
  type ServerMessage,
  type Vacancy,
} from "@cardly/protocol";
import type { MatchRecord } from "./supabase";

/** Rooms nobody touched for this long are deleted. */
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * With no action for this long, the server closes every connection so the
 * Durable Object can be evicted and stops using free-plan compute time.
 */
export const IDLE_CLOSE_MS = 20 * 60 * 1000;

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
  /** Supabase user id of a signed-in player. Server only. */
  userId?: string;
}

export interface RoomState {
  code: string;
  game: GameKind;
  createdAt: number;
  lastActivity: number;
  hostId: string | null;
  status: "LOBBY" | "PLAYING";
  settings: sueca.SuecaRules;
  gringoSettings?: gringo.GringoRules;
  players: Player[];
  sueca: sueca.SuecaState | null;
  gringo?: gringo.GringoState | null;
  turnDeadline: number | null;
  /** Gringo: end of the draw lock after a discard. */
  windowDeadline?: number | null;
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
  /** A Sueca match or Gringo round just finished with a signed-in player at the table: save it. */
  record?: MatchRecord;
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
    gringoSettings: { ...gringo.DEFAULT_GRINGO_RULES },
    players: [],
    sueca: null,
    gringo: null,
    turnDeadline: null,
    windowDeadline: null,
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

const seatCount = (room: RoomState) => SEATS[room.game];

function freeSeat(room: RoomState): number | null {
  for (let s = 0; s < seatCount(room); s++) {
    if (!room.players.some((p) => p.seat === s)) return s;
  }
  return null;
}

const paused = (room: RoomState) => (room.vacancies?.length ?? 0) > 0;

const isBotSeat = (room: RoomState, seat: number) => room.players.some((p) => p.seat === seat && p.bot);

/** Sets deadlines after any game change. */
function schedule(room: RoomState, now: number, trickCompleted: boolean): void {
  if (room.game === "gringo") return scheduleGringo(room, now, null);
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
  return withRecord(changed(room, t.events), suecaRecord(room, t.events));
}

const withRecord = (o: Outcome, record: MatchRecord | null): Outcome => (record ? { ...o, record } : o);

/** Seated players as history rows, or null when nobody signed in would see it. */
function recordPlayers(room: RoomState, row: (seat: number) => { team: "A" | "B" | null; score: number; won: boolean }) {
  const seated = room.players.filter((p) => p.seat !== null).sort((a, b) => a.seat! - b.seat!);
  if (!seated.some((p) => p.userId)) return null;
  return seated.map((p) => ({ seat: p.seat!, name: p.name, user_id: p.userId ?? null, bot: !!p.bot, ...row(p.seat!) }));
}

function suecaRecord(room: RoomState, events: sueca.SuecaEvent[]): MatchRecord | null {
  const done = events.find((e) => e.type === "MATCH_COMPLETED");
  const s = room.sueca;
  if (done?.type !== "MATCH_COMPLETED" || !s) return null;
  const players = recordPlayers(room, (seat) => {
    const team = sueca.teamOf(seat);
    return { team, score: done.risks[team], won: team === done.winner };
  });
  if (!players) return null;
  return {
    game: "sueca",
    room_code: room.code,
    summary: { risks: done.risks, targetRisks: s.rules.targetRisks, hands: s.handResults.length },
    players,
  };
}

function gringoRecord(room: RoomState, prev: gringo.GringoState | null): MatchRecord | null {
  const r = room.gringo?.result;
  if (prev?.phase === "ROUND_RESULT" || room.gringo?.phase !== "ROUND_RESULT" || !r) return null;
  const players = recordPlayers(room, (seat) => ({ team: null, score: r.totals[seat]!, won: r.winners.includes(seat) }));
  if (!players) return null;
  return {
    game: "gringo",
    room_code: room.code,
    summary: { round: r.roundNumber, reason: r.reason, caller: r.caller },
    players,
  };
}

/** Extra time a player keeps on their turn when a match reopens the draw lock. */
const MATCH_GRACE_MS = 5000;

/**
 * Gringo deadlines. `prev` is the game before this change: an unchanged turn,
 * window or ability keeps its deadline; a new one gets a fresh one.
 */
function scheduleGringo(room: RoomState, now: number, prev: gringo.GringoState | null): void {
  const g = room.gringo;
  const old = { turn: room.turnDeadline, window: room.windowDeadline ?? null, cont: room.continueDeadline };
  room.turnDeadline = null;
  room.windowDeadline = null;
  room.continueDeadline = null;
  if (!g || paused(room)) return;
  const timer = g.rules.turnTimerSeconds * 1000;

  if (g.phase === "PEEK") {
    if (timer > 0) room.turnDeadline = prev?.phase === "PEEK" && old.turn !== null ? old.turn : now + timer;
    return;
  }

  if (g.phase === "ROUND_RESULT") {
    const entering = prev?.phase !== "ROUND_RESULT" || old.cont === null;
    room.continueDeadline = entering ? now + GRINGO_RESULT_SECONDS * 1000 : old.cont;
    if (entering) for (const p of room.players) p.continued = !!p.bot;
    return;
  }

  if (g.window) {
    const same = prev?.window?.eventId === g.window.eventId && old.window !== null;
    room.windowDeadline = same ? old.window : now + g.rules.abilityWindowSeconds * 1000;
  }
  const start = room.windowDeadline ?? now;

  if (g.ability) {
    const same = prev?.ability?.seat === g.ability.seat && prev.ability.cardId === g.ability.cardId && old.turn !== null;
    if (isBotSeat(room, g.ability.seat)) room.turnDeadline = now + BOT_DELAY_MS;
    else if (timer > 0) room.turnDeadline = same ? old.turn : now + timer;
    return;
  }

  if (isBotSeat(room, g.turnSeat)) {
    room.turnDeadline = start + BOT_DELAY_MS;
  } else if (timer > 0) {
    const sameTurn = prev?.phase === "PLAYING" && prev.turnNumber === g.turnNumber && !prev.ability && old.turn !== null;
    room.turnDeadline = sameTurn ? Math.max(old.turn!, start + MATCH_GRACE_MS) : start + timer;
  }
}

/** Bots pick their two cards as soon as a round is dealt. */
function botsPeek(room: RoomState, rng: Rng): void {
  let g = room.gringo;
  if (g?.phase !== "PEEK") return;
  for (const p of room.players) {
    if (p.bot && p.seat !== null && !g.peeked[p.seat]) {
      const r = gringo.peek(g, p.seat, gringo.randomPeekSlots(g, p.seat, rng));
      if (r.ok) g = r.value;
    }
  }
  room.gringo = g;
}

function applyGringo(room: RoomState, next: gringo.GringoState, deps: Deps): Outcome {
  const prev = room.gringo ?? null;
  room.gringo = next;
  botsPeek(room, deps.rng);
  scheduleGringo(room, deps.now, prev);
  return withRecord(changed(room), gringoRecord(room, prev));
}

function gringoAction(
  room: RoomState,
  me: Player,
  deps: Deps,
  act: (g: gringo.GringoState, seat: number) => ReturnType<typeof gringo.draw>,
): Outcome {
  if (room.status !== "PLAYING" || !room.gringo) return fail(room, "GAME_NOT_ACTIVE");
  if (paused(room)) return fail(room, "GAME_PAUSED");
  if (me.seat === null) return fail(room, "NOT_SEATED");
  const r = act(room.gringo, me.seat);
  if (!r.ok) return fail(room, r.error);
  return applyGringo(room, r.value, deps);
}

function nextHand(room: RoomState, deps: Deps): Outcome {
  if (room.game === "gringo") {
    const r = gringo.nextRound(room.gringo!, deps.rng);
    if (!r.ok) return fail(room, r.error);
    return applyGringo(room, r.value, deps);
  }
  const r = sueca.startNextHand(room.sueca!, deps.rng);
  if (!r.ok) return fail(room, r.error);
  return applyGame(room, r.value, deps.now);
}

const TARGETS: readonly number[] = sueca.TARGET_RISK_OPTIONS;
const TIE_RULES: readonly string[] = ["EACH_TEAM_GETS_ONE", "NO_POINTS", "CARRY_TO_NEXT_HAND"];
const CAPOTE_RULES: readonly string[] = ["120_POINTS", "ALL_TEN_TRICKS"];
export const TIMER_OPTIONS: readonly number[] = [0, 15, 30, 60];
const WINDOW_OPTIONS: readonly number[] = gringo.ABILITY_WINDOW_OPTIONS;
const GRINGO_TIMER_OPTIONS: readonly number[] = gringo.TURN_TIMER_OPTIONS;

/** `userId`: verified Supabase user of the sender, only read by HELLO. */
export function handleMessage(
  input: RoomState,
  playerId: string | null,
  msg: ClientMessage,
  deps: Deps,
  userId: string | null = null,
): Outcome {
  const outcome = apply(input, playerId, msg, deps, userId);
  // A rejected action changes nothing: hand back the same object so the
  // caller skips the storage write. Spammed invalid actions stay cheap.
  if (!outcome.broadcast) return { ...outcome, room: input };
  return outcome;
}

function apply(input: RoomState, playerId: string | null, msg: ClientMessage, deps: Deps, userId: string | null): Outcome {
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
    if (room.players.length >= seatCount(room)) return fail(room, "ROOM_FULL");
    const name = msg.name.trim();
    if (name.length === 0 || name.length > NAME_MAX_LENGTH) return fail(room, "INVALID_NAME");
    const player: Player = {
      id: deps.newId(),
      name,
      token: deps.newId() + deps.newId(),
      seat: freeSeat(room),
      ready: false,
      continued: false,
      ...(userId ? { userId } : {}),
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
      if (!Number.isInteger(msg.seat) || msg.seat < 0 || msg.seat >= seatCount(room)) return fail(room, "INVALID_MESSAGE");
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

    case "SET_GAME": {
      if (!isHost) return fail(room, "NOT_HOST");
      if (room.status !== "LOBBY") return fail(room, "MATCH_ALREADY_STARTED");
      if (msg.game === room.game) return unchanged(room);
      if (room.players.length > SEATS[msg.game]) return fail(room, "TOO_MANY_PLAYERS");
      room.game = msg.game;
      // Players on seats the new table does not have move to free ones.
      for (const p of room.players) {
        if (p.seat !== null && p.seat >= seatCount(room)) {
          p.seat = null;
          p.seat = freeSeat(room);
        }
      }
      for (const p of room.players) p.ready = !!p.bot;
      return changed(room);
    }

    case "UPDATE_GRINGO_SETTINGS": {
      if (!isHost) return fail(room, "NOT_HOST");
      if (room.status !== "LOBBY") return fail(room, "MATCH_ALREADY_STARTED");
      const s = msg.settings;
      if (s.turnTimerSeconds !== undefined && !GRINGO_TIMER_OPTIONS.includes(s.turnTimerSeconds))
        return fail(room, "INVALID_MESSAGE");
      if (s.abilityWindowSeconds !== undefined && !WINDOW_OPTIONS.includes(s.abilityWindowSeconds))
        return fail(room, "INVALID_MESSAGE");
      room.gringoSettings = { ...gringoRules(room), ...s };
      for (const p of room.players) p.ready = !!p.bot;
      return changed(room);
    }

    case "START": {
      if (!isHost) return fail(room, "NOT_HOST");
      if (room.status !== "LOBBY") return fail(room, "MATCH_ALREADY_STARTED");
      const seated = room.players.filter((p) => p.seat !== null);
      if (room.game === "gringo") {
        if (seated.length < gringo.MIN_PLAYERS) return fail(room, "NOT_ENOUGH_PLAYERS");
        if (!seated.every((p) => p.ready)) return fail(room, "NOT_ALL_READY");
        // The engine numbers seats 0..n-1 in play order; close the gaps.
        seated.sort((a, b) => a.seat! - b.seat!).forEach((p, i) => (p.seat = i));
        room.status = "PLAYING";
        return applyGringo(room, gringo.createGame(gringoRules(room), seated.length, deps.rng), deps);
      }
      if (seated.length < SEATS.sueca || !seated.every((p) => p.ready)) return fail(room, "NOT_ALL_READY");
      room.status = "PLAYING";
      return applyGame(room, sueca.createMatch(room.settings, deps.rng), deps.now);
    }

    case "G_PEEK":
      return gringoAction(room, me, deps, (g, seat) => gringo.peek(g, seat, msg.slotIds));
    case "G_DRAW":
      return gringoAction(room, me, deps, (g, seat) => gringo.draw(g, seat));
    case "G_DISCARD":
      return gringoAction(room, me, deps, (g, seat) => gringo.discardDrawn(g, seat));
    case "G_SWAP":
      return gringoAction(room, me, deps, (g, seat) => gringo.swapDrawn(g, seat, msg.slotId));
    case "G_MATCH":
      return gringoAction(room, me, deps, (g, seat) => gringo.matchDiscard(g, seat, msg.slotId, msg.eventId));
    case "G_USE_ABILITY":
      return gringoAction(room, me, deps, (g, seat) => gringo.useAbility(g, seat, msg.eventId));
    case "G_TARGET":
      return gringoAction(room, me, deps, (g, seat) => gringo.chooseAbilityTarget(g, seat, msg.mySlotId, msg.targetSlotId));
    case "G_KING_DECIDE":
      return gringoAction(room, me, deps, (g, seat) => gringo.decideBlackKing(g, seat, msg.swap));
    case "G_CALL_GRINGO":
      return gringoAction(room, me, deps, (g, seat) => gringo.callGringo(g, seat));

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
      const between = room.game === "gringo" ? room.gringo?.phase === "ROUND_RESULT" : room.sueca?.phase === "HAND_RESULT";
      if (!between) return fail(room, "GAME_NOT_ACTIVE");
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
      botsPeek(room, deps.rng);
      schedule(room, deps.now, false);
      return changed(room);
    }

    case "END_MATCH": {
      if (!isHost) return fail(room, "NOT_HOST");
      const betweenRounds = room.game === "gringo" && room.gringo?.phase === "ROUND_RESULT";
      if (!paused(room) && !betweenRounds) return fail(room, "NO_VACANCY");
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
      // Gringo rounds never end the match on their own, so any leave while playing pauses.
      const midMatch = room.status === "PLAYING" && (room.game === "gringo" || room.sueca?.phase !== "MATCH_RESULT");
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
  room.gringo = null;
  room.vacancies = [];
  room.turnDeadline = null;
  room.windowDeadline = null;
  room.continueDeadline = null;
  for (const p of room.players) {
    p.ready = !!p.bot;
    p.continued = false;
  }
}

/** Server timers: bot moves, auto-play on turn timeout, next hand after the result screen. */
export function handleAlarm(input: RoomState, deps: Deps): Outcome | null {
  const room: RoomState = structuredClone(input);
  if (paused(room)) return null;
  if (room.game === "gringo") return gringoAlarm(room, deps);
  const s = room.sueca;
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

function gringoAlarm(room: RoomState, deps: Deps): Outcome | null {
  const g = room.gringo;
  if (!g) return null;
  const due = (t: number | null | undefined) => t != null && deps.now >= t;
  if (g.phase === "PLAYING" && g.window && due(room.windowDeadline)) {
    return applyGringo(room, gringo.closeWindow(g, g.window.eventId), deps);
  }
  if ((g.phase === "PEEK" || g.phase === "PLAYING") && due(room.turnDeadline)) {
    const botTurn = g.phase === "PLAYING" && !g.ability && !g.window && isBotSeat(room, g.turnSeat);
    return applyGringo(room, botTurn ? gringo.botTurn(g) : gringo.timeout(g, deps.rng), deps);
  }
  if (g.phase === "ROUND_RESULT" && due(room.continueDeadline)) return nextHand(room, deps);
  return null;
}

const deadlines = (room: RoomState) =>
  [room.turnDeadline, room.windowDeadline ?? null, room.continueDeadline].filter((t): t is number => t !== null);

export function nextAlarmAt(room: RoomState, now: number): number {
  const pending = deadlines(room);
  if (pending.length > 0) return Math.min(...pending);
  const idleAt = room.lastActivity + IDLE_CLOSE_MS;
  return now < idleAt ? idleAt : room.lastActivity + ROOM_TTL_MS;
}

export function isIdle(room: RoomState, now: number): boolean {
  return deadlines(room).length === 0 && now >= room.lastActivity + IDLE_CLOSE_MS;
}

export function isExpired(room: RoomState, now: number): boolean {
  return deadlines(room).length === 0 && now >= room.lastActivity + ROOM_TTL_MS;
}

export function snapshot(room: RoomState, connectedIds: ReadonlySet<string>): RoomSnapshot {
  return {
    code: room.code,
    game: room.game,
    hostId: room.hostId ?? "",
    status: room.status,
    settings: room.settings,
    gringoSettings: gringoRules(room),
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
    windowDeadline: room.windowDeadline ?? null,
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
    gringo: room.gringo && seat !== null ? gringo.viewFor(room.gringo, seat) : null,
    events,
    serverNow: now,
  };
}

/** Rooms saved before Gringo existed have no Gringo settings. */
function gringoRules(room: RoomState): gringo.GringoRules {
  return room.gringoSettings ?? { ...gringo.DEFAULT_GRINGO_RULES };
}
