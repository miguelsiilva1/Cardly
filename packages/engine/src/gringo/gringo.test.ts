import { describe, expect, it } from "vitest";
import { seededRng } from "../shared/rng";
import {
  botTurn,
  callGringo,
  card,
  cardValue,
  chooseAbilityTarget,
  closeWindow,
  createDeck,
  createGame,
  createGameFromDeck,
  decideBlackKing,
  DEFAULT_GRINGO_RULES,
  discardDrawn,
  draw,
  matchDiscard,
  matches,
  nextRound,
  ownerOf,
  peek,
  randomPeekSlots,
  swapDrawn,
  timeout,
  useAbility,
  viewFor,
  type GringoState,
} from ".";

const rules = DEFAULT_GRINGO_RULES;

function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(`Rejected: ${r.error}`);
  return r.value;
}

function errorOf(r: { ok: boolean; error?: string }): string | undefined {
  return r.ok ? undefined : r.error;
}

/**
 * A round already in play with the given cards. `hands[seat]` get slot ids
 * `a0..a3` for seat 0, `b0..` for seat 1, and so on. `draws` are the next
 * cards drawn, in order. Nobody knows anything yet.
 */
function setup(hands: string[][], draws: string[] = [], first = 0): GringoState {
  const s = createGameFromDeck(rules, hands.length, first, createDeck().map((c) => c.id));
  const letters = "abcdef";
  s.hands = hands.map((h, seat) => h.map((cardId, i) => ({ id: `${letters[seat]}${i}`, cardId })));
  s.drawPile = [...draws].reverse();
  s.knownTo = {};
  for (const id of [...hands.flat(), ...draws]) s.knownTo[id] = [];
  s.phase = "PLAYING";
  s.peeked = hands.map(() => true);
  return s;
}

/** Cards this seat is shown right now: slotId → cardId. */
function shown(state: GringoState, seat: number): Record<string, string> {
  const g = viewFor(state, seat).glimpse;
  return Object.fromEntries(g?.cards.map((c) => [c.slotId, c.cardId]) ?? []);
}

const FILLER = ["10C", "10D", "10H", "10S", "6C", "6D", "6H", "6S"];

/** Draw + discard for the player on turn, then close the window. */
function passTurn(s: GringoState): GringoState {
  s = must(draw(s, s.turnSeat));
  s = must(discardDrawn(s, s.turnSeat));
  return closeWindow(s, s.window!.eventId);
}

describe("deck and values", () => {
  it("has 52 cards plus 2 Jokers, all ids unique", () => {
    const ids = createDeck().map((c) => c.id);
    expect(ids).toHaveLength(54);
    expect(new Set(ids).size).toBe(54);
    expect(ids.filter((id) => card(id).rank === "JOKER")).toHaveLength(2);
  });

  it("scores A=1, 2–10 face value, J/Q/black K=13, red K=−2, Joker=0", () => {
    expect(cardValue("AS")).toBe(1);
    for (let n = 2; n <= 10; n++) expect(cardValue(`${n}H`)).toBe(n);
    expect(cardValue("JH")).toBe(13);
    expect(cardValue("QD")).toBe(13);
    expect(cardValue("KS")).toBe(13);
    expect(cardValue("KC")).toBe(13);
    expect(cardValue("KH")).toBe(-2);
    expect(cardValue("KD")).toBe(-2);
    expect(cardValue("X1")).toBe(0);
  });

  it("gives abilities only to Queens, Jacks and black Kings", () => {
    expect(card("QH").ability).toBe("QUEEN");
    expect(card("JC").ability).toBe("JACK");
    expect(card("KS").ability).toBe("BLACK_KING");
    expect(card("KH").ability).toBeNull();
    expect(card("X2").ability).toBeNull();
    expect(card("AS").ability).toBeNull();
  });

  it("matches same rank any suit, Kings by colour, Jokers together", () => {
    expect(matches("7H", "7S")).toBe(true);
    expect(matches("7H", "8H")).toBe(false);
    expect(matches("QH", "QS")).toBe(true);
    expect(matches("KH", "KD")).toBe(true);
    expect(matches("KS", "KC")).toBe(true);
    expect(matches("KH", "KS")).toBe(false);
    expect(matches("X1", "X2")).toBe(true);
    expect(matches("X1", "AS")).toBe(false);
  });
});

