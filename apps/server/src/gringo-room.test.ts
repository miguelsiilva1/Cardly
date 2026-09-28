import { describe, expect, it } from "vitest";
import { seededRng } from "@cardly/engine";
import type { ClientMessage, ServerMessage } from "@cardly/protocol";
import { parseClientMessage } from "./parse";
import { createRoom, handleAlarm, handleMessage, nextAlarmAt, stateFor, type Deps, type Outcome, type RoomState } from "./room";

let clock = 5_000_000;
let ids = 0;
const rng = seededRng(9);
const deps = (): Deps => ({ now: clock, rng, newId: () => `id${++ids}` });

const send = (room: RoomState, playerId: string | null, msg: ClientMessage): Outcome =>
  handleMessage(room, playerId, msg, deps());

function errorOf(o: Outcome): string | undefined {
  const e = o.reply.find((m) => m.type === "ERROR");
  return e?.type === "ERROR" ? e.code : undefined;
}

function playerIdOf(o: Outcome): string {
  const w = o.reply.find((m): m is Extract<ServerMessage, { type: "WELCOME" }> => m.type === "WELCOME");
  if (!w) throw new Error(`No WELCOME: ${JSON.stringify(o.reply)}`);
  return w.playerId;
}

/** Gringo lobby with `n` ready players. Index = join order. */
function lobby(n: number) {
  let room = createRoom("GRINGO", clock);
  const ids: string[] = [];
  const first = send(room, null, { type: "HELLO", name: "P0" });
  room = first.room;
  ids.push(playerIdOf(first));
  room = send(room, ids[0]!, { type: "SET_GAME", game: "gringo" }).room;
  for (let i = 1; i < n; i++) {
    const o = send(room, null, { type: "HELLO", name: `P${i}` });
    room = o.room;
    ids.push(playerIdOf(o));
  }
  for (const id of ids) room = send(room, id, { type: "SET_READY", ready: true }).room;
  return { room, ids };
}

/** Started and past the peek phase. `bySeat[seat]` is that seat's player id. */
function playing(n: number) {
  const l = lobby(n);
  let room = send(l.room, l.ids[0]!, { type: "START" }).room;
  const bySeat = Array.from({ length: n }, (_, seat) => room.players.find((p) => p.seat === seat)!.id);
  for (let seat = 0; seat < n; seat++) {
    const slots = room.gringo!.hands[seat]!.slice(0, 2).map((x) => x.id);
    room = send(room, bySeat[seat]!, { type: "G_PEEK", slotIds: slots }).room;
  }
  expect(room.gringo!.phase).toBe("PLAYING");
  return { room, bySeat };
}

function view(room: RoomState, playerId: string) {
  const m = stateFor(room, playerId, new Set(), [], clock);
  if (m.type !== "STATE" || !m.gringo) throw new Error("no gringo view");
  return m.gringo;
}

