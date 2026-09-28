import { err, ok, type Result } from "../shared/result";
import { shuffle, type Rng } from "../shared/rng";
import { card, createDeck, getCard, type Suit } from "./cards";
import type { SuecaRules } from "./rules";

export type Team = "A" | "B";
export type TeamScore = Record<Team, number>;

export const SEAT_COUNT = 4;

export interface Play {
  seat: number;
  cardId: string;
}

export interface Trick {
  number: number;
  leaderSeat: number;
  ledSuit: Suit | null;
  plays: Play[];
}

export interface CompletedTrick extends Trick {
  ledSuit: Suit;
  winnerSeat: number;
  points: number;
}

export interface HandResult {
  handNumber: number;
  dealerSeat: number;
  trumpSuit: Suit;
  points: TeamScore;
  tricks: TeamScore;
  /** Riscos awarded this hand, including any carried risco. */
  awarded: TeamScore;
  winner: Team | null;
  tie: boolean;
  capote: Team | null;
  bandeira: Team | null;
}

export type SuecaPhase = "PLAYING" | "HAND_RESULT" | "MATCH_RESULT";

export interface SuecaState {
  rules: SuecaRules;
  phase: SuecaPhase;
  /** Bumped on every accepted change. Clients echo it to reject stale actions. */
  version: number;
  handNumber: number;
  dealerSeat: number;
  trumpSuit: Suit;
  trumpCardId: string;
  /** Card ids per seat. Private: never send whole. */
  hands: string[][];
  trick: Trick;
  completedTricks: CompletedTrick[];
  turnSeat: number;
  handPoints: TeamScore;
  handTricks: TeamScore;
  risks: TeamScore;
  /** Riscos carried from 60–60 ties under CARRY_TO_NEXT_HAND. */
  carry: number;
  handResults: HandResult[];
  winner: Team | null;
}

export type SuecaEvent =
  | { type: "HAND_STARTED"; handNumber: number; dealerSeat: number; trumpCardId: string }
  | { type: "CARD_PLAYED"; seat: number; cardId: string }
  | { type: "TRICK_COMPLETED"; trick: CompletedTrick }
  | { type: "HAND_COMPLETED"; result: HandResult }
  | { type: "MATCH_COMPLETED"; winner: Team; risks: TeamScore };

export type SuecaError =
  | "HAND_NOT_ACTIVE"
  | "NOT_YOUR_TURN"
  | "INVALID_CARD"
  | "CARD_NOT_IN_HAND"
  | "MUST_FOLLOW_SUIT";

export interface Transition {
  state: SuecaState;
  events: SuecaEvent[];
}

// ---------- seats ----------

export const teamOf = (seat: number): Team => (seat % 2 === 0 ? "A" : "B");

/**
 * Next seat in play order. Play is counter-clockwise, so the next seat is the
 * current player's right. The UI maps seat order to screen positions; the
 * direction lives only here.
 */
export const getNextPlayer = (seat: number): number => (seat + 1) % SEAT_COUNT;

/** The player to the dealer's right leads the first trick. */
export const getFirstPlayer = (dealerSeat: number): number => getNextPlayer(dealerSeat);

export const getNextDealer = (dealerSeat: number): number => getNextPlayer(dealerSeat);

// ---------- dealing ----------

export interface Deal {
  hands: string[][];
  trumpCardId: string;
  trumpSuit: Suit;
}

/**
 * The last card of the shuffled deck is the trump card and goes to the dealer.
 * The other 39 are dealt one at a time starting at the dealer's right, so the
 * dealer ends with 9 + the trump card and everyone else with 10.
 */
export function dealCards(deckIds: readonly string[], dealerSeat: number): Deal {
  if (deckIds.length !== 40) throw new Error("Sueca deal needs 40 cards");
  const trumpCardId = deckIds[deckIds.length - 1]!;
  const hands: string[][] = [[], [], [], []];
  let seat = getFirstPlayer(dealerSeat);
  for (const id of deckIds.slice(0, -1)) {
    hands[seat]!.push(id);
    seat = getNextPlayer(seat);
  }
  hands[dealerSeat]!.push(trumpCardId);
  return { hands, trumpCardId, trumpSuit: card(trumpCardId).suit };
}

export function shuffleDeck(rng: Rng): string[] {
  return shuffle(
    createDeck().map((c) => c.id),
    rng,
  );
}

// ---------- rules ----------

export function getLegalCards(hand: readonly string[], ledSuit: Suit | null): string[] {
  if (ledSuit === null) return [...hand];
  const following = hand.filter((id) => card(id).suit === ledSuit);
  return following.length > 0 ? following : [...hand];
}

export function isLegalPlay(hand: readonly string[], ledSuit: Suit | null, cardId: string): boolean {
  return getLegalCards(hand, ledSuit).includes(cardId);
}