describe("setup and peek", () => {
  it("deals 4 hidden cards each and starts in the peek phase", () => {
    const s = createGame(rules, 5, seededRng(3));
    expect(s.phase).toBe("PEEK");
    expect(s.hands.every((h) => h.length === 4)).toBe(true);
    expect(s.drawPile).toHaveLength(54 - 20);
    expect(s.discard).toHaveLength(0);
    for (let seat = 0; seat < 5; seat++) {
      expect(viewFor(s, seat).hands.flat().every((x) => x.cardId === null)).toBe(true);
    }
  });

  it("each player sees exactly the 2 cards they picked, nobody else does", () => {
    let s = createGame(rules, 3, seededRng(4));
    const pick = s.hands[1]!.slice(1, 3).map((x) => x.id);
    s = must(peek(s, 1, pick));
    expect(Object.keys(shown(s, 1))).toEqual(pick);
    expect(shown(s, 0)).toEqual({});
    expect(shown(s, 2)).toEqual({});
    expect(viewFor(s, 1).hands.flat().every((x) => x.cardId === null)).toBe(true);
  });

  it("shows peeked cards once: the next change turns them face down again", () => {
    let s = createGame(rules, 3, seededRng(4));
    s = must(peek(s, 1, s.hands[1]!.slice(0, 2).map((x) => x.id)));
    expect(Object.keys(shown(s, 1))).toHaveLength(2);
    s = must(peek(s, 0, s.hands[0]!.slice(0, 2).map((x) => x.id)));
    expect(shown(s, 1)).toEqual({});
    expect(s.knownTo[s.hands[1]![0]!.cardId]).toContain(1);
  });

  it("rejects peeking twice, at other players' cards, or at the wrong number", () => {
    let s = createGame(rules, 3, seededRng(5));
    const [a, b, c] = s.hands[0]!.map((x) => x.id);
    expect(errorOf(peek(s, 0, [a!]))).toBe("INVALID_PEEK");
    expect(errorOf(peek(s, 0, [a!, a!]))).toBe("INVALID_PEEK");
    expect(errorOf(peek(s, 0, [a!, s.hands[1]![0]!.id]))).toBe("NOT_YOUR_CARD");
    s = must(peek(s, 0, [a!, b!]));
    expect(errorOf(peek(s, 0, [b!, c!]))).toBe("ALREADY_PEEKED");
  });

  it("starts play once everyone has peeked; the timer peeks at random for the rest", () => {
    let s = createGame(rules, 3, seededRng(6));
    s = must(peek(s, 0, s.hands[0]!.slice(0, 2).map((x) => x.id)));
    expect(s.phase).toBe("PEEK");
    s = timeout(s, seededRng(1));
    expect(s.phase).toBe("PLAYING");
    expect(Object.keys(shown(s, 0))).toHaveLength(0);
    expect(Object.keys(shown(s, 1))).toHaveLength(2);
    expect(Object.keys(shown(s, 2))).toHaveLength(2)
  });

  it("rotates the first player to the right each round", () => {
    const rng = seededRng(7);
    let s = createGame(rules, 4, rng);
    const first = s.firstSeat;
    s = { ...s, phase: "ROUND_RESULT" };
    const next = must(nextRound(s, rng));
    expect(next.firstSeat).toBe((first + 1) % 4);
    expect(next.turnSeat).toBe(next.firstSeat);
    expect(next.roundNumber).toBe(2);
  });
});

