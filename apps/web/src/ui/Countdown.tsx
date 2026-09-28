import { useEffect, useState } from "react";

/** Seconds left until a server deadline. The server decides; this only displays. */
export function useSecondsLeft(deadline: number | null, clockOffset: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - (now + clockOffset)) / 1000));
}

export type Urgency = "calm" | "warn" | "danger";

export const urgencyOf = (secs: number): Urgency => (secs <= 5 ? "danger" : secs <= 10 ? "warn" : "calm");

interface ClockProps {
  deadline: number | null;
  clockOffset: number;
  total: number;
}

/** Round seconds badge with a draining ring, for another player's name plate. */
export function TurnClock({ deadline, clockOffset, total }: ClockProps) {
  const secs = useSecondsLeft(deadline, clockOffset);
  if (secs === null || total <= 0) return null;
  const frac = Math.min(1, secs / total);
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className={`clock clock--${urgencyOf(secs)}`} role="timer" aria-label={`${secs} segundos para jogar`}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="clock__track" cx="18" cy="18" r={r} />
        <circle
          className="clock__fill"
          cx="18"
          cy="18"
          r={r}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <span className="clock__secs">{secs}</span>
    </span>
  );
}

/** Full-width bar above my hand while it is my turn. Also puts the countdown in the tab title. */
export function MyTurnBar({ deadline, clockOffset, total }: ClockProps) {
  const secs = useSecondsLeft(deadline, clockOffset);

  useEffect(() => {
    if (secs === null) return;
    const prev = document.title;
    document.title = `(${secs}s) É a tua vez`;
    return () => {
      document.title = prev;
    };
  }, [secs]);

  if (secs === null || total <= 0) {
    return <p className="myturn myturn--calm">É a tua vez</p>;
  }
  const level = urgencyOf(secs);
  return (
    <div className={`myturn myturn--${level}`} role="timer" aria-live={level === "danger" ? "assertive" : "off"}>
      <div className="myturn__row">
        <span className="myturn__label">É a tua vez</span>
        <span className="myturn__secs">{secs}s</span>
      </div>
      <span className="myturn__track" aria-hidden="true">
        <span className="myturn__bar" style={{ transform: `scaleX(${Math.min(1, secs / total)})` }} />
      </span>
      {level === "danger" && <span className="myturn__warn">Se não jogares, joga-se por ti a carta mais baixa.</span>}
    </div>
  );
}