describe("gringo lobby", () => {
  it("host picks the game; Gringo has 6 seats", () => {
    const { room, ids } = lobby(6);
    expect(room.game).toBe("gringo");
    expect(room.players.map((p) => p.seat)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(errorOf(send(room, null, { type: "HELLO", name: "P6" }))).toBe("ROOM_FULL");
    expect(errorOf(send(room, ids[1]!, { type: "SET_GAME", game: "sueca" }))).toBe("NOT_HOST");
    expect(errorOf(send(room, ids[0]!, { type: "SET_GAME", game: "sueca" }))).toBe("TOO_MANY_PLAYERS");
  });

  it("switching back to Sueca moves players off seats 4 and 5 and resets ready", () => {
    let { room, ids } = lobby(3);
    room = send(room, ids[2]!, { type: "TAKE_SEAT", seat: 5 }).room;
    room = send(room, ids[0]!, { type: "SET_GAME", game: "sueca" }).room;
    expect(room.players.map((p) => p.seat)).toEqual([0, 1, 2]);
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  it("needs 3 players; start closes seat gaps and deals for the peek", () => {
    let { room, ids } = lobby(2);
    expect(errorOf(send(room, ids[0]!, { type: "START" }))).toBe("NOT_ENOUGH_PLAYERS");
    ({ room, ids } = lobby(3));
    room = send(room, ids[1]!, { type: "TAKE_SEAT", seat: 4 }).room;
    room = send(room, ids[1]!, { type: "SET_READY", ready: true }).room;
    const o = send(room, ids[0]!, { type: "START" });
    expect(errorOf(o)).toBeUndefined();
    expect(o.room.players.map((p) => p.seat).sort()).toEqual([0, 1, 2]);
    expect(o.room.gringo!.phase).toBe("PEEK");
    expect(o.room.turnDeadline).toBe(clock + 60_000);
  });

  it("validates Gringo settings", () => {
    const { room, ids } = lobby(3);
    const bad = send(room, ids[0]!, { type: "UPDATE_GRINGO_SETTINGS", settings: { abilityWindowSeconds: 9 } });
    expect(errorOf(bad)).toBe("INVALID_MESSAGE");
    const o = send(room, ids[0]!, { type: "UPDATE_GRINGO_SETTINGS", settings: { abilityWindowSeconds: 5 } });
    expect(o.room.gringoSettings!.abilityWindowSeconds).toBe(5);
  });
});

describe("gringo play", () => {
  it("each STATE hides other hands and the drawn card", () => {
    let { room, bySeat } = playing(4);
    const turn = room.gringo!.turnSeat;
    room = send(room, bySeat[turn]!, { type: "G_DRAW" }).room;
    const drawn = room.gringo!.drawn!;
    for (let seat = 0; seat < 4; seat++) {
      const v = view(room, bySeat[seat]!);
      expect(v.mySeat).toBe(seat);
      // Every card is face down; peeked cards were shown once, in an earlier STATE.
      expect(v.hands.flat().every((x) => x.cardId === null)).toBe(true);
      expect(v.glimpse).toBeNull();
      if (seat !== turn) expect(JSON.stringify(v)).not.toContain(`"${drawn}"`);
    }
  });

  it("a discard locks the next draw until the window alarm; then the turn timer runs", () => {
    let { room, bySeat } = playing(3);
    const turn = room.gringo!.turnSeat;
    room = send(room, bySeat[turn]!, { type: "G_DRAW" }).room;
    room = send(room, bySeat[turn]!, { type: "G_DISCARD" }).room;
    const next = room.gringo!.turnSeat;
    expect(room.windowDeadline).toBe(clock + 3_000);
    expect(room.turnDeadline).toBe(clock + 3_000 + 60_000);
    expect(nextAlarmAt(room, clock)).toBe(room.windowDeadline);
    expect(errorOf(send(room, bySeat[next]!, { type: "G_DRAW" }))).toBe("DRAW_LOCKED");
    clock += 3_000;
    room = handleAlarm(room, deps())!.room;
    expect(room.gringo!.window).toBeNull();
    expect(room.windowDeadline).toBeNull();
    expect(room.turnDeadline).toBe(clock + 60_000);
    expect(errorOf(send(room, bySeat[next]!, { type: "G_DRAW" }))).toBeUndefined();
  });

  it("two racing matches on one discard: the first wins, the second is too late", () => {
    let { room, bySeat } = playing(3);
    const g = room.gringo!;
    // Rig: both other players hold a card matching the top discard.
    const turn = g.turnSeat;
    room = send(room, bySeat[turn]!, { type: "G_DRAW" }).room;
    room = send(room, bySeat[turn]!, { type: "G_DISCARD" }).room;
    const top = room.gringo!.event!;
    const others = [0, 1, 2].filter((s) => s !== turn);
    for (const seat of others) {
      const slot = room.gringo!.hands[seat]![0]!;
      const twin = top.cardId === "X1" ? "X2" : top.cardId === "X2" ? "X1" : top.cardId;
      room.gringo!.hands[seat]![0] = { ...slot, cardId: twin };
    }
    const first = send(room, bySeat[others[0]!]!, { type: "G_MATCH", slotId: room.gringo!.hands[others[0]!]![0]!.id, eventId: top.id });
    expect(errorOf(first)).toBeUndefined();
    const second = send(first.room, bySeat[others[1]!]!, {
      type: "G_MATCH",
      slotId: first.room.gringo!.hands[others[1]!]![0]!.id,
      eventId: top.id,
    });
    expect(errorOf(second)).toBe("MATCH_TOO_LATE");
    expect(second.room).toBe(first.room);
  });

  it("timers alone play a whole round, show the result, then deal the next round to the right", () => {
    let { room } = playing(3);
    const first = room.gringo!.firstSeat;
    let guard = 0;
    while (room.gringo!.phase === "PLAYING" && guard++ < 500) {
      clock = nextAlarmAt(room, clock);
      room = handleAlarm(room, deps())!.room;
    }
    expect(room.gringo!.phase).toBe("ROUND_RESULT");
    expect(room.continueDeadline).toBe(clock + 30_000);
    clock = room.continueDeadline!;
    room = handleAlarm(room, deps())!.room;
    expect(room.gringo!.phase).toBe("PEEK");
    expect(room.gringo!.roundNumber).toBe(2);
    expect(room.gringo!.firstSeat).toBe((first + 1) % 3);
  });

  it("a leaver pauses play; a bot takes over and plays by alarm", () => {
    let { room, bySeat } = playing(3);
    const leaver = (room.gringo!.turnSeat + 1) % 3;
    room = send(room, bySeat[leaver]!, { type: "LEAVE" }).room;
    expect(room.vacancies).toHaveLength(1);
    expect(room.turnDeadline).toBeNull();
    const host = room.hostId!;
    room = send(room, host, { type: "REPLACE_WITH_BOT" }).room;
    expect(room.players.find((p) => p.seat === leaver)!.bot).toBe(true);
    let botTurns = 0;
    let guard = 0;
    while (room.gringo!.phase === "PLAYING" && guard++ < 500) {
      const before = room.gringo!;
      clock = nextAlarmAt(room, clock);
      room = handleAlarm(room, deps())!.room;
      if (before.turnSeat === leaver && !before.window && room.gringo!.turnSeat !== leaver) botTurns++;
    }
    expect(botTurns).toBeGreaterThan(0);
  });

  it("between rounds the host can end the game and go back to the lobby", () => {
    let { room, bySeat } = playing(3);
    expect(errorOf(send(room, bySeat[0]!, { type: "END_MATCH" }))).toBe("NO_VACANCY");
    let guard = 0;
    while (room.gringo!.phase === "PLAYING" && guard++ < 500) {
      clock = nextAlarmAt(room, clock);
      room = handleAlarm(room, deps())!.room;
    }
    const host = room.hostId!;
    const o = send(room, host, { type: "END_MATCH" });
    expect(o.room.status).toBe("LOBBY");
    expect(o.room.gringo).toBeNull();
    expect(o.room.game).toBe("gringo");
  });
});

describe("gringo parse", () => {
  it("accepts well-formed Gringo messages and rejects junk", () => {
    expect(parseClientMessage('{"type":"G_MATCH","slotId":"s3","eventId":4}')).toEqual({
      type: "G_MATCH",
      slotId: "s3",
      eventId: 4,
    });
    expect(parseClientMessage('{"type":"G_TARGET","mySlotId":"s1","targetSlotId":null}')).toEqual({
      type: "G_TARGET",
      mySlotId: "s1",
      targetSlotId: null,
    });
    expect(parseClientMessage('{"type":"G_PEEK","slotIds":["s1","s2"]}')).toEqual({ type: "G_PEEK", slotIds: ["s1", "s2"] });
    expect(parseClientMessage('{"type":"G_PEEK","slotIds":"s1"}')).toBeNull();
    expect(parseClientMessage('{"type":"G_MATCH","slotId":"s3"}')).toBeNull();
    expect(parseClientMessage('{"type":"SET_GAME","game":"poker"}')).toBeNull();
    expect(parseClientMessage('{"type":"G_KING_DECIDE","swap":"yes"}')).toBeNull();
  });
});