describe("normal turn", () => {
  const hands = [
    ["AS", "2S", "3S", "4S"],
    ["AH", "2H", "3H", "4H"],
    ["AD", "2D", "3D", "4D"],
  ];

  it("only the player on turn can draw, and only they see the drawn card", () => {
    let s = setup(hands, ["9C", ...FILLER]);
    expect(errorOf(draw(s, 1))).toBe("NOT_YOUR_TURN");
    s = must(draw(s, 0));
    expect(viewFor(s, 0).drawn).toBe("9C");
    expect(viewFor(s, 1).drawn).toBeNull();
    expect(viewFor(s, 1).hasDrawn).toBe(true);
    expect(JSON.stringify(viewFor(s, 1))).not.toContain("9C");
    expect(errorOf(draw(s, 0))).toBe("ALREADY_DREW");
  });

  it("discarding the drawn card passes the turn right and locks the next draw", () => {
    let s = setup(hands, ["9C", ...FILLER]);
    s = must(draw(s, 0));
    s = must(discardDrawn(s, 0));
    expect(s.discard.at(-1)).toBe("9C");
    expect(s.turnSeat).toBe(1);
    expect(errorOf(draw(s, 1))).toBe("DRAW_LOCKED");
    s = closeWindow(s, s.window!.eventId);
    expect(s.drawn).toBeNull();
    s = must(draw(s, 1));
    expect(s.drawn).toBe(FILLER[0]);
  });

  it("swapping puts the drawn card in the slot (known to me) and discards the old card", () => {
    let s = setup(hands, ["9C", ...FILLER]);
    s = must(draw(s, 0));
    s = must(swapDrawn(s, 0, "a2"));
    expect(s.hands[0]!.find((x) => x.id === "a2")!.cardId).toBe("9C");
    expect(s.discard.at(-1)).toBe("3S");
    expect(s.knownTo["9C"]).toEqual([0]);
    expect(viewFor(s, 0).hands[0]![2]!.cardId).toBeNull();
  });

  it("cannot discard or swap before drawing, or swap into someone else's slot", () => {
    let s = setup(hands, ["9C", ...FILLER]);
    expect(errorOf(discardDrawn(s, 0))).toBe("MUST_DRAW_FIRST");
    s = must(draw(s, 0));
    expect(errorOf(swapDrawn(s, 0, "b0"))).toBe("NOT_YOUR_CARD");
    expect(errorOf(swapDrawn(s, 0, "zz"))).toBe("NOT_YOUR_CARD");
  });

  it("timer expiry draws and discards with no ability", () => {
    let s = setup(hands, ["QC", ...FILLER]);
    s = timeout(s, seededRng(1));
    expect(s.discard.at(-1)).toBe("QC");
    expect(s.window!.owner).toBeNull();
    expect(s.turnSeat).toBe(1);
  });

  it("ends the round when the draw pile runs out", () => {
    let s = setup(hands, ["9C"]);
    s = passTurn(s);
    expect(s.phase).toBe("ROUND_RESULT");
    expect(s.result!.reason).toBe("PILE_EMPTY");
  });
});

describe("matching discard", () => {
  const hands = [
    ["7S", "2S", "3S", "4S"],
    ["7H", "2H", "3H", "4H"],
    ["7D", "8D", "3D", "4D"],
  ];

  function withTop(top: string, turn = 1): GringoState {
    let s = setup(hands, [top, ...FILLER]);
    s = must(draw(s, 0));
    s = must(discardDrawn(s, 0));
    expect(s.turnSeat).toBe(turn);
    return s;
  }

  it("accepts a match from any player, off turn, with no replacement card", () => {
    let s = withTop("7C");
    s = must(matchDiscard(s, 2, "c0", s.event!.id));
    expect(s.discard.at(-1)).toBe("7D");
    expect(s.hands[2]).toHaveLength(3);
    expect(s.event!.seat).toBe(2);
  });

  it("rejects the slower of two racing matches on the same event", () => {
    let s = withTop("7C");
    const eventId = s.event!.id;
    s = must(matchDiscard(s, 1, "b0", eventId));
    expect(errorOf(matchDiscard(s, 2, "c0", eventId))).toBe("MATCH_TOO_LATE");
  });

  it("allows one attempt per player per discard event", () => {
    let s = withTop("7C");
    const eventId = s.event!.id;
    s = must(matchDiscard(s, 2, "c1", eventId)); // 8D on 7C: wrong
    expect(errorOf(matchDiscard(s, 2, "c0", eventId))).toBe("ALREADY_TRIED");
  });

  it("wrong match: card shown to all, stays, and a hidden penalty card is added", () => {
    let s = withTop("7C");
    const penalty = s.drawPile.at(-1)!;
    s = must(matchDiscard(s, 2, "c1", s.event!.id));
    expect(s.discard.at(-1)).toBe("7C");
    expect(s.hands[2]).toHaveLength(5);
    expect(s.hands[2]!.find((x) => x.id === "c1")!.cardId).toBe("8D");
    for (let seat = 0; seat < 3; seat++) expect(shown(s, seat)).toEqual({ c1: "8D" });
    expect(JSON.stringify(viewFor(s, 2))).not.toContain(`"${penalty}"`);
  });

  it("a player who matches away their last card wins at once", () => {
    let s = setup(
      [["2S", "3S", "4S", "5S"], ["7H"], ["AD", "2D", "3D", "4D"]],
      ["7C", ...FILLER],
    );
    s = must(draw(s, 0));
    s = must(discardDrawn(s, 0));
    s = must(matchDiscard(s, 1, "b0", s.event!.id));
    expect(s.phase).toBe("ROUND_RESULT");
    expect(s.result!.reason).toBe("EMPTY_HAND");
    expect(s.result!.winners).toEqual([1]);
  });

  it("rejects matching someone else's card and a stale event id", () => {
    const s = withTop("7C");
    expect(errorOf(matchDiscard(s, 2, "b0", s.event!.id))).toBe("NOT_YOUR_CARD");
    expect(errorOf(matchDiscard(s, 2, "c0", s.event!.id - 1))).toBe("MATCH_TOO_LATE");
  });

  it("a matched special card gives its ability to whoever placed it last", () => {
    let s = setup(
      [["2S", "3S", "4S", "5S"], ["QH", "2H", "3H", "4H"], ["QD", "2D", "3D", "4D"]],
      ["QC", ...FILLER],
    );
    s = must(draw(s, 0));
    s = must(discardDrawn(s, 0));
    expect(s.window!.owner).toBe(0);
    s = must(matchDiscard(s, 1, "b0", s.event!.id));
    expect(s.window!.owner).toBe(1);
    s = must(matchDiscard(s, 2, "c0", s.event!.id));
    expect(s.window!.owner).toBe(2);
    expect(errorOf(useAbility(s, 1, s.event!.id))).toBe("NO_ABILITY");
    s = must(useAbility(s, 2, s.event!.id));
    expect(s.ability!.seat).toBe(2);
  });
});