/** > 0 when `a` beats `b` in the context of this trick. */
export function compareCards(aId: string, bId: string, ledSuit: Suit, trumpSuit: Suit): number {
  const a = card(aId);
  const b = card(bId);
  const rank = (c: typeof a) => (c.suit === trumpSuit ? 2 : c.suit === ledSuit ? 1 : 0);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0; // two off-suit discards: neither can win
  return a.strength - b.strength;
}

export function determineTrickWinner(plays: readonly Play[], trumpSuit: Suit): number {
  const first = plays[0];
  if (!first) throw new Error("Empty trick");
  const ledSuit = card(first.cardId).suit;
  let best = first;
  for (const p of plays.slice(1)) {
    if (compareCards(p.cardId, best.cardId, ledSuit, trumpSuit) > 0) best = p;
  }
  return best.seat;
}

export function calculateTrickPoints(plays: readonly Play[]): number {
  return plays.reduce((sum, p) => sum + card(p.cardId).points, 0);
}

export const isCapote = (points: number, tricks: number, rules: SuecaRules): boolean =>
  rules.capoteRule === "120_POINTS" ? points === 120 : tricks === 10;

export const isBandeira = (tricks: number): boolean => tricks === 10;

export interface RiskAward {
  awarded: TeamScore;
  winner: Team | null;
  tie: boolean;
  capote: Team | null;
  bandeira: Team | null;
  /** Carry to pass on to the next hand. */
  carry: number;
}

export function calculateRiskAward(
  points: TeamScore,
  tricks: TeamScore,
  rules: SuecaRules,
  carryIn = 0,
): RiskAward {
  if (points.A + points.B !== 120) throw new Error(`Hand points must total 120, got ${points.A + points.B}`);
  const bandeira: Team | null = isBandeira(tricks.A) ? "A" : isBandeira(tricks.B) ? "B" : null;

  if (points.A === 60) {
    const base = { winner: null, tie: true, capote: null, bandeira };
    switch (rules.tieAt60Rule) {
      case "EACH_TEAM_GETS_ONE":
        return { ...base, awarded: { A: 1, B: 1 }, carry: carryIn };
      case "NO_POINTS":
        return { ...base, awarded: { A: 0, B: 0 }, carry: carryIn };
      case "CARRY_TO_NEXT_HAND":
        return { ...base, awarded: { A: 0, B: 0 }, carry: carryIn + 1 };
    }
  }

  const winner: Team = points.A > 60 ? "A" : "B";
  const wp = points[winner];
  const capote = isCapote(wp, tricks[winner], rules);
  const risks = capote ? 4 : wp >= 91 ? 2 : 1;
  const awarded: TeamScore = { A: 0, B: 0 };
  awarded[winner] = risks + carryIn;
  return { awarded, winner, tie: false, capote: capote ? winner : null, bandeira, carry: 0 };
}

/** Winner once a team is at or over the target and strictly ahead. */
export function isMatchOver(risks: TeamScore, targetRisks: number): Team | null {
  if (risks.A < targetRisks && risks.B < targetRisks) return null;
  if (risks.A === risks.B) return null;
  return risks.A > risks.B ? "A" : "B";
}

// ---------- state transitions ----------

function newHand(state: SuecaState, dealerSeat: number, rng: Rng): Transition {
  const deal = dealCards(shuffleDeck(rng), dealerSeat);
  const leader = getFirstPlayer(dealerSeat);
  const next: SuecaState = {
    ...state,
    phase: "PLAYING",
    version: state.version + 1,
    handNumber: state.handNumber + 1,
    dealerSeat,
    trumpSuit: deal.trumpSuit,
    trumpCardId: deal.trumpCardId,
    hands: deal.hands,
    trick: { number: 1, leaderSeat: leader, ledSuit: null, plays: [] },
    completedTricks: [],
    turnSeat: leader,
    handPoints: { A: 0, B: 0 },
    handTricks: { A: 0, B: 0 },
  };
  return {
    state: next,
    events: [{ type: "HAND_STARTED", handNumber: next.handNumber, dealerSeat, trumpCardId: deal.trumpCardId }],
  };
}

export function createMatch(rules: SuecaRules, rng: Rng, firstDealerSeat?: number): Transition {
  const dealer = firstDealerSeat ?? Math.floor(rng() * SEAT_COUNT);
  const empty: SuecaState = {
    rules: { ...rules },
    phase: "HAND_RESULT",
    version: 0,
    handNumber: 0,
    dealerSeat: dealer,
    trumpSuit: "hearts",
    trumpCardId: "",
    hands: [[], [], [], []],
    trick: { number: 1, leaderSeat: 0, ledSuit: null, plays: [] },
    completedTricks: [],
    turnSeat: 0,
    handPoints: { A: 0, B: 0 },
    handTricks: { A: 0, B: 0 },
    risks: { A: 0, B: 0 },
    carry: 0,
    handResults: [],
    winner: null,
  };
  return newHand(empty, dealer, rng);
}

export function startNextHand(state: SuecaState, rng: Rng): Result<Transition, "HAND_NOT_ACTIVE"> {
  if (state.phase !== "HAND_RESULT") return err("HAND_NOT_ACTIVE");
  return ok(newHand(state, getNextDealer(state.dealerSeat), rng));
}

