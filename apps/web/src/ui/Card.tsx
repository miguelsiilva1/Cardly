import { sueca } from "@cardly/engine";
import { cardLabel, SUIT_SYMBOL } from "../i18n";

const RED: ReadonlySet<sueca.Suit> = new Set(["hearts", "diamonds"]);

interface FaceProps {
  id: string;
  size?: "hand" | "table" | "trump" | "mini";
  className?: string;
}

/** Card face. Rank + suit in the corners, one big pip or letter in the middle. */
export function CardFace({ id, size = "table", className = "" }: FaceProps) {
  const c = sueca.card(id);
  const symbol = SUIT_SYMBOL[c.suit];
  const tone = RED.has(c.suit) ? "card--red" : "card--black";
  return (
    <span className={`card card--${size} ${tone} ${className}`} data-suit={c.suit} role="img" aria-label={cardLabel(c)}>
      <span className="card__corner" aria-hidden="true">
        <span className="card__rank">{c.rank}</span>
        <span className="card__suit">{symbol}</span>
      </span>
      <span className="card__center" aria-hidden="true">
        {c.rank === "K" || c.rank === "J" || c.rank === "Q" ? c.rank : symbol}
      </span>
      <span className="card__corner card__corner--end" aria-hidden="true">
        <span className="card__rank">{c.rank}</span>
        <span className="card__suit">{symbol}</span>
      </span>
    </span>
  );
}

export function CardBack({ size = "mini" }: { size?: "mini" | "table" }) {
  return <span className={`card card--${size} card--back`} aria-hidden="true" />;
}