describe("Queen", () => {
  function queenReady(): GringoState {
    let s = setup([["2S", "3S", "4S", "5S"], ["AH", "2H", "3H", "4H"], ["AD", "2D", "3D", "4D"]], ["QC", ...FILLER]);
    s = must(draw(s, 0));
    s = must(discardDrawn(s, 0));
    return must(useAbility(s, 0, s.event!.id));
  }

  it("reveals one own card only to the Queen's user; the Queen stays on the discard pile", () => {
    let s = queenReady();
    s = must(chooseAbilityTarget(s, 0, "a3", null));
    expect(shown(s, 0)).toEqual({ a3: "5S" });
    expect(shown(s, 1)).toEqual({});
    expect(shown(s, 2)).toEqual({});
    expect(s.discard.at(-1)).toBe("QC");
    expect(s.hands[0]!.map((x) => x.cardId)).not.toContain("QC");
    expect(s.ability).toBeNull();
  });

  it("cannot look at another player's card", () => {
    const s = queenReady();
    expect(errorOf(chooseAbilityTarget(s, 0, "b0", null))).toBe("NOT_YOUR_CARD");
  });

  it("a Queen already in hand gives no ability, even when known", () => {
    let s = setup([["QS", "3S", "4S", "5S"], ["AH", "2H", "3H", "4H"], ["AD", "2D", "3D", "4D"]], ["9C", ...FILLER]);
    s.knownTo["QS"] = [0];
    s = must(draw(s, 0));
    s = must(discardDrawn(s, 0));
    expect(s.window!.owner).toBeNull();
    expect(errorOf(useAbility(s, 0, s.event!.id))).toBe("NO_ABILITY");
  });

  it("a Queen swapped out for a drawn card gives its ability", () => {
    let s = setup([["QS", "3S", "4S", "5S"], ["AH", "2H", "3H", "4H"], ["AD", "2D", "3D", "4D"]], ["9C", ...FILLER]);
    s = must(draw(s, 0));
    s = must(swapDrawn(s, 0, "a0"));
    expect(s.window!.owner).toBe(0);
  });

  it("the ability is lost when the window closes", () => {
    let s = setup([["2S", "3S", "4S", "5S"], ["AH", "2H", "3H", "4H"], ["AD", "2D", "3D", "4D"]], ["QC", ...FILLER]);
    s = must(draw(s, 0));
    s = must(discardDrawn(s, 0));
    const eventId = s.event!.id;
    s = closeWindow(s, eventId);
    expect(errorOf(useAbility(s, 0, eventId))).toBe("NO_ABILITY");
  });

  it("blocks the next draw while the ability resolves; the ability timer cancels it", () => {
    let s = queenReady();
    expect(errorOf(draw(s, 1))).toBe("ABILITY_IN_PROGRESS");
    s = timeout(s, seededRng(1));
    expect(s.ability).toBeNull();
    s = must(draw(s, 1));
    expect(s.drawn).not.toBeNull();
  });
});

