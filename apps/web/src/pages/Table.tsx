import { useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../App";
import { sueca } from "@cardly/engine";
import type { PublicPlayer } from "@cardly/protocol";
import { SUIT_NAME, SUIT_SYMBOL } from "../i18n";
import type { RoomClient } from "../net/useRoom";
import { CardBack, CardFace } from "../ui/Card";
import { MyTurnBar, TurnClock } from "../ui/Countdown";
import { RulesButton } from "../ui/RulesDialog";
import { Tally } from "../ui/Tally";
import { HandResultSheet, MatchResultSheet } from "./Results";

/** Screen position of a seat relative to mine. Next in play order sits on my right. */
const REL_POS = ["bottom", "right", "top", "left"] as const;
type Pos = (typeof REL_POS)[number];

/** How long a finished trick stays in the middle before it is cleared. */
const TRICK_HOLD_MS = 1600;

const SUIT_ORDER: sueca.Suit[] = ["spades", "hearts", "clubs", "diamonds"];

/** Who played the trump card, and in which round. Null while it is still in the dealer's hand. */
function trumpPlayed(view: sueca.SuecaView): { seat: number; round: number } | null {
  for (const t of [...view.completedTricks, view.trick]) {
    const p = t.plays.find((x) => x.cardId === view.trumpCardId);
    if (p) return { seat: p.seat, round: t.number };
  }
  return null;
}

function sortHand(ids: string[], trump: sueca.Suit): string[] {
  // Trump last, suits alternating colour, strongest first inside a suit.
  const order = [...SUIT_ORDER.filter((s) => s !== trump), trump];
  return [...ids].sort((a, b) => {
    const ca = sueca.card(a);
    const cb = sueca.card(b);
    return order.indexOf(ca.suit) - order.indexOf(cb.suit) || cb.strength - ca.strength;
  });
}

export function Table({ client }: { client: RoomClient }) {
  const room = client.room!;
  const view = client.sueca;
  const [holdUntil, setHoldUntil] = useState(0);

  // Keep a completed trick on screen for a moment so everyone sees who won it.
  useEffect(() => {
    if (!client.events.list.some((e) => e.type === "TRICK_COMPLETED")) return;
    setHoldUntil(Date.now() + TRICK_HOLD_MS);
    const t = setTimeout(() => setHoldUntil(0), TRICK_HOLD_MS);
    return () => clearTimeout(t);
  }, [client.events]);

  if (!view) {
    return (
      <main className="center-page felt">
        <p className="paper paper--narrow">A carregar a mesa…</p>
      </main>
    );
  }

  const mySeat = view.mySeat;
  const myTeam = sueca.teamOf(mySeat);
  const theirTeam: sueca.Team = myTeam === "A" ? "B" : "A";
  const playerAt = (seat: number) => room.players.find((p) => p.seat === seat)!;
  const posOf = (seat: number): Pos => REL_POS[(seat - mySeat + 4) % 4]!;

  const last = view.completedTricks.at(-1);
  const showLast = !!last && view.trick.plays.length === 0 && holdUntil > Date.now();
  const plays = showLast ? last.plays : view.trick.plays;
  const winnerSeat = showLast ? last.winnerSeat : null;
  const trickNumber = Math.min(view.trick.number, 10);
  const myTurn = view.phase === "PLAYING" && view.turnSeat === mySeat;
  const played = trumpPlayed(view);
  let trumpWhere: string;
  if (played) {
    trumpWhere =
      played.seat === mySeat
        ? `Jogaste-o na ronda ${played.round}`
        : `${playerAt(played.seat).name} jogou-o na ronda ${played.round}`;
  } else if (view.dealerSeat === mySeat) {
    trumpWhere = "Está na tua mão";
  } else {
    trumpWhere = `Está na mão de ${playerAt(view.dealerSeat).name}`;
  }

  return (
    <main className="game felt">
      <header className="scorebar">
        <div className="slip" aria-label="Marcador">
          <ScoreLine label="Nós" team={myTeam} view={view} />
          <ScoreLine label="Eles" team={theirTeam} view={view} />
        </div>
        <div className="scorebar__info">
          <div className="trump">
            <CardFace id={view.trumpCardId} size="trump" className={played ? "is-gone" : ""} />
            <span className="trump__text">
              <span className="trump__suit">
                Trunfo: <strong>{SUIT_NAME[view.trumpSuit]}</strong>{" "}
                <span className="trump__symbol" aria-hidden="true">
                  {SUIT_SYMBOL[view.trumpSuit]}
                </span>
              </span>
              <span className="trump__who">{trumpWhere}</span>
            </span>
          </div>
          <div className="scorebar__tools">
            <span className="trick-count">Ronda {trickNumber} de 10</span>
            <HistoryButton view={view} playerAt={playerAt} />
            <RulesButton />
            <LeaveButton client={client} />
          </div>
        </div>
      </header>

      <section className="board" aria-label="Mesa">
        {[1, 2, 3].map((offset) => {
          const seat = (mySeat + offset) % 4;
          return (
            <Opponent
              key={seat}
              pos={posOf(seat)}
              player={playerAt(seat)}
              seat={seat}
              view={view}
              room={client}
              isPartner={offset === 2}
              holdsTrump={view.dealerSeat === seat && !played}
            />
          );
        })}

        <div className="trick" aria-label="Cartas jogadas nesta ronda" aria-live="polite">
          {plays.map((p) => (
            <div
              key={p.cardId}
              className={`trick__card trick__card--${posOf(p.seat)} ${winnerSeat === p.seat ? "trick__card--win" : ""}`}
            >
              <CardFace id={p.cardId} />
            </div>
          ))}
          {showLast && (
            <p className="trick__result">
              {winnerSeat === mySeat ? "Ganhaste" : `${playerAt(winnerSeat!).name} ganhou`} a ronda
              {last.points > 0 ? `, ${last.points} pontos` : ""}
            </p>
          )}
        </div>

        <TurnLine view={view} playerAt={playerAt} mySeat={mySeat} />
      </section>

      <MyHand client={client} view={view} me={playerAt(mySeat)} myTurn={myTurn} />

      {room.vacancies.length > 0 ? (
        <PausedSheet client={client} />
      ) : (
        <>
          {view.phase === "HAND_RESULT" && <HandResultSheet client={client} view={view} />}
          {view.phase === "MATCH_RESULT" && <MatchResultSheet client={client} view={view} />}
        </>
      )}
    </main>
  );
}

function ScoreLine({ label, team, view }: { label: string; team: sueca.Team; view: sueca.SuecaView }) {
  return (
    <div className={`slip__line team-${team}`}>
      <span className="slip__who">
        {label} <span className="slip__team">(Equipa {team})</span>
      </span>
      <Tally count={view.risks[team]} />
      <span className="slip__pts">{view.handPoints[team]} pts</span>
    </div>
  );
}

interface OpponentProps {
  pos: Pos;
  player: PublicPlayer;
  seat: number;
  view: sueca.SuecaView;
  room: RoomClient;
  isPartner: boolean;
  holdsTrump: boolean;
}

function Opponent({ pos, player, seat, view, room, isPartner, holdsTrump }: OpponentProps) {
  const active = view.phase === "PLAYING" && view.turnSeat === seat;
  const count = view.handCounts[seat]!;
  return (
    <div className={`opp opp--${pos} team-${sueca.teamOf(seat)} ${active ? "is-active" : ""}`}>
      <div className="opp__backs" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <CardBack key={i} />
        ))}
      </div>
      <div className="plate">
        <span className="plate__name">{player.name}</span>
        <span className="plate__meta">
          {isPartner ? "Parceiro" : "Adversário"}
          {player.bot && ", bot"}
          {view.dealerSeat === seat && ", deu as cartas"}
          {!player.connected && <span className="plate__off">, desligado</span>}
        </span>
        <span className="sr-only">{count} cartas na mão.</span>
        {active && (
          <TurnClock
            deadline={room.room!.turnDeadline}
            clockOffset={room.clockOffset}
            total={view.rules.turnTimerSeconds}
          />
        )}
      </div>
      {holdsTrump && (
        <div className="opp__trump">
          <CardFace id={view.trumpCardId} size="mini" />
          <span>Tem o trunfo</span>
        </div>
      )}
    </div>
  );
}

