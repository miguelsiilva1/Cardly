import { clone } from "../shared/clone";
import { err, ok, type Result } from "../shared/result";
import { shuffle, type Rng } from "../shared/rng";
import { card, createDeck, matches, type Ability } from "./cards";
import { HAND_SIZE, MIN_PLAYERS, MAX_PLAYERS, PEEK_COUNT, type GringoRules } from "./rules";

export type GringoPhase = "PEEK" | "PLAYING" | "ROUND_RESULT";

/**
 * A place in front of a player. The id is stable while the card in it changes
 * (swaps), so actions name slots, not positions that shift when a card leaves.
 */
export interface Slot {
  id: string;
  cardId: string;
}

/** The card on top of the discard pile. Every card that lands there opens a new event. */
export interface DiscardEvent {
  id: number;
  cardId: string;
  seat: number;
  /** Seats that already tried to match this event (right or wrong). */
  tried: number[];
}

/**
 * Open right after a discard. The player whose turn it is cannot draw yet, and
 * the owner (if the card has an ability) can claim it. Closed by the server timer.
 */
export interface AbilityWindow {
  eventId: number;
  owner: number | null;
}

/** An ability being resolved. Play waits for it. */
export interface PendingAbility {
  kind: Ability;
  seat: number;
  cardId: string;
  /** Black King only: set once both cards are chosen, then the owner decides. */
  mySlotId: string | null;
  targetSlotId: string | null;
}

/** Public record of what happened. Only ever holds cards everyone saw face up. */
export type LogEntry = { n: number } & (
  | { type: "DREW"; seat: number }
  | { type: "DISCARDED"; seat: number; cardId: string; auto: boolean }
  | { type: "SWAPPED"; seat: number; slotId: string; cardId: string }
  | { type: "MATCHED"; seat: number; cardId: string }
  | { type: "WRONG_MATCH"; seat: number; slotId: string; cardId: string; penalty: boolean }
  | { type: "ABILITY"; seat: number; kind: Ability }
  | { type: "QUEEN_LOOKED"; seat: number; slotId: string }
  | { type: "JACK_SWAPPED"; seat: number; mySlotId: string; targetSeat: number; targetSlotId: string }
  | { type: "KING_LOOKED"; seat: number; mySlotId: string; targetSeat: number; targetSlotId: string }
  | { type: "KING_DECIDED"; seat: number; swapped: boolean }
  | { type: "ABILITY_EXPIRED"; seat: number }
  | { type: "GRINGO"; seat: number }
);

/** A card shown to one player once, like lifting it off the table and putting it back. */
export interface Glimpse {
  seat: number;
  slotId: string;
  cardId: string;
}

export type EndReason = "GRINGO" | "EMPTY_HAND" | "PILE_EMPTY";

export interface RoundResult {
  roundNumber: number;
  reason: EndReason;
  /** Every card, revealed. */
  hands: string[][];
  totals: number[];
  winners: number[];
  /** Seat that matched away its last card, if any. */
  emptied: number | null;
  caller: number | null;
}

export interface GringoState {
  rules: GringoRules;
  phase: GringoPhase;
  /** Bumped on every accepted change. */
  version: number;
  roundNumber: number;
  playerCount: number;
  /** Seat that took the first turn this round. */
  firstSeat: number;
  /** Private: never send whole. */
  hands: Slot[][];
  /** Private. Top is the last element. */
  drawPile: string[];
  /** Face up. Top is the last element. */
  discard: string[];
  /** Private. Who knows which card. Knowledge follows the card when it moves. Used by bots. */
  knownTo: Record<string, number[]>;
  /**
   * Cards shown by the latest change only. Views carry them while `version`
   * still matches, so each player sees a card once and must remember it.
   */
  glimpses: { version: number; items: Glimpse[] } | null;
  peeked: boolean[];
  turnSeat: number;
  /** Counts turns across rounds so the server can tell a new turn from a change inside one. */
  turnNumber: number;
  /** Private to `turnSeat`. */
  drawn: string | null;
  event: DiscardEvent | null;
  window: AbilityWindow | null;
  ability: PendingAbility | null;
  caller: number | null;
  result: RoundResult | null;
  log: LogEntry[];
  /** Counters kept across rounds so ids from an old round never match a new one. */
  slotSeq: number;
  eventSeq: number;
  logSeq: number;
}