describe("Jack", () => {
  function jackReady(): GringoState {
    let s = setup([["2S", "3S", "4S", "5S"], ["AH", "2H", "3H", "4H"], ["AD", "2D", "3D", "4D"]], ["JC", ...FILLER]);
    s.knownTo["2S"] = [0];
    s.knownTo["3H"] = [1];
    s = must(draw(s, 0));
    s = must(discardDrawn(s, 0));
    return must(useAbility(s, 0, s.event!.id));
  }

  it("swaps blind with any other player; nobody learns a new card", () => {
    let s = jackReady();
    s = must(chooseAbilityTarget(s, 0, "a0", "b2"));
    expect(s.hands[0]![0]!.cardId).toBe("3H");
    expect(s.hands[1]![2]!.cardId).toBe("2S");
    // Nothing is shown to anyone; knowledge follows the card.
    for (let seat = 0; seat < 3; seat++) expect(shown(s, seat)).toEqual({});
    expect(s.knownTo["2S"]).toEqual([0]);
    expect(s.knownTo["3H"]).toEqual([1]);
  });

  it("needs one own slot and one other player's slot", () => {
    const s = jackReady();
    expect(errorOf(chooseAbilityTarget(s, 0, "a0", null))).toBe("INVALID_TARGET");
    expect(errorOf(chooseAbilityTarget(s, 0, "a0", "a1"))).toBe("INVALID_TARGET");
    expect(errorOf(chooseAbilityTarget(s, 0, "b0", "c0"))).toBe("NOT_YOUR_CARD");
    expect(errorOf(chooseAbilityTarget(s, 1, "b0", "a0"))).toBe("NO_ABILITY");
  });
});

describe("black King", () => {
  function kingLooking(): GringoState {
    let s = setup([["2S", "3S", "4S", "5S"], ["AH", "2H", "3H", "4H"], ["AD", "2D", "3D", "4D"]], ["KC", ...FILLER]);
    s = must(draw(s, 0));
    s = must(discardDrawn(s, 0));
    s = must(useAbility(s, 0, s.event!.id));
    return must(chooseAbilityTarget(s, 0, "a1", "c3"));
  }

  it("shows the target card only to the King's user", () => {
    const s = kingLooking();
    expect(viewFor(s, 0).ability!.seenCardId).toBe("4D");
    expect(viewFor(s, 1).ability!.seenCardId).toBeNull();
    expect(viewFor(s, 2).ability!.seenCardId).toBeNull();
    expect(JSON.stringify(viewFor(s, 1))).not.toContain("4D");
    expect(JSON.stringify(viewFor(s, 2))).not.toContain("4D");
  });

  it("accept: cards swap, the user keeps the card they saw, the other player sees what they got", () => {
    let s = kingLooking();
    s = must(decideBlackKing(s, 0, true));
    expect(s.hands[0]![1]!.cardId).toBe("4D");
    expect(s.hands[2]![3]!.cardId).toBe("3S");
    expect(s.knownTo["4D"]).toContain(0);
    expect(shown(s, 2)).toEqual({ c3: "3S" });
    expect(shown(s, 1)).toEqual({});
    expect(s.ability).toBeNull();
  });

  it("decline: nothing moves and the viewed card goes back to hidden", () => {
    let s = kingLooking();
    s = must(decideBlackKing(s, 0, false));
    expect(s.hands[0]![1]!.cardId).toBe("3S");
    expect(s.hands[2]![3]!.cardId).toBe("4D");
    expect(s.knownTo["4D"]).not.toContain(0);
    expect(viewFor(s, 0).ability).toBeNull();
  });

  it("a red King has no ability", () => {
    let s = setup([["2S", "3S", "4S", "5S"], ["AH", "2H", "3H", "4H"], ["AD", "2D", "3D", "4D"]], ["KH", ...FILLER]);
    s = must(draw(s, 0));
    s = must(discardDrawn(s, 0));
    expect(s.window!.owner).toBeNull();
  });

  it("only the user can decide", () => {
    const s = kingLooking();
    expect(errorOf(decideBlackKing(s, 1, true))).toBe("NO_ABILITY");
  });
});

