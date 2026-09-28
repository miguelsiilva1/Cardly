export type Suit = "hearts" | "diamonds" | "clubs" | "spades";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "JOKER";
export type Ability = "QUEEN" | "JACK" | "BLACK_KING";

export interface Card {
  id: string;
  rank: Rank;
  /** Null for Jokers. */
  suit: Suit | null;
  red: boolean;
  /** Points at the final count. */
  value: number;
  /** Ability the card gives when it is drawn, swapped out, or match-placed. */
  ability: Ability | null;
}

export const SUITS: readonly Suit[] = ["hearts", "diamonds", "clubs", "spades"];
export const RANKS: readonly Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const SUIT_LETTER: Record<Suit, string> = { hearts: "H", diamonds: "D", clubs: "C", spades: "S" };
const RED: ReadonlySet<Suit> = new Set(["hearts", "diamonds"]);

/** Same id scheme as Sueca ("7H", "10S"); Jokers are "X1" and "X2". */
export const cardId = (rank: Exclude<Rank, "JOKER">, suit: Suit): string => `${rank}${SUIT_LETTER[suit]}`;

function valueOf(rank: Rank, red: boolean): number {
  if (rank === "JOKER") return 0;
  if (rank === "A") return 1;
  if (rank === "K") return red ? -2 : 13;
  if (rank === "J" || rank === "Q") return 13;
  return Number(rank);
}

function abilityOf(rank: Rank, red: boolean): Ability | null {
  if (rank === "Q") return "QUEEN";
  if (rank === "J") return "JACK";
  if (rank === "K" && !red) return "BLACK_KING";
  return null;
}

function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const red = RED.has(suit);
      deck.push({ id: cardId(rank as Exclude<Rank, "JOKER">, suit), rank, suit, red, value: valueOf(rank, red), ability: abilityOf(rank, red) });
    }
  }
  for (const id of ["X1", "X2"]) deck.push({ id, rank: "JOKER", suit: null, red: false, value: 0, ability: null });
  return deck;
}

const DECK: readonly Card[] = buildDeck();
const BY_ID: ReadonlyMap<string, Card> = new Map(DECK.map((c) => [c.id, c]));

/** 52 cards + 2 Jokers, fixed order. */
export function createDeck(): Card[] {
  return DECK.map((c) => ({ ...c }));
}

export function getCard(id: string): Card | undefined {
  return BY_ID.get(id);
}

/** For ids already validated as belonging to the deck. */
export function card(id: string): Card {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`Unknown Gringo card id: ${id}`);
  return c;
}

/**
 * Match-discard rule: same rank, any suit. Kings also need the same colour
 * (red King only on red King, black only on black). Jokers match Jokers.
 */
export function matches(aId: string, bId: string): boolean {
  const a = card(aId);
  const b = card(bId);
  if (a.rank !== b.rank) return false;
  return a.rank !== "K" || a.red === b.red;
}