export type GringoError =
  | "ROUND_NOT_ACTIVE"
  | "NOT_YOUR_TURN"
  | "INVALID_PEEK"
  | "ALREADY_PEEKED"
  | "ALREADY_DREW"
  | "MUST_DRAW_FIRST"
  | "DRAW_LOCKED"
  | "ABILITY_IN_PROGRESS"
  | "NOT_YOUR_CARD"
  | "INVALID_TARGET"
  | "NOTHING_TO_MATCH"
  | "MATCH_TOO_LATE"
  | "ALREADY_TRIED"
  | "NO_ABILITY"
  | "GRINGO_ALREADY_CALLED";

type R = Result<GringoState, GringoError>;

// ---------- seats and cards ----------

/** Play goes right (counter-clockwise): the next seat is the current player's right. */
export const nextSeat = (seat: number, playerCount: number): number => (seat + 1) % playerCount;

export const cardValue = (id: string): number => card(id).value;

export const handTotal = (cardIds: readonly string[]): number => cardIds.reduce((sum, id) => sum + cardValue(id), 0);

/** Seat that owns a slot, or -1. */
export function ownerOf(state: GringoState, slotId: string): number {
  return state.hands.findIndex((h) => h.some((s) => s.id === slotId));
}

function slotOf(state: GringoState, seat: number, slotId: string): Slot | undefined {
  return state.hands[seat]?.find((s) => s.id === slotId);
}

// ---------- setup ----------

export function shuffleDeck(rng: Rng): string[] {
  return shuffle(
    createDeck().map((c) => c.id),
    rng,
  );
}

interface Counters {
  slotSeq: number;
  eventSeq: number;
  logSeq: number;
  turnNumber: number;
}

function deal(rules: GringoRules, playerCount: number, firstSeat: number, roundNumber: number, deck: readonly string[], c: Counters): GringoState {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) throw new Error(`Gringo needs 3–6 players, got ${playerCount}`);
  const pile = [...deck];
  const hands: Slot[][] = Array.from({ length: playerCount }, () => []);
  const knownTo: Record<string, number[]> = {};
  let slotSeq = c.slotSeq;
  // One card at a time, starting with the first player.
  for (let i = 0; i < HAND_SIZE; i++) {
    for (let k = 0; k < playerCount; k++) {
      const seat = (firstSeat + k) % playerCount;
      const id = pile.pop()!;
      hands[seat]!.push({ id: `s${++slotSeq}`, cardId: id });
      knownTo[id] = [];
    }
  }
  return {
    rules,
    phase: "PEEK",
    version: 0,
    roundNumber,
    playerCount,
    firstSeat,
    hands,
    drawPile: pile,
    discard: [],
    knownTo,
    glimpses: null,
    peeked: Array.from({ length: playerCount }, () => false),
    turnSeat: firstSeat,
    turnNumber: c.turnNumber + 1,
    drawn: null,
    event: null,
    window: null,
    ability: null,
    caller: null,
    result: null,
    log: [],
    slotSeq,
    eventSeq: c.eventSeq,
    logSeq: c.logSeq,
  };
}

/** First round: a random player goes first. */
export function createGame(rules: GringoRules, playerCount: number, rng: Rng): GringoState {
  const first = Math.floor(rng() * playerCount);
  return deal(rules, playerCount, first, 1, shuffleDeck(rng), { slotSeq: 0, eventSeq: 0, logSeq: 0, turnNumber: 0 });
}