function TurnLine({
  view,
  playerAt,
  mySeat,
}: {
  view: sueca.SuecaView;
  playerAt: (s: number) => PublicPlayer;
  mySeat: number;
}) {
  if (view.phase !== "PLAYING") return null;
  const led = view.trick.ledSuit;
  return (
    <p className="turn-line" role="status">
      {view.turnSeat === mySeat ? "A tua vez" : `Vez de ${playerAt(view.turnSeat).name}`}
      {led && <span className="turn-line__led">. Pediu {SUIT_NAME[led]}</span>}
    </p>
  );
}

function MyHand({
  client,
  view,
  me,
  myTurn,
}: {
  client: RoomClient;
  view: sueca.SuecaView;
  me: PublicPlayer;
  myTurn: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const cards = useMemo(() => sortHand(view.myHand, view.trumpSuit), [view.myHand, view.trumpSuit]);
  const legal = new Set(view.legalCardIds);
  const canAct = myTurn && !client.pending;

  // A selection only lives for the turn it was made in.
  useEffect(() => setSelected(null), [view.version]);

  function play(id: string) {
    client.send({ type: "PLAY_CARD", cardId: id, version: view.version });
    setSelected(null);
  }

  function onCard(id: string) {
    if (!canAct || !legal.has(id)) return;
    if (selected === id) play(id);
    else setSelected(id);
  }

  const followHint = myTurn && view.trick.ledSuit && legal.size < view.myHand.length;

  return (
    <section className={`hand team-${sueca.teamOf(view.mySeat)} ${myTurn ? "is-active" : ""}`} aria-label="A tua mão">
      {myTurn && (
        <MyTurnBar
          deadline={client.room!.turnDeadline}
          clockOffset={client.clockOffset}
          total={view.rules.turnTimerSeconds}
        />
      )}
      <div className="hand__bar">
        <div className="plate plate--me">
          <span className="plate__name">{me.name}</span>
          <span className="plate__meta">
            Tu{view.dealerSeat === view.mySeat && ", deste as cartas"}
          </span>
        </div>
        {selected ? (
          <button type="button" className="btn btn--primary" onClick={() => play(selected)} disabled={!canAct}>
            Jogar esta carta
          </button>
        ) : (
          <p className="hand__hint">
            {myTurn
              ? followHint
                ? `Tens ${SUIT_NAME[view.trick.ledSuit!]}, tens de assistir.`
                : "Toca numa carta para a escolher."
              : " "}
          </p>
        )}
      </div>

      <div className="hand__cards" style={{ ["--n" as string]: cards.length }}>
        {cards.map((id) => {
          const isLegal = canAct && legal.has(id);
          return (
            <button
              key={id}
              type="button"
              className={`hand__card ${isLegal ? "is-legal" : ""} ${selected === id ? "is-selected" : ""} ${
                myTurn && !legal.has(id) ? "is-blocked" : ""
              } ${sueca.card(id).suit === view.trumpSuit ? "is-trump" : ""}`}
              disabled={!isLegal}
              aria-pressed={selected === id}
              onClick={() => onCard(id)}
            >
              <CardFace id={id} size="hand" />
              {id === view.trumpCardId && <span className="hand__tag">Trunfo</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function LeaveButton({ client }: { client: RoomClient }) {
  const ref = useRef<HTMLDialogElement>(null);
  const inMatch = client.sueca?.phase !== "MATCH_RESULT";
  return (
    <>
      <button type="button" className="btn btn--quiet" onClick={() => ref.current?.showModal()}>
        Sair
      </button>
      <dialog ref={ref} className="sheet sheet--small" aria-labelledby="leave-title">
        <div className="sheet__body leave">
          <h2 id="leave-title">Sair da mesa?</h2>
          <p>
            {inMatch
              ? "O jogo fica em pausa e o anfitrião escolhe entre pôr um bot no teu lugar ou terminar o jogo. Não podes voltar a este lugar."
              : "Sais desta sala. Não podes voltar a este lugar."}
          </p>
          <div className="leave__actions">
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                client.leave();
                navigate("/");
              }}
            >
              Sair da mesa
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => ref.current?.close()}>
              Ficar
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/** Someone left mid-match. The host decides; everyone else waits. */
function PausedSheet({ client }: { client: RoomClient }) {
  const room = client.room!;
  const isHost = room.hostId === client.playerId;
  const names = room.vacancies.map((v) => v.name);
  const who = names.length === 1 ? `${names[0]} saiu da mesa.` : `${names.join(" e ")} saíram da mesa.`;
  const host = room.players.find((p) => p.id === room.hostId);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="paused-title">
      <div className="paper result">
        <h2 id="paused-title" className="result__title">
          Jogo em pausa
        </h2>
        <p>{who}</p>
        {isHost ? (
          <>
            <p className="result__meta">
              {names.length === 1
                ? "Podes pôr um bot no lugar e continuar a mão, ou terminar o jogo e voltar à sala."
                : "Podes pôr bots nos lugares vazios e continuar a mão, ou terminar o jogo e voltar à sala."}
            </p>
            <div className="result__actions">
              <button type="button" className="btn btn--primary" onClick={() => client.send({ type: "REPLACE_WITH_BOT" })}>
                {names.length === 1 ? "Pôr um bot no lugar" : "Pôr bots nos lugares"}
              </button>
              <button type="button" className="btn" onClick={() => client.send({ type: "END_MATCH" })}>
                Terminar o jogo
              </button>
            </div>
          </>
        ) : (
          <p className="result__wait">
            À espera que {host ? host.name : "o anfitrião"} decida se continua com um bot ou termina o jogo.
          </p>
        )}
      </div>
    </div>
  );
}

function HistoryButton({ view, playerAt }: { view: sueca.SuecaView; playerAt: (s: number) => PublicPlayer }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn--quiet"
        onClick={() => ref.current?.showModal()}
        disabled={view.completedTricks.length === 0}
      >
        Rondas
      </button>
      <dialog ref={ref} className="sheet" aria-labelledby="history-title">
        <div className="sheet__head">
          <h2 id="history-title">Rondas desta mão</h2>
          <button type="button" className="btn btn--quiet" onClick={() => ref.current?.close()}>
            Fechar
          </button>
        </div>
        <ol className="sheet__body history">
          {view.completedTricks.map((t) => (
            <li key={t.number} className="history__trick">
              <p className="history__title">
                Ronda {t.number}: ganhou {playerAt(t.winnerSeat).name}, {t.points} pontos
              </p>
              <ul className="history__plays">
                {t.plays.map((p) => (
                  <li key={p.cardId} className={p.seat === t.winnerSeat ? "is-win" : ""}>
                    <CardFace id={p.cardId} size="mini" />
                    <span>{playerAt(p.seat).name}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </dialog>
    </>
  );
}
