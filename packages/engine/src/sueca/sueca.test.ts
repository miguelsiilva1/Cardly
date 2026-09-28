import { describe, expect, it } from "vitest";
import { seededRng } from "../shared/rng";
import { createDeck, POINTS, RANKS } from "./cards";
import {
  autoPlayCardId,
  botCardId,
  calculateRiskAward,
  compareCards,
  createMatch,
  dealCards,
  determineTrickWinner,
  getFirstPlayer,
  getLegalCards,
  getNextDealer,
  isMatchOver,
  playCard,
  startNextHand,
  teamOf,
  type SuecaState,
  type TeamScore,
} from "./engine";
import { DEFAULT_SUECA_RULES, type SuecaRules } from "./rules";
import { viewFor } from "./view";

const rules = DEFAULT_SUECA_RULES;

function mustPlay(state: SuecaState, seat: number, cardId: string): SuecaState {
  const r = playCard(state, seat, cardId);
  if (!r.ok) throw new Error(`${seat} ${cardId}: ${r.error}`);
  return r.value.state;
}

/** Plays out the current hand choosing random legal cards. */
function playOutHand(state: SuecaState, rng: () => number): SuecaState {
  let s = state;
  while (s.phase === "PLAYING") {
    const legal = getLegalCards(s.hands[s.turnSeat]!, s.trick.ledSuit);
    s = mustPlay(s, s.turnSeat, legal[Math.floor(rng() * legal.length)]!);
  }
  return s;
}

describe("deck", () => {
  const deck = createDeck();
  it("has 40 unique cards, 10 per suit, no 8/9/10", () => {
    expect(deck).toHaveLength(40);
    expect(new Set(deck.map((c) => c.id)).size).toBe(40);
    for (const suit of ["hearts", "diamonds", "clubs", "spades"]) {
      expect(deck.filter((c) => c.suit === suit)).toHaveLength(10);
    }
    expect(deck.some((c) => ["8", "9", "10"].includes(c.rank))).toBe(false);
  });
  it("totals 120 points", () => {
    expect(deck.reduce((s, c) => s + c.points, 0)).toBe(120);
  });
  it("uses Sueca point values", () => {
    expect(POINTS).toEqual({ A: 11, "7": 10, K: 4, J: 3, Q: 2, "6": 0, "5": 0, "4": 0, "3": 0, "2": 0 });
  });
  it("ranks A > 7 > K > J > Q > 6 > 5 > 4 > 3 > 2", () => {
    const hearts = deck.filter((c) => c.suit === "hearts").sort((a, b) => b.strength - a.strength);
    expect(hearts.map((c) => c.rank)).toEqual([...RANKS]);
  });
});

describe("compareCards / trick winner", () => {
  it("2 of trump beats Ace of non-trump", () => {
    expect(compareCards("2S", "AH", "hearts", "spades")).toBeGreaterThan(0);
  });
  it("7 of trump beats Ace of non-trump", () => {
    expect(compareCards("7S", "AH", "hearts", "spades")).toBeGreaterThan(0);
  });
  it("Ace of trump beats 7 of trump", () => {
    expect(compareCards("AS", "7S", "hearts", "spades")).toBeGreaterThan(0);
  });
  it("Ace beats 7, 7 beats King, Jack beats Queen in the same suit", () => {
    expect(compareCards("AH", "7H", "hearts", "spades")).toBeGreaterThan(0);
    expect(compareCards("7H", "KH", "hearts", "spades")).toBeGreaterThan(0);
    expect(compareCards("JH", "QH", "hearts", "spades")).toBeGreaterThan(0);
  });
  it("off-suit non-trump card cannot beat led suit", () => {
    expect(compareCards("AC", "2H", "hearts", "spades")).toBeLessThan(0);
    const winner = determineTrickWinner(
      [
        { seat: 0, cardId: "2H" },
        { seat: 1, cardId: "AC" },
        { seat: 2, cardId: "AD" },
        { seat: 3, cardId: "3H" },
      ],
      "spades",
    );
    expect(winner).toBe(3);
  });
  it("a single trump wins the trick", () => {
    const winner = determineTrickWinner(
      [
        { seat: 0, cardId: "AH" },
        { seat: 1, cardId: "2S" },
        { seat: 2, cardId: "7H" },
        { seat: 3, cardId: "KH" },
      ],
      "spades",
    );
    expect(winner).toBe(1);
  });
  it("highest of two trumps wins", () => {
    const winner = determineTrickWinner(
      [
        { seat: 0, cardId: "AH" },
        { seat: 1, cardId: "KS" },
        { seat: 2, cardId: "7S" },
        { seat: 3, cardId: "2H" },
      ],
      "spades",
    );
    expect(winner).toBe(2);
  });
});

