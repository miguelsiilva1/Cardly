import type { Ability } from "./cards";
import type { AbilityWindow, GringoPhase, GringoState, LogEntry, RoundResult } from "./engine";
import type { GringoRules } from "./rules";

export interface SlotView {
  id: string;
  /** Null until the round is over. Cards are face down; see `glimpse`. */
  cardId: string | null;
}

export interface AbilityView {
  kind: Ability;
  seat: number;
  cardId: string;
  mySlotId: string | null;
  targetSlotId: string | null;
  /** Black King: the target card. Only for the player using it. */
  seenCardId: string | null;
}

/** Everything one seat is allowed to see. The only Gringo shape sent to clients. */
export interface GringoView {
  rules: GringoRules;
  phase: GringoPhase;
  version: number;
  roundNumber: number;
  playerCount: number;
  mySeat: number;
  firstSeat: number;
  turnSeat: number;
  turnNumber: number;
  hands: SlotView[][];
  /**
   * Cards this viewer may look at right now, once. Present only in the state
   * right after the action that showed them; the client shows them briefly.
   */
  glimpse: { id: number; cards: { slotId: string; cardId: string }[] } | null;
  peeked: boolean[];
  drawCount: number;
  discardCount: number;
  discardTop: string | null;
  event: { id: number; cardId: string; seat: number } | null;
  /** I already tried to match the current event. */
  triedThisEvent: boolean;
  window: AbilityWindow | null;
  /** The player on turn is holding a drawn card. */
  hasDrawn: boolean;
  /** The drawn card, only for the player holding it. */
  drawn: string | null;
  ability: AbilityView | null;
  caller: number | null;
  result: RoundResult | null;
  /** The latest play only. Earlier plays cannot be looked at again. */
  log: LogEntry[];
}

const LOG_SIZE = 1;

export function viewFor(state: GringoState, seat: number): GringoView {
  const over = state.phase === "ROUND_RESULT";
  const a = state.ability;
  const g = state.glimpses;
  const mine = g && g.version === state.version ? g.items.filter((x) => x.seat === seat) : [];
  return {
    rules: state.rules,
    phase: state.phase,
    version: state.version,
    roundNumber: state.roundNumber,
    playerCount: state.playerCount,
    mySeat: seat,
    firstSeat: state.firstSeat,
    turnSeat: state.turnSeat,
    turnNumber: state.turnNumber,
    hands: state.hands.map((h) => h.map((x) => ({ id: x.id, cardId: over ? x.cardId : null }))),
    glimpse: mine.length ? { id: g!.version, cards: mine.map(({ slotId, cardId }) => ({ slotId, cardId })) } : null,
    peeked: [...state.peeked],
    drawCount: state.drawPile.length,
    discardCount: state.discard.length,
    discardTop: state.discard.at(-1) ?? null,
    event: state.event && { id: state.event.id, cardId: state.event.cardId, seat: state.event.seat },
    triedThisEvent: state.event?.tried.includes(seat) ?? false,
    window: state.window && { ...state.window },
    hasDrawn: state.drawn !== null,
    drawn: state.turnSeat === seat ? state.drawn : null,
    ability: a && {
      kind: a.kind,
      seat: a.seat,
      cardId: a.cardId,
      mySlotId: a.mySlotId,
      targetSlotId: a.targetSlotId,
      seenCardId: a.seat === seat && a.targetSlotId ? cardInSlot(state, a.targetSlotId) : null,
    },
    caller: state.caller,
    result: state.result,
    log: state.log.slice(-LOG_SIZE),
  };
}

function cardInSlot(state: GringoState, slotId: string): string | null {
  for (const h of state.hands) {
    const x = h.find((s) => s.id === slotId);
    if (x) return x.cardId;
  }
  return null;
}
