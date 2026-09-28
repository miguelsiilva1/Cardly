import { sueca } from "@cardly/engine";
import { riscos, SUIT_NAME } from "../i18n";
import type { RoomClient } from "../net/useRoom";
import { useSecondsLeft } from "../ui/Countdown";
import { Tally } from "../ui/Tally";

const teamName = (team: sueca.Team, mySeat: number) =>
  team === sueca.teamOf(mySeat) ? "Nós" : "Eles";

export function HandResultSheet({ client, view }: { client: RoomClient; view: sueca.SuecaView }) {
  const r = view.lastHandResult!;
  const room = client.room!;
  const me = room.players.find((p) => p.id === client.playerId)!;
  const waiting = room.players.filter((p) => p.continued).length;
  const secs = useSecondsLeft(room.continueDeadline, client.clockOffset);
  const mine = sueca.teamOf(view.mySeat);
  const order: sueca.Team[] = mine === "A" ? ["A", "B"] : ["B", "A"];

  let headline: string;
  if (r.tie) headline = "Empate a 60";
  else headline = r.winner === mine ? "Ganhámos a mão" : "Perdemos a mão";

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="hand-title">
      <div className="paper result">
        <h2 id="hand-title" className="result__title">
          {headline}
        </h2>

        {r.capote && (
          <p className="result__flag">
            Capote! {teamName(r.capote, view.mySeat)} fizeram os 120 pontos.
          </p>
        )}
        {r.bandeira && (
          <p className="result__flag">
            Bandeira! {teamName(r.bandeira, view.mySeat)} ganharam as 10 rondas.
          </p>
        )}

        <table className="result__table">
          <thead>
            <tr>
              <th scope="col"></th>
              <th scope="col">Pontos</th>
              <th scope="col">Rondas</th>
              <th scope="col">Nesta mão</th>
              <th scope="col">No jogo</th>
            </tr>
          </thead>
          <tbody>
            {order.map((t) => (
              <tr key={t} className={`team-${t}`}>
                <th scope="row">{teamName(t, view.mySeat)}</th>
                <td>{r.points[t]}</td>
                <td>{r.tricks[t]}</td>
                <td>+{r.awarded[t]}</td>
                <td>
                  <Tally count={view.risks[t]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="result__meta">
          Trunfo era {SUIT_NAME[r.trumpSuit]}. Jogo até {riscos(view.rules.targetRisks)}.
          {view.carry > 0 && ` ${riscos(view.carry)} passa para a próxima mão.`}
        </p>

        <div className="result__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={me.continued}
            onClick={() => client.send({ type: "CONTINUE" })}
          >
            {me.continued ? "À espera dos outros" : "Continuar"}
          </button>
          <span className="result__wait">
            {waiting} de 4 prontos{secs !== null && `. A próxima mão começa em ${secs}s`}
          </span>
        </div>
      </div>
    </div>
  );
}

export function MatchResultSheet({ client, view }: { client: RoomClient; view: sueca.SuecaView }) {
  const room = client.room!;
  const isHost = room.hostId === client.playerId;
  const mine = sueca.teamOf(view.mySeat);
  const won = view.winner === mine;
  const names = (team: sueca.Team) =>
    room.players
      .filter((p) => p.seat !== null && sueca.teamOf(p.seat) === team)
      .map((p) => p.name)
      .join(" e ");

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="match-title">
      <div className="paper result result--final">
        <h2 id="match-title" className="result__title">
          {won ? "Ganhámos o jogo" : "Perdemos o jogo"}
        </h2>
        <p className="result__winners">Ganharam {names(view.winner!)}.</p>

        <div className="final-score">
          {(mine === "A" ? (["A", "B"] as const) : (["B", "A"] as const)).map((t) => (
            <div key={t} className={`final-score__row team-${t}`}>
              <span>{teamName(t, view.mySeat)}</span>
              <Tally count={view.risks[t]} />
              <strong>{view.risks[t]}</strong>
            </div>
          ))}
        </div>

        <div className="result__actions">
          {isHost ? (
            <button type="button" className="btn btn--primary" onClick={() => client.send({ type: "PLAY_AGAIN" })}>
              Jogar outra vez
            </button>
          ) : (
            <span className="result__wait">O anfitrião pode começar outro jogo.</span>
          )}
        </div>
      </div>
    </div>
  );
}