describe("legal cards", () => {
  it("case 1: must follow led suit when holding it", () => {
    expect(getLegalCards(["AC", "7S", "3H"], "hearts")).toEqual(["3H"]);
  });
  it("case 2: any card when void in led suit", () => {
    expect(getLegalCards(["AC", "7S", "5D"], "hearts")).toEqual(["AC", "7S", "5D"]);
  });
  it("no forced trump: trump and non-trump both legal when void", () => {
    const legal = getLegalCards(["2S", "KC", "5D"], "hearts");
    expect(legal).toContain("2S");
    expect(legal).toContain("KC");
  });
  it("leader may play anything", () => {
    expect(getLegalCards(["AC", "7S", "3H"], null)).toHaveLength(3);
  });
});

describe("scoring", () => {
  const score = (a: number, tricksA = 5, r: SuecaRules = rules, carry = 0) =>
    calculateRiskAward({ A: a, B: 120 - a }, { A: tricksA, B: 10 - tricksA }, r, carry);

  it.each([
    [61, 1],
    [90, 1],
    [91, 2],
    [119, 2],
    [120, 4],
  ])("%i points → %i riscos", (pts, risks) => {
    expect(score(pts, 9).awarded).toEqual({ A: risks, B: 0 });
  });
  it("mirrors for team B", () => {
    expect(score(29).awarded).toEqual({ A: 0, B: 2 });
  });
  it("rejects totals other than 120", () => {
    expect(() => calculateRiskAward({ A: 60, B: 59 }, { A: 5, B: 5 }, rules)).toThrow();
  });
  it("case 9: 120 points with fewer than 10 tricks follows capote rule", () => {
    const def = score(120, 9);
    expect(def.capote).toBe("A");
    expect(def.bandeira).toBeNull();
    expect(def.awarded.A).toBe(4);
    const tenTricks = score(120, 9, { ...rules, capoteRule: "ALL_TEN_TRICKS" });
    expect(tenTricks.capote).toBeNull();
    expect(tenTricks.awarded.A).toBe(2);
  });
  it("case 10: 10 tricks and 120 points is bandeira + capote", () => {
    const r = score(120, 10);
    expect(r.capote).toBe("A");
    expect(r.bandeira).toBe("A");
  });
  it("bandeira is tracked from tricks, not points", () => {
    expect(score(119, 10).bandeira).toBe("A");
    expect(score(119, 10).capote).toBeNull();
  });
  it("case 11: 60–60 under each rule", () => {
    expect(score(60).awarded).toEqual({ A: 1, B: 1 });
    expect(score(60).tie).toBe(true);
    expect(score(60, 5, { ...rules, tieAt60Rule: "NO_POINTS" }).awarded).toEqual({ A: 0, B: 0 });
    const carried = score(60, 5, { ...rules, tieAt60Rule: "CARRY_TO_NEXT_HAND" });
    expect(carried.awarded).toEqual({ A: 0, B: 0 });
    expect(carried.carry).toBe(1);
    const next = score(70, 5, { ...rules, tieAt60Rule: "CARRY_TO_NEXT_HAND" }, carried.carry);
    expect(next.awarded).toEqual({ A: 2, B: 0 });
    expect(next.carry).toBe(0);
  });
});

