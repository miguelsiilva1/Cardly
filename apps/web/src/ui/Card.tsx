import { gringo } from "@cardly/engine";
import { cardLabel, SUIT_SYMBOL } from "../i18n";

type Size = "hand" | "table" | "trump" | "mini" | "slot";

interface FaceProps {
  id: string;
  size?: Size;
  className?: string;
}

/** Card face for either deck. Rank + suit in the corners, one big pip or letter in the middle. */
export function CardFace({ id, size = "table", className = "" }: FaceProps) {
  const c = gringo.card(id);
  if (!c.suit) {
    return (
      <span className={`card card--${size} card--joker ${className}`} role="img" aria-label={cardLabel(c)}>
        <span className="card__corner" aria-hidden="true">
          <span className="card__rank">★</span>
        </span>
        <span className="card__center card__center--word" aria-hidden="true">
          Joker
        </span>
        <span className="card__corner card__corner--end" aria-hidden="true">
          <span className="card__rank">★</span>
        </span>
      </span>
    );
  }
  const symbol = SUIT_SYMBOL[c.suit];
  const tone = c.red ? "card--red" : "card--black";
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

export function CardBack({ size = "mini", className = "" }: { size?: Size; className?: string }) {
  return <span className={`card card--${size} card--back ${className}`} aria-hidden="true" />;
}