describe("Gringo", () => {
  const hands = [
    ["AS", "2S", "3S", "4S"],
    ["KH", "2H", "3H", "4H"],
    ["AD", "2D", "3D", "4D"],
    ["AC", "2C", "3C", "4C"],
  ];
  const draws = ["9H", "9D", "9S", "8H", "8D", "8S", "7H", "7D"];

  it("the caller's call is their turn; everyone else plays once more, then the round ends", () => {
    let s = setup(hands, draws);
    s = passTurn(s); // seat 0
    s = passTurn(s); // seat 1
    expect(s.turnSeat).toBe(2);
    s = must(callGringo(s, 2));
    expect(s.caller).toBe(2);
    expect(s.phase).toBe("PLAYING");
    expect(s.turnSeat).toBe(3);
    const turns: number[] = [];
    while (s.phase === "PLAYING") {
      turns.push(s.turnSeat);
      s = passTurn(s);
    }
    expect(turns).toEqual([3, 0, 1]);
    expect(s.result!.reason).toBe("GRINGO");
    expect(s.result!.caller).toBe(2);
  });

  it("called during someone else's turn, that turn and the rest of the cycle still play", () => {
    let s = setup(hands, draws);
    s = must(draw(s, 0));
    s = must(callGringo(s, 2));
    s = must(discardDrawn(s, 0));
    s = closeWindow(s, s.window!.eventId);
    expect(s.turnSeat).toBe(1);
    s = passTurn(s);
    expect(s.phase).toBe("ROUND_RESULT");
  });

  it("only one call per round; the caller can still match", () => {
    let s = setup(hands, ["KD", ...draws]);
    s = must(callGringo(s, 1));
    expect(errorOf(callGringo(s, 3))).toBe("GRINGO_ALREADY_CALLED");
    s = must(draw(s, 0));
    s = must(discardDrawn(s, 0));
    s = must(matchDiscard(s, 1, "b0", s.event!.id));
    expect(s.hands[1]).toHaveLength(3);
  });

  it("reveals every card at the end, with totals and ties", () => {
    let s = setup(
      [["AS", "2S"], ["3H"], ["KH", "5D"], ["2C", "AC"]],
      ["10H", ...draws],
    );
    s = must(callGringo(s, 0));
    while (s.phase === "PLAYING") s = passTurn(s);
    const r = s.result!;
    expect(r.totals).toEqual([3, 3, 3, 3]);
    expect(r.winners).toEqual([0, 1, 2, 3]);
    for (let seat = 0; seat < 4; seat++) {
      expect(viewFor(s, seat).hands.flat().every((x) => x.cardId !== null)).toBe(true);
    }
  });

  it("lowest total wins; red Kings count −2", () => {
    let s = setup([["KH", "KD", "AS"], ["2H"], ["AD", "AC"]], ["9H", "9D", "9S"]);
    s = must(callGringo(s, 0));
    while (s.phase === "PLAYING") s = passTurn(s);
    expect(s.result!.totals).toEqual([-3, 2, 2]);
    expect(s.result!.winners).toEqual([0]);
  });

  it("rejects everything once the round is over", () => {
    let s = setup(hands, ["9H"]);
    s = passTurn(s);
    expect(s.phase).toBe("ROUND_RESULT");
    expect(errorOf(draw(s, 1))).toBe("ROUND_NOT_ACTIVE");
    expect(errorOf(callGringo(s, 1))).toBe("ROUND_NOT_ACTIVE");
    expect(errorOf(matchDiscard(s, 1, "b0", s.event!.id))).toBe("ROUND_NOT_ACTIVE");
  });
});

describe("views never leak", () => {
  it("across full random rounds, a player sees only cards they are allowed to know", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = seededRng(seed);
      const n = 3 + (seed % 4);
      let s = createGame(rules, n, rng);
      for (let seat = 0; seat < n; seat++) s = must(peek(s, seat, randomPeekSlots(s, seat, rng)));
      let steps = 0;
      while (s.phase === "PLAYING" && steps++ < 500) {
        if (s.window) s = closeWindow(s, s.window.eventId);
        else s = botTurn(s);
        if (seed % 5 === 0 && steps === 20 && s.caller === null) s = must(callGringo(s, (s.turnSeat + 2) % n));
        if (s.phase !== "PLAYING") break;
        for (let seat = 0; seat < n; seat++) {
          const v = viewFor(s, seat);
          const json = JSON.stringify(v);
          for (const id of s.drawPile) expect(json).not.toContain(`"${id}"`);
          for (let other = 0; other < n; other++) {
            for (const x of s.hands[other]!) {
              const shown = v.hands[other]!.find((y) => y.id === x.id)!.cardId;
              if (shown !== null) expect(s.knownTo[x.cardId]).toContain(seat);
            }
          }
        }
      }
      expect(s.phase).toBe("ROUND_RESULT");
    }
  });

  it("ownerOf finds the seat of a slot", () => {
    const s = setup([["AS"], ["AH"], ["AD"]]);
    expect(ownerOf(s, "b0")).toBe(1);
    expect(ownerOf(s, "zz")).toBe(-1);
  });
});