describe("match end", () => {
  const over = (r: TeamScore) => isMatchOver(r, 4);
  it("ends when a team reaches the target", () => {
    expect(over({ A: 4, B: 2 })).toBe("A");
    expect(over({ A: 3, B: 3 })).toBeNull();
  });
  it("case 12: capote can end the match", () => {
    expect(over({ A: 0 + 4, B: 3 })).toBe("A");
  });
  it("continues when both reach the target level", () => {
    expect(over({ A: 4, B: 4 })).toBeNull();
    expect(over({ A: 5, B: 4 })).toBe("A");
  });
});

describe("dealing", () => {
  const deckIds = createDeck().map((c) => c.id);
  it("gives 10 cards each and the trump card (last) to the dealer", () => {
    const deal = dealCards(deckIds, 2);
    expect(deal.hands.map((h) => h.length)).toEqual([10, 10, 10, 10]);
    expect(deal.trumpCardId).toBe(deckIds[39]);
    expect(deal.hands[2]).toContain(deal.trumpCardId);
    expect(new Set(deal.hands.flat()).size).toBe(40);
  });
  it("first player is the dealer's right, dealer rotates", () => {
    expect(getFirstPlayer(3)).toBe(0);
    expect(getNextDealer(1)).toBe(2);
  });
  it("teammates sit opposite", () => {
    expect([0, 1, 2, 3].map(teamOf)).toEqual(["A", "B", "A", "B"]);
  });
});

describe("play flow", () => {
  const start = () => createMatch(rules, seededRng(42), 0).state;

  it("starts with the dealer's right leading", () => {
    const s = start();
    expect(s.phase).toBe("PLAYING");
    expect(s.turnSeat).toBe(1);
    expect(s.hands[0]).toContain(s.trumpCardId);
  });

  it("rejects out-of-turn, unknown, not-owned and non-following cards", () => {
    const s = start();
    const seat = s.turnSeat;
    const other = (seat + 1) % 4;
    expect(playCard(s, other, s.hands[other]![0]!)).toEqual({ ok: false, error: "NOT_YOUR_TURN" });
    expect(playCard(s, seat, "ZZ")).toEqual({ ok: false, error: "INVALID_CARD" });
    expect(playCard(s, seat, s.hands[other]![0]!)).toEqual({ ok: false, error: "CARD_NOT_IN_HAND" });

    const lead = s.hands[seat]![0]!;
    const after = mustPlay(s, seat, lead);
    const next = after.turnSeat;
    const hand = after.hands[next]!;
    const legal = getLegalCards(hand, after.trick.ledSuit);
    const illegal = hand.find((id) => !legal.includes(id));
    if (illegal) expect(playCard(after, next, illegal)).toEqual({ ok: false, error: "MUST_FOLLOW_SUIT" });
  });

  it("rejects a card already played (duplicate request)", () => {
    const s = start();
    const id = s.hands[s.turnSeat]![0]!;
    const after = mustPlay(s, s.turnSeat, id);
    expect(playCard(after, s.turnSeat, id).ok).toBe(false);
  });

  it("winner leads the next trick and gets the points", () => {
    let s = start();
    for (let i = 0; i < 4; i++) {
      s = mustPlay(s, s.turnSeat, getLegalCards(s.hands[s.turnSeat]!, s.trick.ledSuit)[0]!);
    }
    const t = s.completedTricks[0]!;
    expect(s.turnSeat).toBe(t.winnerSeat);
    expect(s.trick).toEqual({ number: 2, leaderSeat: t.winnerSeat, ledSuit: null, plays: [] });
    expect(s.handPoints[teamOf(t.winnerSeat)]).toBe(t.points);
    expect(s.handTricks[teamOf(t.winnerSeat)]).toBe(1);
  });

  it("completes a hand after 10 tricks with 120 points and empty hands", () => {
    const rng = seededRng(7);
    const s = playOutHand(createMatch(rules, rng, 0).state, rng);
    expect(s.completedTricks).toHaveLength(10);
    expect(s.hands.every((h) => h.length === 0)).toBe(true);
    expect(s.handPoints.A + s.handPoints.B).toBe(120);
    expect(["HAND_RESULT", "MATCH_RESULT"]).toContain(s.phase);
    expect(playCard(s, s.turnSeat, "AH")).toEqual({ ok: false, error: "HAND_NOT_ACTIVE" });
  });

  it("plays full matches to a winner, rotating the dealer each hand", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rng = seededRng(seed);
      let s = createMatch(rules, rng, 0).state;
      let dealer = s.dealerSeat;
      while (true) {
        s = playOutHand(s, rng);
        if (s.phase === "MATCH_RESULT") break;
        const r = startNextHand(s, rng);
        if (!r.ok) throw new Error(r.error);
        s = r.value.state;
        expect(s.dealerSeat).toBe((dealer + 1) % 4);
        dealer = s.dealerSeat;
      }
      expect(s.winner).not.toBeNull();
      expect(s.risks[s.winner!]).toBeGreaterThanOrEqual(4);
      expect(s.risks.A).not.toBe(s.risks.B);
      expect(startNextHand(s, rng).ok).toBe(false);
    }
  });
});

