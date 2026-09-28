/**
 * Riscos drawn the way they are kept at the table: pencil strokes on paper,
 * every fifth one crossing the previous four.
 */
export function Tally({ count }: { count: number }) {
  const groups: number[] = [];
  for (let left = count; left > 0; left -= 5) groups.push(Math.min(5, left));

  return (
    <span className="tally" role="img" aria-label={count === 1 ? "1 risco" : `${count} riscos`}>
      {groups.length === 0 && <span className="tally__none">–</span>}
      {groups.map((n, g) => (
        <svg key={g} className="tally__group" viewBox="0 0 30 26" width="30" height="26" aria-hidden="true">
          {Array.from({ length: Math.min(n, 4) }, (_, i) => (
            // Slight wobble per stroke so it reads as handwriting, not a bar chart.
            <path
              key={i}
              d={`M${4 + i * 6.5} ${3 + (i % 2)} q ${i % 2 ? 1 : -1} 10 ${(i % 3) - 1} 20`}
            />
          ))}
          {n === 5 && <path d="M1 20 q 14 -6 28 -14" />}
        </svg>
      ))}
    </span>
  );
}