export function playCard(state: SuecaState, seat: number, cardId: string): Result<Transition, SuecaError> {
  if (state.phase !== "PLAYING") return err("HAND_NOT_ACTIVE");
  if (seat !== state.turnSeat) return err("NOT_YOUR_TURN");
  if (!getCard(cardId)) return err("INVALID_CARD");
  const hand = state.hands[seat]!;
  if (!hand.includes(cardId)) return err("CARD_NOT_IN_HAND");
  if (!isLegalPlay(hand, state.trick.ledSuit, cardId)) return err("MUST_FOLLOW_SUIT");

  const events: SuecaEvent[] = [{ type: "CARD_PLAYED", seat, cardId }];
  const hands = state.hands.map((h, i) => (i === seat ? h.filter((id) => id !== cardId) : h));
  const plays = [...state.trick.plays, { seat, cardId }];
  const trick: Trick = { ...state.trick, ledSuit: state.trick.ledSuit ?? card(cardId).suit, plays };
  let next: SuecaState = { ...state, version: state.version + 1, hands, trick };

  if (plays.length < SEAT_COUNT) {
    next.turnSeat = getNextPlayer(seat);
    return ok({ state: next, events });
  }

  const winnerSeat = determineTrickWinner(plays, state.trumpSuit);
  const points = calculateTrickPoints(plays);
  const completed: CompletedTrick = { ...trick, ledSuit: trick.ledSuit!, winnerSeat, points };
  const team = teamOf(winnerSeat);
  next = {
    ...next,
    completedTricks: [...state.completedTricks, completed],
    handPoints: { ...state.handPoints, [team]: state.handPoints[team] + points },
    handTricks: { ...state.handTricks, [team]: state.handTricks[team] + 1 },
    trick: { number: trick.number + 1, leaderSeat: winnerSeat, ledSuit: null, plays: [] },
    turnSeat: winnerSeat,
  };
  events.push({ type: "TRICK_COMPLETED", trick: completed });

  if (next.completedTricks.length < 10) return ok({ state: next, events });
  return ok(finishHand(next, events));
}

function finishHand(state: SuecaState, events: SuecaEvent[]): Transition {
  const award = calculateRiskAward(state.handPoints, state.handTricks, state.rules, state.carry);
  const result: HandResult = {
    handNumber: state.handNumber,
    dealerSeat: state.dealerSeat,
    trumpSuit: state.trumpSuit,
    points: state.handPoints,
    tricks: state.handTricks,
    awarded: award.awarded,
    winner: award.winner,
    tie: award.tie,
    capote: award.capote,
    bandeira: award.bandeira,
  };
  const risks = { A: state.risks.A + award.awarded.A, B: state.risks.B + award.awarded.B };
  const winner = isMatchOver(risks, state.rules.targetRisks);
  events.push({ type: "HAND_COMPLETED", result });
  if (winner) events.push({ type: "MATCH_COMPLETED", winner, risks });
  return {
    state: {
      ...state,
      phase: winner ? "MATCH_RESULT" : "HAND_RESULT",
      risks,
      carry: award.carry,
      handResults: [...state.handResults, result],
      winner,
    },
    events,
  };
}

const cheapestFirst = (a: string, b: string) =>
  card(a).points - card(b).points || card(a).strength - card(b).strength;

/**
 * A simple bot for a seat whose player left. Always legal, no hidden-card
 * knowledge beyond its own hand:
 * - leading: cheapest non-trump card;
 * - partner winning: cheapest card, or the richest non-trump card if it plays last;
 * - otherwise: cheapest card that wins the trick, else cheapest card.
 */
export function botCardId(state: SuecaState): string {
  const seat = state.turnSeat;
  const { plays, ledSuit } = state.trick;
  const trump = state.trumpSuit;
  const legal = getLegalCards(state.hands[seat]!, ledSuit).sort(cheapestFirst);

  if (plays.length === 0 || ledSuit === null) {
    return legal.find((id) => card(id).suit !== trump) ?? legal[0]!;
  }

  const winnerSeat = determineTrickWinner(plays, trump);
  if (teamOf(winnerSeat) === teamOf(seat)) {
    if (plays.length === SEAT_COUNT - 1) {
      const rich = legal.filter((id) => card(id).suit !== trump).reverse();
      return rich[0] ?? legal[0]!;
    }
    return legal[0]!;
  }

  const best = plays.find((p) => p.seat === winnerSeat)!.cardId;
  return legal.find((id) => compareCards(id, best, ledSuit, trump) > 0) ?? legal[0]!;
}

/** Timer expiry: lowest-point legal card, weakest on ties. No strategy. */
export function autoPlayCardId(state: SuecaState): string {
  const legal = getLegalCards(state.hands[state.turnSeat]!, state.trick.ledSuit);
  const sorted = legal.map(card).sort((a, b) => a.points - b.points || a.strength - b.strength);
  return sorted[0]!.id;
}
