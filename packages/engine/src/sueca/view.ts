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
  completedTricks: CompletedTrick[];
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
    completedTricks: state.completedTricks,
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