describe("bot", () => {
  /** Minimal state with a chosen trick in progress for seat `turn`. */
  function botState(hand: string[], plays: { seat: number; cardId: string }[], turn: number): SuecaState {
    const base = createMatch(rules, seededRng(1), 0).state;
    const hands = base.hands.map(() => [] as string[]);
    hands[turn] = hand;
    const ledSuit = plays[0] ? createDeck().find((c) => c.id === plays[0]!.cardId)!.suit : null;
    return {
      ...base,
      trumpSuit: "spades",
      hands,
      turnSeat: turn,
      trick: { number: 1, leaderSeat: plays[0]?.seat ?? turn, ledSuit, plays },
    };
  }

  it("leads its cheapest non-trump card", () => {
    expect(botCardId(botState(["2S", "AH", "3C"], [], 0))).toBe("3C");
  });

  it("wins with the cheapest winning card when opponents are winning", () => {
    const s = botState(["AH", "KH", "5H"], [{ seat: 3, cardId: "QH" }], 0);
    expect(botCardId(s)).toBe("KH");
  });

  it("trumps with its cheapest trump when void and opponents win", () => {
    const s = botState(["AS", "2S", "3C"], [{ seat: 3, cardId: "AH" }], 0);
    expect(botCardId(s)).toBe("2S");
  });

  it("gives its richest non-trump card to a winning partner when playing last", () => {
    const s = botState(["AC", "2C", "7S"], [
      { seat: 1, cardId: "3H" },
      { seat: 2, cardId: "AH" },
      { seat: 3, cardId: "4H" },
    ], 0);
    expect(botCardId(s)).toBe("AC");
  });

  it("always plays a legal card across full random hands", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = seededRng(seed);
      let s = createMatch(rules, rng, 0).state;
      while (s.phase === "PLAYING") s = mustPlay(s, s.turnSeat, botCardId(s));
      expect(s.handPoints.A + s.handPoints.B).toBe(120);
    }
  });
});

describe("auto-play", () => {
  it("plays the lowest-point legal card", () => {
    const s = createMatch(rules, seededRng(3), 0).state;
    const id = autoPlayCardId(s);
    const legal = getLegalCards(s.hands[s.turnSeat]!, null);
    expect(legal).toContain(id);
    const pts = (x: string) => createDeck().find((c) => c.id === x)!.points;
    expect(Math.min(...legal.map(pts))).toBe(pts(id));
  });
});

describe("views never leak hidden cards", () => {
  it("each seat sees only its own hand", () => {
    const s = createMatch(rules, seededRng(9), 0).state;
    for (let seat = 0; seat < 4; seat++) {
      const json = JSON.stringify(viewFor(s, seat));
      for (let other = 0; other < 4; other++) {
        if (other === seat) continue;
        for (const id of s.hands[other]!) {
          if (id === s.trumpCardId) continue; // trump card is public
          expect(json).not.toMatch(new RegExp(`"${id}"`));
        }
      }
      expect(viewFor(s, seat).handCounts).toEqual([10, 10, 10, 10]);
    }
  });
  it("legal cards only on your turn", () => {
    const s = createMatch(rules, seededRng(9), 0).state;
    expect(viewFor(s, s.turnSeat).legalCardIds.length).toBeGreaterThan(0);
    expect(viewFor(s, (s.turnSeat + 1) % 4).legalCardIds).toEqual([]);
  });
});
