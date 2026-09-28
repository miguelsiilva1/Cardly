import { describe, expect, it } from "vitest";
import { seededRng, sueca } from "@cardly/engine";
import type { ClientMessage, ServerMessage } from "@cardly/protocol";
import { parseClientMessage } from "./parse";
import {
  createRoom,
  handleAlarm,
  handleMessage,
  IDLE_CLOSE_MS,
  isExpired,
  isIdle,
  nextAlarmAt,
  ROOM_TTL_MS,
  stateFor,
  type Deps,
  type Outcome,
  type RoomState,
} from "./room";

let clock = 1_000_000;
let ids = 0;
const rng = seededRng(1);
const deps = (): Deps => ({ now: clock, rng, newId: () => `id${++ids}` });

function send(room: RoomState, playerId: string | null, msg: ClientMessage): Outcome {
  return handleMessage(room, playerId, msg, deps());
}

function welcome(o: Outcome): { playerId: string; token: string } {
  const w = o.reply.find((m): m is Extract<ServerMessage, { type: "WELCOME" }> => m.type === "WELCOME");
  if (!w) throw new Error(`No WELCOME: ${JSON.stringify(o.reply)}`);
  return w;
}

function errorOf(o: Outcome): string | undefined {
  const e = o.reply.find((m) => m.type === "ERROR");
  return e?.type === "ERROR" ? e.code : undefined;
}

/** Room with 4 seated, ready players. Returns their ids (index = seat) and tokens. */
function fullLobby() {
  let room = createRoom("ABCDEF", clock);
  const players: { playerId: string; token: string }[] = [];
  for (const name of ["Ana", "Bruno", "Carla", "Duarte"]) {
    const o = send(room, null, { type: "HELLO", name });
    room = o.room;
    players.push(welcome(o));
  }
  for (const p of players) room = send(room, p.playerId, { type: "SET_READY", ready: true }).room;
  return { room, players };
}

function started() {
  const { room, players } = fullLobby();
  const o = send(room, players[0]!.playerId, { type: "START" });
  expect(errorOf(o)).toBeUndefined();
  return { room: o.room, players };
}

