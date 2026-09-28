import type { Suit } from "./cards";
import {
  getLegalCards,
  type CompletedTrick,
  type HandResult,
  type SuecaPhase,
  type SuecaState,
  type Team,
  type TeamScore,
  type Trick,
} from "./engine";
import type { SuecaRules } from "./rules";

/** Everything one seat is allowed to see. The only Sueca shape sent to clients. */
export interface SuecaView {
  rules: SuecaRules;
  phase: SuecaPhase;
  version: number;
  mySeat: number;
  handNumber: number;
  dealerSeat: number;
  trumpSuit: Suit;
  trumpCardId: string;
  turnSeat: number;
  trick: Trick;
  /** Only the latest finished round of cards: earlier ones cannot be looked at again. */
  lastTrick: CompletedTrick | null;
  /** Rounds finished this hand. */
  tricksDone: number;
  /** Who played the trump card, and in which round. Null while it is still in the dealer's hand. */
  trumpPlayed: { seat: number; round: number } | null;
  handCounts: number[];
  handPoints: TeamScore;
  handTricks: TeamScore;
  risks: TeamScore;
  carry: number;
  lastHandResult: HandResult | null;
  winner: Team | null;
  myHand: string[];
  /** Empty unless it is this seat's turn. */
  legalCardIds: string[];
}

export function viewFor(state: SuecaState, seat: number): SuecaView {
  const myHand = [...state.hands[seat]!];
  const myTurn = state.phase === "PLAYING" && state.turnSeat === seat;
  return {
    rules: state.rules,
    phase: state.phase,
    version: state.version,
    mySeat: seat,
    handNumber: state.handNumber,
    dealerSeat: state.dealerSeat,
    trumpSuit: state.trumpSuit,
    trumpCardId: state.trumpCardId,
    turnSeat: state.turnSeat,
    trick: state.trick,
    lastTrick: state.completedTricks.at(-1) ?? null,
    tricksDone: state.completedTricks.length,
    trumpPlayed: findTrump(state),
    handCounts: state.hands.map((h) => h.length),
    handPoints: state.handPoints,
    handTricks: state.handTricks,
    risks: state.risks,
    carry: state.carry,
    lastHandResult: state.handResults.at(-1) ?? null,
    winner: state.winner,
    myHand,
    legalCardIds: myTurn ? getLegalCards(myHand, state.trick.ledSuit) : [],
  };
}

function findTrump(state: SuecaState): { seat: number; round: number } | null {
  for (const t of [...state.completedTricks, state.trick]) {
    const p = t.plays.find((x) => x.cardId === state.trumpCardId);
    if (p) return { seat: p.seat, round: t.number };
  }
  return null;
}