/** Rounds are standalone. The first player moves one seat to the right. */
export function nextRound(prev: GringoState, rng: Rng): Result<GringoState, GringoError> {
  if (prev.phase !== "ROUND_RESULT") return err("ROUND_NOT_ACTIVE");
  const s = deal(prev.rules, prev.playerCount, nextSeat(prev.firstSeat, prev.playerCount), prev.roundNumber + 1, shuffleDeck(rng), prev);
  s.version = prev.version + 1;
  return ok(s);
}

/** For tests: deal a given deck order (the last card is dealt first). */
export function createGameFromDeck(rules: GringoRules, playerCount: number, firstSeat: number, deck: readonly string[]): GringoState {
  return deal(rules, playerCount, firstSeat, 1, deck, { slotSeq: 0, eventSeq: 0, logSeq: 0, turnNumber: 0 });
}

// ---------- helpers that mutate a cloned state ----------

function log(s: GringoState, entry: DistributiveOmit<LogEntry, "n">): void {
  s.log.push({ n: ++s.logSeq, ...entry } as LogEntry);
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

const everyone = (s: GringoState) => Array.from({ length: s.playerCount }, (_, i) => i);

function glimpse(s: GringoState, seat: number, slotId: string, cardId: string): void {
  if (s.glimpses?.version !== s.version) s.glimpses = { version: s.version, items: [] };
  s.glimpses.items.push({ seat, slotId, cardId });
}

function know(s: GringoState, cardId: string, seat: number): void {
  const k = s.knownTo[cardId] ?? [];
  if (!k.includes(seat)) k.push(seat);
  s.knownTo[cardId] = k;
}

/** Card lands face up and opens a new discard event (and window). */
function toDiscard(s: GringoState, seat: number, cardId: string, withAbility: boolean): void {
  s.discard.push(cardId);
  s.knownTo[cardId] = everyone(s);
  s.event = { id: ++s.eventSeq, cardId, seat, tried: [] };
  s.window = { eventId: s.event.id, owner: withAbility && card(cardId).ability ? seat : null };
}

function advanceTurn(s: GringoState): void {
  s.turnSeat = nextSeat(s.turnSeat, s.playerCount);
  s.turnNumber++;
  s.drawn = null;
}

function endRound(s: GringoState, reason: EndReason, emptied: number | null = null): void {
  const hands = s.hands.map((h) => h.map((x) => x.cardId));
  const totals = hands.map(handTotal);
  const best = Math.min(...totals);
  const winners = emptied !== null ? [emptied] : everyone(s).filter((i) => totals[i] === best);
  s.phase = "ROUND_RESULT";
  s.drawn = null;
  s.window = null;
  s.ability = null;
  s.result = { roundNumber: s.roundNumber, reason, hands, totals, winners, emptied, caller: s.caller };
}

/**
 * Called whenever the player on turn could draw next (no window, no ability,
 * nothing in hand). This is where the Gringo cycle and an empty pile end the round.
 */
function settle(s: GringoState): void {
  if (s.phase !== "PLAYING" || s.window || s.ability || s.drawn) return;
  if (s.caller !== null && s.turnSeat === s.caller) endRound(s, "GRINGO");
  else if (s.drawPile.length === 0) endRound(s, "PILE_EMPTY");
}

function begin(input: GringoState): GringoState {
  const s = clone(input);
  s.version++;
  return s;
}

// ---------- peek ----------

export function peek(input: GringoState, seat: number, slotIds: readonly string[]): R {
  if (input.phase !== "PEEK") return err("ROUND_NOT_ACTIVE");
  if (input.peeked[seat]) return err("ALREADY_PEEKED");
  if (slotIds.length !== PEEK_COUNT || new Set(slotIds).size !== PEEK_COUNT) return err("INVALID_PEEK");
  if (!slotIds.every((id) => slotOf(input, seat, id))) return err("NOT_YOUR_CARD");
  const s = begin(input);
  for (const id of slotIds) {
    const cardId = slotOf(s, seat, id)!.cardId;
    know(s, cardId, seat);
    glimpse(s, seat, id, cardId);
  }
  s.peeked[seat] = true;
  if (s.peeked.every(Boolean)) s.phase = "PLAYING";
  return ok(s);
}

/** Timer expiry or a bot: two random slots. */
export function randomPeekSlots(state: GringoState, seat: number, rng: Rng): string[] {
  return shuffle(
    state.hands[seat]!.map((x) => x.id),
    rng,
  ).slice(0, PEEK_COUNT);
}

// ---------- turn ----------

export function draw(input: GringoState, seat: number): R {
  if (input.phase !== "PLAYING") return err("ROUND_NOT_ACTIVE");
  if (input.turnSeat !== seat) return err("NOT_YOUR_TURN");
  if (input.drawn) return err("ALREADY_DREW");
  if (input.ability) return err("ABILITY_IN_PROGRESS");
  if (input.window) return err("DRAW_LOCKED");
  const s = begin(input);
  const id = s.drawPile.pop()!; // settle() ends the round before the pile can be empty here
  s.drawn = id;
  s.knownTo[id] = [seat];
  log(s, { type: "DREW", seat });
  return ok(s);
}

function checkHolding(input: GringoState, seat: number): GringoError | null {
  if (input.phase !== "PLAYING") return "ROUND_NOT_ACTIVE";
  if (input.turnSeat !== seat) return "NOT_YOUR_TURN";
  if (!input.drawn) return "MUST_DRAW_FIRST";
  if (input.ability) return "ABILITY_IN_PROGRESS";
  return null;
}

/** Put the drawn card straight on the discard pile. A Queen, Jack or black King opens its ability. */
export function discardDrawn(input: GringoState, seat: number): R {
  const e = checkHolding(input, seat);
  if (e) return err(e);
  const s = begin(input);
  const id = s.drawn!;
  toDiscard(s, seat, id, true);
  log(s, { type: "DISCARDED", seat, cardId: id, auto: false });
  advanceTurn(s);
  return ok(s);
}

/** The drawn card takes a slot; the card that was there is discarded (and opens its ability). */
export function swapDrawn(input: GringoState, seat: number, slotId: string): R {
  const e = checkHolding(input, seat);
  if (e) return err(e);
  if (!slotOf(input, seat, slotId)) return err("NOT_YOUR_CARD");
  const s = begin(input);
  const slot = slotOf(s, seat, slotId)!;
  const out = slot.cardId;
  slot.cardId = s.drawn!;
  s.knownTo[slot.cardId] = [seat];
  toDiscard(s, seat, out, true);
  log(s, { type: "SWAPPED", seat, slotId, cardId: out });
  advanceTurn(s);
  return ok(s);
}

// ---------- matching discard ----------

/**
 * Any player, any time during play, once per discard event. Right: the card
 * becomes the new top and there is no replacement. Wrong: the card is shown to
 * everyone, stays in its slot, and the player takes an unseen penalty card.
 */
export function matchDiscard(input: GringoState, seat: number, slotId: string, eventId: number): R {
  if (input.phase !== "PLAYING") return err("ROUND_NOT_ACTIVE");
  if (input.ability) return err("ABILITY_IN_PROGRESS");
  if (!input.event) return err("NOTHING_TO_MATCH");
  if (input.event.id !== eventId) return err("MATCH_TOO_LATE");
  if (input.event.tried.includes(seat)) return err("ALREADY_TRIED");
  if (!slotOf(input, seat, slotId)) return err("NOT_YOUR_CARD");

  const s = begin(input);
  const hand = s.hands[seat]!;
  const slot = slotOf(s, seat, slotId)!;
  s.event!.tried.push(seat);

  if (matches(slot.cardId, s.event!.cardId)) {
    s.hands[seat] = hand.filter((x) => x.id !== slotId);
    toDiscard(s, seat, slot.cardId, true);
    log(s, { type: "MATCHED", seat, cardId: slot.cardId });
    if (s.hands[seat]!.length === 0) endRound(s, "EMPTY_HAND", seat);
    return ok(s);
  }

  s.knownTo[slot.cardId] = everyone(s);
  for (const viewer of everyone(s)) glimpse(s, viewer, slotId, slot.cardId);
  const penalty = s.drawPile.pop();
  if (penalty) {
    hand.push({ id: `s${++s.slotSeq}`, cardId: penalty });
    s.knownTo[penalty] = [];
  }
  log(s, { type: "WRONG_MATCH", seat, slotId, cardId: slot.cardId, penalty: !!penalty });
  settle(s);
  return ok(s);
}

// ---------- abilities ----------

export function useAbility(input: GringoState, seat: number, eventId: number): R {
  if (input.phase !== "PLAYING") return err("ROUND_NOT_ACTIVE");
  const w = input.window;
  if (!w || w.eventId !== eventId || w.owner !== seat) return err("NO_ABILITY");
  const s = begin(input);
  const id = s.event!.cardId;
  s.window = null;
  s.ability = { kind: card(id).ability!, seat, cardId: id, mySlotId: null, targetSlotId: null };
  log(s, { type: "ABILITY", seat, kind: s.ability.kind });
  return ok(s);
}

/**
 * Queen: `mySlotId` only. Jack: both slots, swapped blind. Black King: both
 * slots, then the owner sees the target card and calls `decideBlackKing`.
 */
export function chooseAbilityTarget(input: GringoState, seat: number, mySlotId: string, targetSlotId: string | null): R {
  const a = input.ability;
  if (input.phase !== "PLAYING") return err("ROUND_NOT_ACTIVE");
  if (!a || a.seat !== seat || a.mySlotId) return err("NO_ABILITY");
  if (!slotOf(input, seat, mySlotId)) return err("NOT_YOUR_CARD");

  if (a.kind === "QUEEN") {
    if (targetSlotId !== null) return err("INVALID_TARGET");
    const s = begin(input);
    const seen = slotOf(s, seat, mySlotId)!.cardId;
    know(s, seen, seat);
    glimpse(s, seat, mySlotId, seen);
    s.ability = null;
    log(s, { type: "QUEEN_LOOKED", seat, slotId: mySlotId });
    settle(s);
    return ok(s);
  }

  if (targetSlotId === null) return err("INVALID_TARGET");
  const targetSeat = ownerOf(input, targetSlotId);
  if (targetSeat < 0 || targetSeat === seat) return err("INVALID_TARGET");

  const s = begin(input);
  if (a.kind === "JACK") {
    swapCards(slotOf(s, seat, mySlotId)!, slotOf(s, targetSeat, targetSlotId)!);
    s.ability = null;
    log(s, { type: "JACK_SWAPPED", seat, mySlotId, targetSeat, targetSlotId });
    settle(s);
    return ok(s);
  }

  s.ability = { ...a, mySlotId, targetSlotId };
  log(s, { type: "KING_LOOKED", seat, mySlotId, targetSeat, targetSlotId });
  return ok(s);
}

export function decideBlackKing(input: GringoState, seat: number, swap: boolean): R {
  const a = input.ability;
  if (input.phase !== "PLAYING") return err("ROUND_NOT_ACTIVE");
  if (!a || a.seat !== seat || a.kind !== "BLACK_KING" || !a.mySlotId || !a.targetSlotId) return err("NO_ABILITY");
  const s = begin(input);
  if (swap) {
    const targetSeat = ownerOf(s, a.targetSlotId);
    const mine = slotOf(s, seat, a.mySlotId)!;
    const theirs = slotOf(s, targetSeat, a.targetSlotId)!;
    swapCards(mine, theirs);
    know(s, mine.cardId, seat); // the card I looked at is now mine
    know(s, theirs.cardId, targetSeat); // they see the card they received
    glimpse(s, targetSeat, theirs.id, theirs.cardId);
  }
  s.ability = null;
  log(s, { type: "KING_DECIDED", seat, swapped: swap });
  settle(s);
  return ok(s);
}

function swapCards(a: Slot, b: Slot): void {
  [a.cardId, b.cardId] = [b.cardId, a.cardId];
}

// ---------- Gringo ----------

/**
 * Once per round, any time during play. Play goes on; the round ends when the
 * turn would come back to the caller. Called on your own turn before drawing,
 * the call is your turn.
 */
export function callGringo(input: GringoState, seat: number): R {
  if (input.phase !== "PLAYING") return err("ROUND_NOT_ACTIVE");
  if (input.caller !== null) return err("GRINGO_ALREADY_CALLED");
  const s = begin(input);
  s.caller = seat;
  log(s, { type: "GRINGO", seat });
  if (s.turnSeat === seat && !s.drawn) advanceTurn(s);
  settle(s);
  return ok(s);
}

// ---------- server timers ----------

/** The draw lock ends; an unclaimed ability is lost. No-op if that window is already gone. */
export function closeWindow(input: GringoState, eventId: number): GringoState {
  if (input.window?.eventId !== eventId) return input;
  const s = begin(input);
  s.window = null;
  settle(s);
  return s;
}

/**
 * The acting player ran out of time. Peek: random cards for whoever has not
 * picked. Ability: cancelled (a black King counts as declined). Turn: draw if
 * needed, then discard the drawn card with no ability.
 */
export function timeout(input: GringoState, rng: Rng): GringoState {
  if (input.phase === "PEEK") {
    let s = input;
    const shown: Glimpse[] = [];
    for (let seat = 0; seat < s.playerCount; seat++) {
      if (s.peeked[seat]) continue;
      s = unwrap(peek(s, seat, randomPeekSlots(s, seat, rng)));
      shown.push(...s.glimpses!.items);
    }
    // Everyone who ran out of time still gets to see their two cards once.
    return s === input ? s : { ...s, glimpses: { version: s.version, items: shown } };
  }
  if (input.phase !== "PLAYING") return input;
  if (input.ability) {
    const s = begin(input);
    log(s, { type: "ABILITY_EXPIRED", seat: s.ability!.seat });
    s.ability = null;
    settle(s);
    return s;
  }
  if (input.window) return input;
  const s = begin(input);
  const seat = s.turnSeat;
  if (!s.drawn) {
    s.drawn = s.drawPile.pop()!;
    log(s, { type: "DREW", seat });
  }
  const id = s.drawn;
  toDiscard(s, seat, id, false);
  log(s, { type: "DISCARDED", seat, cardId: id, auto: true });
  advanceTurn(s);
  return s;
}

/**
 * A bot's whole turn, using only what that seat knows. Swap into the worst
 * known card if the drawn one is lower; take a low card into an unknown slot;
 * otherwise discard. Bots never match, use abilities, or call Gringo.
 */
export function botTurn(input: GringoState): GringoState {
  const seat = input.turnSeat;
  const drawn = input.drawn ? input : unwrap(draw(input, seat));
  const v = cardValue(drawn.drawn!);
  const mine = drawn.hands[seat]!;
  const known = mine.filter((x) => drawn.knownTo[x.cardId]?.includes(seat));
  const worst = known.reduce<Slot | null>((w, x) => (!w || cardValue(x.cardId) > cardValue(w.cardId) ? x : w), null);
  if (worst && cardValue(worst.cardId) > v) return unwrap(swapDrawn(drawn, seat, worst.id));
  const unknown = mine.find((x) => !drawn.knownTo[x.cardId]?.includes(seat));
  if (unknown && v <= 4) return unwrap(swapDrawn(drawn, seat, unknown.id));
  return unwrap(discardDrawn(drawn, seat));
}

function unwrap(r: R): GringoState {
  if (!r.ok) throw new Error(`Gringo engine rejected a server move: ${r.error}`);
  return r.value;
}