describe("lobby", () => {
  it("first player is host; seats fill 0..3; teams by seat", () => {
    const { room, players } = fullLobby();
    expect(room.hostId).toBe(players[0]!.playerId);
    expect(room.players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
  });

  it("rejects a fifth player and bad names", () => {
    const { room } = fullLobby();
    expect(errorOf(send(room, null, { type: "HELLO", name: "Eva" }))).toBe("ROOM_FULL");
    expect(errorOf(send(createRoom("X", clock), null, { type: "HELLO", name: "   " }))).toBe("INVALID_NAME");
  });

  it("only host can start, and only with 4 ready players", () => {
    const { room, players } = fullLobby();
    expect(errorOf(send(room, players[1]!.playerId, { type: "START" }))).toBe("NOT_HOST");
    const notReady = send(room, players[2]!.playerId, { type: "SET_READY", ready: false }).room;
    expect(errorOf(send(notReady, players[0]!.playerId, { type: "START" }))).toBe("NOT_ALL_READY");
  });

  it("seat changes: cannot take an occupied seat", () => {
    const { room, players } = fullLobby();
    expect(errorOf(send(room, players[0]!.playerId, { type: "TAKE_SEAT", seat: 1 }))).toBe("SEAT_TAKEN");
  });

  it("settings: host only, validated, reset ready", () => {
    const { room, players } = fullLobby();
    expect(errorOf(send(room, players[1]!.playerId, { type: "UPDATE_SETTINGS", settings: { targetRisks: 7 } }))).toBe(
      "NOT_HOST",
    );
    expect(errorOf(send(room, players[0]!.playerId, { type: "UPDATE_SETTINGS", settings: { targetRisks: 5 } }))).toBe(
      "INVALID_MESSAGE",
    );
    const o = send(room, players[0]!.playerId, { type: "UPDATE_SETTINGS", settings: { targetRisks: 7 } });
    expect(o.room.settings.targetRisks).toBe(7);
    expect(o.room.players.every((p) => !p.ready)).toBe(true);
  });

  it("host can kick another player in the lobby; their token stops working", () => {
    const { room, players } = fullLobby();
    const o = send(room, players[0]!.playerId, { type: "KICK", playerId: players[2]!.playerId });
    expect(o.kickedPlayerId).toBe(players[2]!.playerId);
    expect(o.room.players.map((p) => p.id)).not.toContain(players[2]!.playerId);
    expect(o.room.players.some((p) => p.seat === 2)).toBe(false);
    const back = send(o.room, null, { type: "HELLO", name: "Carla", token: players[2]!.token });
    expect(welcome(back).playerId).not.toBe(players[2]!.playerId);
  });

  it("kick is host-only, lobby-only, not self, known player", () => {
    const { room, players } = fullLobby();
    expect(errorOf(send(room, players[1]!.playerId, { type: "KICK", playerId: players[2]!.playerId }))).toBe("NOT_HOST");
    expect(errorOf(send(room, players[0]!.playerId, { type: "KICK", playerId: players[0]!.playerId }))).toBe(
      "INVALID_MESSAGE",
    );
    expect(errorOf(send(room, players[0]!.playerId, { type: "KICK", playerId: "nobody" }))).toBe("PLAYER_NOT_FOUND");
    const { room: running, players: ps } = started();
    expect(errorOf(send(running, ps[0]!.playerId, { type: "KICK", playerId: ps[1]!.playerId }))).toBe(
      "MATCH_ALREADY_STARTED",
    );
  });

  it("leaving passes host to the next player", () => {
    const { room, players } = fullLobby();
    const o = send(room, players[0]!.playerId, { type: "LEAVE" });
    expect(o.close).toBe(true);
    expect(o.room.players).toHaveLength(3);
    expect(o.room.hostId).toBe(players[1]!.playerId);
  });
});

describe("match", () => {
  it("start locks the room: no joins, no seat or settings changes", () => {
    const { room, players } = started();
    expect(room.status).toBe("PLAYING");
    expect(errorOf(send(room, null, { type: "HELLO", name: "Eva" }))).toBe("MATCH_ALREADY_STARTED");
    expect(errorOf(send(room, players[1]!.playerId, { type: "TAKE_SEAT", seat: 0 }))).toBe("MATCH_ALREADY_STARTED");
    expect(
      errorOf(send(room, players[0]!.playerId, { type: "UPDATE_SETTINGS", settings: { targetRisks: 3 } })),
    ).toBe("MATCH_ALREADY_STARTED");
  });

  it("rejects stale versions (double clicks) and wrong turns", () => {
    const { room, players } = started();
    const s = room.sueca!;
    const turnPlayer = players[s.turnSeat]!.playerId;
    const cardId = s.hands[s.turnSeat]![0]!;
    const played = send(room, turnPlayer, { type: "PLAY_CARD", cardId, version: s.version });
    expect(errorOf(played)).toBeUndefined();
    expect(errorOf(send(played.room, turnPlayer, { type: "PLAY_CARD", cardId, version: s.version }))).toBe(
      "STALE_ACTION",
    );
    const other = players[(s.turnSeat + 2) % 4]!.playerId;
    const v = played.room.sueca!.version;
    const otherCard = played.room.sueca!.hands[(s.turnSeat + 2) % 4]![0]!;
    expect(errorOf(send(played.room, other, { type: "PLAY_CARD", cardId: otherCard, version: v }))).toBe(
      "NOT_YOUR_TURN",
    );
  });

  it("STATE for each player never contains another player's hand", () => {
    const { room, players } = started();
    const s = room.sueca!;
    const connected = new Set(players.map((p) => p.playerId));
    players.forEach((p, seat) => {
      const json = JSON.stringify(stateFor(room, p.playerId, connected, [], clock));
      for (let other = 0; other < 4; other++) {
        if (other === seat) continue;
        for (const id of s.hands[other]!) {
          if (id !== s.trumpCardId) expect(json).not.toContain(`"${id}"`);
        }
      }
      // Tokens are secret.
      for (const q of players) expect(json).not.toContain(q.token);
    });
  });

  it("reconnect with token restores the same player and seat", () => {
    const { room, players } = started();
    const o = send(room, null, { type: "HELLO", name: "whatever", token: players[2]!.token });
    expect(welcome(o).playerId).toBe(players[2]!.playerId);
    expect(o.bindPlayerId).toBe(players[2]!.playerId);
    const st = stateFor(o.room, players[2]!.playerId, new Set(), [], clock);
    expect(st.type === "STATE" && st.sueca?.mySeat).toBe(2);
    expect(st.type === "STATE" && st.sueca?.myHand).toEqual(room.sueca!.hands[2]);
  });

  it("an unknown token cannot join a running match", () => {
    const { room } = started();
    expect(errorOf(send(room, null, { type: "HELLO", name: "x", token: "forged" }))).toBe("MATCH_ALREADY_STARTED");
  });
});

describe("leaving mid-match", () => {
  it("pauses the game and opens the seat; timers stop", () => {
    const { room, players } = started();
    const o = send(room, players[1]!.playerId, { type: "LEAVE" });
    expect(o.close).toBe(true);
    expect(o.room.vacancies).toEqual([{ seat: 1, name: "Bruno" }]);
    expect(o.room.turnDeadline).toBeNull();
    expect(handleAlarm(o.room, deps())).toBeNull();
    const s = o.room.sueca!;
    const turnPlayer = players[s.turnSeat]!.playerId;
    if (s.turnSeat !== 1) {
      expect(errorOf(send(o.room, turnPlayer, { type: "PLAY_CARD", cardId: s.hands[s.turnSeat]![0]!, version: s.version }))).toBe(
        "GAME_PAUSED",
      );
    }
  });

  it("host leaving hands host to another human", () => {
    const { room, players } = started();
    const o = send(room, players[0]!.playerId, { type: "LEAVE" });
    expect(o.room.hostId).toBe(players[1]!.playerId);
  });

  it("only the host decides; bots fill every empty seat and play on their own", () => {
    const { room, players } = started();
    let r = send(room, players[1]!.playerId, { type: "LEAVE" }).room;
    r = send(r, players[3]!.playerId, { type: "LEAVE" }).room;
    expect(r.vacancies).toHaveLength(2);
    expect(errorOf(send(r, players[2]!.playerId, { type: "REPLACE_WITH_BOT" }))).toBe("NOT_HOST");

    r = send(r, players[0]!.playerId, { type: "REPLACE_WITH_BOT" }).room;
    expect(r.vacancies).toEqual([]);
    const bots = r.players.filter((p) => p.bot);
    expect(bots.map((p) => p.seat).sort()).toEqual([1, 3]);
    expect(bots[0]!.name).toBe("Bot Bruno");

    // Humans at seats 0 and 2 never act: auto-play for them, bot moves for 1 and 3.
    let guard = 0;
    while (r.sueca!.phase === "PLAYING" && guard++ < 100) {
      const seat = r.sueca!.turnSeat;
      const expected = seat === 1 || seat === 3 ? clock + 1200 : clock + 30_000;
      expect(r.turnDeadline! - clock).toBeLessThanOrEqual(expected - clock + 1500);
      clock = r.turnDeadline!;
      r = handleAlarm(r, deps())!.room;
    }
    expect(r.sueca!.phase).not.toBe("PLAYING");
    expect(r.players.filter((p) => p.bot).every((p) => p.continued)).toBe(true);
  });

  it("end match sends everyone back to the lobby; bots stay ready", () => {
    const { room, players } = started();
    let r = send(room, players[2]!.playerId, { type: "LEAVE" }).room;
    expect(errorOf(send(r, players[1]!.playerId, { type: "END_MATCH" }))).toBe("NOT_HOST");
    r = send(r, players[0]!.playerId, { type: "END_MATCH" }).room;
    expect(r.status).toBe("LOBBY");
    expect(r.sueca).toBeNull();
    expect(r.vacancies).toEqual([]);
    expect(r.players).toHaveLength(3);
  });

  it("bot and host actions need a vacancy", () => {
    const { room, players } = started();
    expect(errorOf(send(room, players[0]!.playerId, { type: "REPLACE_WITH_BOT" }))).toBe("NO_VACANCY");
    expect(errorOf(send(room, players[0]!.playerId, { type: "END_MATCH" }))).toBe("NO_VACANCY");
  });
});

describe("cheap rejections", () => {
  it("rejected or repeated actions return the same room object (no storage write)", () => {
    const { room, players } = started();
    const s = room.sueca!;
    const other = players[(s.turnSeat + 1) % 4]!.playerId;
    expect(send(room, other, { type: "PLAY_CARD", cardId: "AH", version: s.version }).room).toBe(room);
    expect(send(room, players[0]!.playerId, { type: "CONTINUE" }).room).toBe(room);
    const lobby = fullLobby();
    expect(send(lobby.room, lobby.players[0]!.playerId, { type: "SET_READY", ready: true }).room).toBe(lobby.room);
  });
});

describe("timers", () => {
  it("turn timeout auto-plays the lowest legal card", () => {
    const { room } = started();
    const s = room.sueca!;
    expect(room.turnDeadline).toBe(clock + 30_000);
    expect(nextAlarmAt(room, clock)).toBe(room.turnDeadline);

    clock += 29_000;
    expect(handleAlarm(room, deps())).toBeNull();

    clock += 1_000;
    const o = handleAlarm(room, deps())!;
    const expected = sueca.autoPlayCardId(s);
    expect(o.events[0]).toEqual({ type: "CARD_PLAYED", seat: s.turnSeat, cardId: expected });
    expect(o.room.turnDeadline).toBe(clock + 30_000);
  });

  it("timer off: no turn deadline", () => {
    const { room, players } = fullLobby();
    let r = send(room, players[0]!.playerId, { type: "UPDATE_SETTINGS", settings: { turnTimerSeconds: 0 } }).room;
    for (const p of players) r = send(r, p.playerId, { type: "SET_READY", ready: true }).room;
    r = send(r, players[0]!.playerId, { type: "START" }).room;
    expect(r.turnDeadline).toBeNull();
  });

  it("auto-play alone finishes a hand; result screen then deals next hand", () => {
    let { room } = started();
    while (room.sueca!.phase === "PLAYING") {
      clock = room.turnDeadline!;
      room = handleAlarm(room, deps())!.room;
    }
    expect(room.sueca!.phase).toBe("HAND_RESULT");
    expect(room.continueDeadline).toBe(clock + 15_000);
    clock = room.continueDeadline!;
    room = handleAlarm(room, deps())!.room;
    expect(room.sueca!.phase).toBe("PLAYING");
    expect(room.sueca!.handNumber).toBe(2);
  });

  it("all players pressing continue deals the next hand early", () => {
    let { room, players } = started();
    while (room.sueca!.phase === "PLAYING") {
      clock = room.turnDeadline!;
      room = handleAlarm(room, deps())!.room;
    }
    for (const p of players.slice(0, 3)) room = send(room, p.playerId, { type: "CONTINUE" }).room;
    expect(room.sueca!.phase).toBe("HAND_RESULT");
    room = send(room, players[3]!.playerId, { type: "CONTINUE" }).room;
    expect(room.sueca!.phase).toBe("PLAYING");
  });

  it("idle rooms close connections after 20 min, with the alarm set for it", () => {
    const room = createRoom("ABCDEF", clock);
    expect(nextAlarmAt(room, clock)).toBe(clock + IDLE_CLOSE_MS);
    expect(isIdle(room, clock + IDLE_CLOSE_MS - 1)).toBe(false);
    expect(isIdle(room, clock + IDLE_CLOSE_MS)).toBe(true);
    expect(nextAlarmAt(room, clock + IDLE_CLOSE_MS)).toBe(clock + ROOM_TTL_MS);
  });

  it("a running turn timer is never idle", () => {
    const { room } = started();
    expect(isIdle(room, clock + IDLE_CLOSE_MS * 10)).toBe(false);
  });

  it("idle rooms expire after 24h", () => {
    const room = createRoom("ABCDEF", clock);
    expect(isExpired(room, clock + ROOM_TTL_MS - 1)).toBe(false);
    expect(isExpired(room, clock + ROOM_TTL_MS)).toBe(true);
  });
});

describe("parseClientMessage", () => {
  it("accepts valid messages and rejects junk", () => {
    expect(parseClientMessage('{"type":"PLAY_CARD","cardId":"AH","version":3}')).toEqual({
      type: "PLAY_CARD",
      cardId: "AH",
      version: 3,
    });
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage('{"type":"PLAY_CARD","cardId":5,"version":3}')).toBeNull();
    expect(parseClientMessage('{"type":"HACK"}')).toBeNull();
    expect(parseClientMessage('{"type":"TAKE_SEAT","seat":1.5}')).toBeNull();
    expect(parseClientMessage("x".repeat(5000))).toBeNull();
  });
});
