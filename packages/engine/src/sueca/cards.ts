export type Suit = "hearts" | "diamonds" | "clubs" | "spades";
export type Rank = "A" | "7" | "K" | "J" | "Q" | "6" | "5" | "4" | "3" | "2";

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  points: number;
  /** Higher beats lower within the same suit. A = 10 … 2 = 1. */
  strength: number;
}

export const SUITS: readonly Suit[] = ["hearts", "diamonds", "clubs", "spades"];

/** Strongest first: A > 7 > K > J > Q > 6 > 5 > 4 > 3 > 2. */
export const RANKS: readonly Rank[] = ["A", "7", "K", "J", "Q", "6", "5", "4", "3", "2"];

export const POINTS: Record<Rank, number> = {
  A: 11,
  "7": 10,
  K: 4,
  J: 3,
  Q: 2,
  "6": 0,
  "5": 0,
  "4": 0,
  "3": 0,
  "2": 0,
};

const SUIT_LETTER: Record<Suit, string> = { hearts: "H", diamonds: "D", clubs: "C", spades: "S" };

export const cardId = (rank: Rank, suit: Suit): string => `${rank}${SUIT_LETTER[suit]}`;

function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    RANKS.forEach((rank, i) => {
      deck.push({ id: cardId(rank, suit), suit, rank, points: POINTS[rank], strength: RANKS.length - i });
    });
  }
  return deck;
}

const DECK: readonly Card[] = buildDeck();
const BY_ID: ReadonlyMap<string, Card> = new Map(DECK.map((c) => [c.id, c]));

/** The 40-card Sueca deck in a fixed order. */
export function createDeck(): Card[] {
  return DECK.map((c) => ({ ...c }));
}

export function getCard(id: string): Card | undefined {
  return BY_ID.get(id);
}

/** For ids already validated as belonging to the deck. */
export function card(id: string): Card {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`Unknown Sueca card id: ${id}`);
  return c;
}
