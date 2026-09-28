import { useEffect, useRef, useState } from "react";
import { gringo } from "@cardly/engine";
import type { PublicPlayer } from "@cardly/protocol";
import { ABILITY_NAME, cardLabel } from "../i18n";
import type { RoomClient } from "../net/useRoom";
import { CardBack, CardFace } from "../ui/Card";
import { MyTurnBar, TurnClock, useSecondsLeft } from "../ui/Countdown";
import { RulesButton } from "../ui/RulesDialog";
import { LeaveButton, PausedSheet } from "./Table";

type View = gringo.GringoView;

/** What the table is waiting for from me right now. */
type Task =
  | "peek"
  | "peek-done"
  | "draw"
  | "locked"
  | "place"
  | "queen"
  | "jack"
  | "king-pick"
  | "king-decide"
  | "none";

function taskOf(v: View): Task {
  const me = v.mySeat;
  if (v.phase === "PEEK") return v.peeked[me] ? "peek-done" : "peek";
  if (v.phase !== "PLAYING") return "none";
  const a = v.ability;
  if (a) {
    if (a.seat !== me) return "none";
    if (a.kind === "QUEEN") return "queen";
    if (a.kind === "JACK") return "jack";
    return a.targetSlotId ? "king-decide" : "king-pick";
  }
  if (v.turnSeat !== me) return "none";
  if (v.hasDrawn) return "place";
  return v.window ? "locked" : "draw";
}

const cardName = (id: string) => cardLabel(gringo.card(id));

/** How long a card you are allowed to look at stays face up. Then you must remember it. */
const GLIMPSE_MS = 5000;

/** Slot id → card, for cards currently shown to me once. */
function useGlimpse(client: RoomClient): Record<string, string> {
  const g = client.glimpse;
  const [seen, setSeen] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!g) return;
    setSeen(Object.fromEntries(g.cards.map((c) => [c.slotId, c.cardId])));
    const t = setTimeout(() => setSeen({}), GLIMPSE_MS);
    return () => clearTimeout(t);
  }, [g?.id]);
  return seen;
}

export function GringoTable({ client }: { client: RoomClient }) {
  const room = client.room!;
  const view = client.gringo;

  if (!view) {
    return (
      <main className="center-page felt">
        <p className="paper paper--narrow">A carregar a mesa…</p>
      </main>
    );
  }

  const playerAt = (seat: number) => room.players.find((p) => p.seat === seat)!;
  const nameOf = (seat: number) => playerAt(seat).name;
  const n = view.playerCount;
  // Reverse play order, left to right: the next player sits at my right.
  const opponents = Array.from({ length: n - 1 }, (_, i) => (view.mySeat + n - 1 - i) % n);

  return (
    <GringoBoard
      key={view.roundNumber}
      client={client}
      view={view}
      opponents={opponents}
      playerAt={playerAt}
      nameOf={nameOf}
    />
  );
}

interface BoardProps {
  client: RoomClient;
  view: View;
  opponents: number[];
  playerAt: (seat: number) => PublicPlayer;
  nameOf: (seat: number) => string;
}

function GringoBoard({ client, view, opponents, playerAt, nameOf }: BoardProps) {
  const room = client.room!;
  const me = view.mySeat;
  const task = taskOf(view);
  const [mine, setMine] = useState<string[]>([]);
  const [theirs, setTheirs] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const seen = useGlimpse(client);

  // A selection only lives as long as the task it was made for.
  const taskKey = `${task}:${view.turnNumber}:${view.ability?.cardId ?? ""}`;
  useEffect(() => {
    setMine([]);
    setTheirs(null);
  }, [taskKey]);
  // Match mode answers one discard; a new card on top turns it off.
  useEffect(() => setMatching(false), [view.event?.id]);

  const canMatch =
    view.phase === "PLAYING" && !!view.event && !view.triedThisEvent && !view.ability && view.hands[me]!.length > 0;
  const canAct = !client.pending;
  const send = client.send;

  function onMySlot(slotId: string) {
    if (!canAct) return;
    if (matching && view.event) {
      send({ type: "G_MATCH", slotId, eventId: view.event.id });
      setMatching(false);
      return;
    }
    if (task === "peek") {
      setMine((cur) => (cur.includes(slotId) ? cur.filter((x) => x !== slotId) : cur.length < 2 ? [...cur, slotId] : cur));
    } else if (task === "place" || task === "queen" || task === "jack" || task === "king-pick") {
      setMine((cur) => (cur[0] === slotId ? [] : [slotId]));
    }
  }

  const targeting = task === "jack" || task === "king-pick";
  function onTheirSlot(slotId: string) {
    if (!canAct || !targeting) return;
    setTheirs((cur) => (cur === slotId ? null : slotId));
  }

  const a = view.ability;
  const involved = new Set([a?.mySlotId, a?.targetSlotId].filter((x): x is string => !!x));
  const actingSeat = view.phase !== "PLAYING" ? null : a ? a.seat : view.window ? null : view.turnSeat;

  return (
    <main className="game gtable felt">
      <header className="gbar">
        <div className="gbar__round">
          <span className="gbar__title">Gringo</span>
          <span className="gbar__meta">Ronda {view.roundNumber}</span>
        </div>
        {view.caller !== null && (
          <p className="gbar__called" role="status">
            Gringo! {view.caller === me ? "Chamaste" : `${nameOf(view.caller)} chamou`}. Últimas jogadas.
          </p>
        )}
        <div className="scorebar__tools">
          <RulesButton game="gringo" />
          <LeaveButton client={client} inMatch />
        </div>
      </header>

      <section className="gboard" aria-label="Mesa">
        <div className="gopps">
          {opponents.map((seat) => (
            <Opponent
              key={seat}
              seat={seat}
              view={view}
              player={playerAt(seat)}
              client={client}
              acting={actingSeat === seat}
              targeting={targeting}
              picked={theirs}
              involved={involved}
              seen={seen}
              onSlot={onTheirSlot}
            />
          ))}
        </div>

        <Center client={client} view={view} nameOf={nameOf} />
      </section>

      <MyArea
        client={client}
        view={view}
        task={task}
        me={playerAt(me)}
        selected={mine}
        theirs={theirs}
        involved={involved}
        seen={seen}
        matching={matching}
        canMatch={canMatch}
        onSlot={onMySlot}
        onToggleMatch={() => setMatching((m) => !m)}
      />

      {room.vacancies.length > 0 ? (
        <PausedSheet client={client} />
      ) : (
        view.phase === "ROUND_RESULT" && <RoundResultSheet client={client} view={view} nameOf={nameOf} />
      )}
    </main>
  );
}

interface OpponentProps {
  seat: number;
  view: View;
  player: PublicPlayer;
  client: RoomClient;
  acting: boolean;
  targeting: boolean;
  picked: string | null;
  involved: Set<string>;
  seen: Record<string, string>;
  onSlot: (slotId: string) => void;
}

function Opponent({ seat, view, player, client, acting, targeting, picked, involved, seen, onSlot }: OpponentProps) {
  const slots = view.hands[seat]!;
  return (
    <div className={`gopp ${acting ? "is-active" : ""}`}>
      <div className="plate">
        <span className="plate__name">{player.name}</span>
        <span className="plate__meta">
          {slots.length === 1 ? "1 carta" : `${slots.length} cartas`}
          {player.bot && ", bot"}
          {view.caller === seat && ", chamou Gringo"}
          {!player.connected && <span className="plate__off">, desligado</span>}
        </span>
        {acting && (
          <TurnClock deadline={client.room!.turnDeadline} clockOffset={client.clockOffset} total={view.rules.turnTimerSeconds} />
        )}
      </div>
      <div className="gslots" role="group" aria-label={`Cartas de ${player.name}`}>
        {slots.map((x, i) => {
          const face = x.cardId ?? seen[x.id];
          return (
            <button
              key={x.id}
              type="button"
              className={`gslot ${picked === x.id ? "is-picked" : ""} ${involved.has(x.id) ? "is-involved" : ""} ${
                seen[x.id] ? "is-glimpse" : ""
              }`}
              disabled={!targeting}
              aria-pressed={targeting ? picked === x.id : undefined}
              aria-label={`Carta ${i + 1} de ${player.name}${face ? `: ${cardName(face)}` : ", virada para baixo"}`}
              onClick={() => onSlot(x.id)}
            >
              {face ? <CardFace id={face} size="slot" /> : <CardBack size="slot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Center({ client, view, nameOf }: { client: RoomClient; view: View; nameOf: (s: number) => string }) {
  const me = view.mySeat;
  const lockSecs = useSecondsLeft(view.window ? client.room!.windowDeadline : null, client.clockOffset);
  const last = view.log.at(-1);

  let status: string;
  if (view.phase === "PEEK") {
    const waiting = view.peeked.filter((p) => !p).length;
    status = view.peeked[me]
      ? waiting === 1
        ? "À espera de 1 jogador que ainda está a escolher cartas."
        : `À espera de ${waiting} jogadores que ainda estão a escolher cartas.`
      : "Escolhe 2 das tuas cartas para ver. Só tu as vês.";
  } else if (view.phase !== "PLAYING") {
    status = "Ronda terminada.";
  } else if (view.ability) {
    const a = view.ability;
    const who = a.seat === me ? "Estás" : `${nameOf(a.seat)} está`;
    status = `${who} a usar ${a.kind === "QUEEN" ? "a" : "o"} ${ABILITY_NAME[a.kind]}.`;
  } else if (view.window) {
    const owner = view.window.owner;
    const turn = view.turnSeat === me ? "Tiras" : `${nameOf(view.turnSeat)} tira`;
    status =
      owner !== null && owner !== me
        ? `${nameOf(owner)} pode usar a habilidade. ${turn} daqui a ${lockSecs ?? 0}s.`
        : `${turn} daqui a ${lockSecs ?? 0}s.`;
  } else if (view.turnSeat === me) {
    status = view.hasDrawn ? "Descarta a carta ou troca-a por uma tua." : "A tua vez: tira uma carta do monte.";
  } else {
    status = view.hasDrawn ? `${nameOf(view.turnSeat)} está a decidir o que fazer.` : `Vez de ${nameOf(view.turnSeat)}.`;
  }

  const seen = view.ability?.seenCardId;
  return (
    <div className="gcenter">
      <div className="gpiles">
        <div className="gpile">
          <CardBack size="table" className={view.drawCount === 0 ? "is-empty" : ""} />
          <span className="gpile__label">Monte: {view.drawCount}</span>
        </div>
        <div className="gpile" aria-live="polite">
          {view.discardTop ? (
            <CardFace key={view.event?.id} id={view.discardTop} size="table" className="gdrop" />
          ) : (
            <span className="card card--table card--empty" aria-hidden="true" />
          )}
          <span className="gpile__label">
            {view.discardTop ? `Descarte${view.event ? `, de ${view.event.seat === me ? "ti" : nameOf(view.event.seat)}` : ""}` : "Descarte vazio"}
          </span>
        </div>
        {view.drawn && (
          <div className="gpile gpile--drawn">
            <CardFace id={view.drawn} size="table" />
            <span className="gpile__label">Tiraste</span>
          </div>
        )}
        {seen && (
          <div className="gpile gpile--drawn">
            <CardFace id={seen} size="table" />
            <span className="gpile__label">A carta de {nameOf(view.hands.findIndex((h) => h.some((x) => x.id === view.ability!.targetSlotId)))}</span>
          </div>
        )}
      </div>
      {view.window && (
        <span className="glock" aria-hidden="true">
          <span
            key={view.window.eventId}
            className="glock__bar"
            style={{ animationDuration: `${view.rules.abilityWindowSeconds}s` }}
          />
        </span>
      )}
      <p className="gstatus" role="status">
        {status}
      </p>
      {last && <p className="glast">{logText(last, nameOf, me)}</p>}
    </div>
  );
}

interface MyAreaProps {
  client: RoomClient;
  view: View;
  task: Task;
  me: PublicPlayer;
  selected: string[];
  theirs: string | null;
  involved: Set<string>;
  seen: Record<string, string>;
  matching: boolean;
  canMatch: boolean;
  onSlot: (slotId: string) => void;
  onToggleMatch: () => void;
}

const TASK_BAR: Partial<Record<Task, { label: string; warn: string }>> = {
  peek: { label: "Escolhe 2 cartas", warn: "Se não escolheres, escolhem-se 2 ao acaso." },
  draw: { label: "É a tua vez", warn: "Se não jogares, tira-se e descarta-se por ti." },
  locked: { label: "É a tua vez", warn: "Se não jogares, tira-se e descarta-se por ti." },
  place: { label: "É a tua vez", warn: "Se não jogares, a carta tirada vai para o descarte." },
  queen: { label: "Usa a Dama", warn: "Se não acabares, perdes a habilidade." },
  jack: { label: "Usa o Valete", warn: "Se não acabares, perdes a habilidade." },
  "king-pick": { label: "Usa o Rei preto", warn: "Se não acabares, perdes a habilidade." },
  "king-decide": { label: "Trocas ou não?", warn: "Se não decidires, ficas com a tua carta." },
};

function MyArea({ client, view, task, me, selected, theirs, involved, seen, matching, canMatch, onSlot, onToggleMatch }: MyAreaProps) {
  const room = client.room!;
  const send = client.send;
  const busy = client.pending;
  const slots = view.hands[view.mySeat]!;
  const bar = TASK_BAR[task];
  const owner = view.window && view.window.owner === view.mySeat;
  const claimSecs = useSecondsLeft(owner ? room.windowDeadline : null, client.clockOffset);

  const pickable =
    matching || task === "peek" || task === "place" || task === "queen" || task === "jack" || task === "king-pick";

  let hint = "";
  const glimpsing = slots.some((x) => seen[x.id]);
  if (glimpsing && !matching) hint = "Memoriza: daqui a pouco voltam a ficar viradas para baixo.";
  else if (matching) hint = "Toca na carta igual à do descarte. Se errares, levas uma carta de castigo.";
  else if (task === "peek") hint = `Escolhe 2 cartas para ver (${selected.length} de 2).`;
  else if (task === "place") hint = selected.length ? "Trocas a carta tirada por esta." : "Toca numa carta tua para trocar, ou descarta.";
  else if (task === "queen") hint = "Escolhe uma carta tua para ver.";
  else if (task === "jack") hint = "Escolhe uma carta tua e uma de outro jogador. A troca é às cegas.";
  else if (task === "king-pick") hint = "Escolhe uma carta tua e uma de outro jogador. Vais ver a dele antes de decidir.";
  else if (task === "king-decide") hint = "Viste a carta. Trocas pela tua?";

  return (
    <section className={`hand ghand ${bar ? "is-active" : ""}`} aria-label="As tuas cartas">
      {bar && (
        <MyTurnBar
          deadline={room.turnDeadline}
          clockOffset={client.clockOffset}
          total={view.rules.turnTimerSeconds}
          label={bar.label}
          warn={bar.warn}
        />
      )}

      {owner && view.event && (
        <button
          type="button"
          className="btn gclaim"
          disabled={busy}
          onClick={() => send({ type: "G_USE_ABILITY", eventId: view.event!.id })}
        >
          Usar habilidade: {ABILITY_NAME[gringo.card(view.event.cardId).ability!]}
          {claimSecs !== null && <span className="gclaim__secs">{claimSecs}s</span>}
        </button>
      )}

      <div className="hand__bar">
        <div className="plate plate--me">
          <span className="plate__name">{me.name}</span>
          <span className="plate__meta">
            Tu{view.caller === view.mySeat && ", chamaste Gringo"}
          </span>
        </div>
        <p className="hand__hint">{hint}</p>
      </div>

      <div className="gmine" role="group" aria-label="As tuas cartas">
        {slots.map((x, i) => {
          const face = x.cardId ?? seen[x.id];
          return (
            <button
              key={x.id}
              type="button"
              className={`gslot gslot--mine ${selected.includes(x.id) ? "is-picked" : ""} ${
                involved.has(x.id) ? "is-involved" : ""
              } ${matching ? "is-matchable" : ""} ${seen[x.id] ? "is-glimpse" : ""}`}
              disabled={!pickable || busy}
              aria-pressed={pickable ? selected.includes(x.id) : undefined}
              aria-label={`A tua carta ${i + 1}${face ? `: ${cardName(face)}` : ", virada para baixo"}`}
              onClick={() => onSlot(x.id)}
            >
              {face ? <CardFace id={face} size="hand" /> : <CardBack size="hand" />}
            </button>
          );
        })}
      </div>

      <div className="gactions">
        {task === "peek" && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={selected.length !== 2 || busy}
            onClick={() => send({ type: "G_PEEK", slotIds: selected })}
          >
            Ver estas 2 cartas
          </button>
        )}
        {(task === "draw" || task === "locked") && (
          <button type="button" className="btn btn--primary" disabled={task === "locked" || busy} onClick={() => send({ type: "G_DRAW" })}>
            {task === "locked" ? "Espera um instante…" : "Tirar carta"}
          </button>
        )}
        {task === "place" && (
          <>
            {selected[0] && (
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => send({ type: "G_SWAP", slotId: selected[0]! })}>
                Trocar por esta
              </button>
            )}
            <button type="button" className={`btn ${selected[0] ? "" : "btn--primary"}`} disabled={busy} onClick={() => send({ type: "G_DISCARD" })}>
              Descartar a carta tirada
            </button>
          </>
        )}
        {task === "queen" && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!selected[0] || busy}
            onClick={() => send({ type: "G_TARGET", mySlotId: selected[0]!, targetSlotId: null })}
          >
            Ver esta carta
          </button>
        )}
        {(task === "jack" || task === "king-pick") && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!selected[0] || !theirs || busy}
            onClick={() => send({ type: "G_TARGET", mySlotId: selected[0]!, targetSlotId: theirs })}
          >
            {task === "jack" ? "Trocar às cegas" : "Ver a carta dele"}
          </button>
        )}
        {task === "king-decide" && (
          <>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => send({ type: "G_KING_DECIDE", swap: true })}>
              Trocar
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => send({ type: "G_KING_DECIDE", swap: false })}>
              Ficar com a minha
            </button>
          </>
        )}

        {(canMatch || matching) && (
          <button type="button" className={`btn gmatch ${matching ? "is-on" : ""}`} aria-pressed={matching} onClick={onToggleMatch}>
            {matching ? "Cancelar" : "Igualar"}
          </button>
        )}
        {view.phase === "PLAYING" && view.caller === null && <GringoCall client={client} view={view} />}
      </div>
    </section>
  );
}

function GringoCall({ client, view }: { client: RoomClient; view: View }) {
  const ref = useRef<HTMLDialogElement>(null);
  const isTurn = view.turnSeat === view.mySeat && !view.hasDrawn;
  return (
    <>
      <button type="button" className="btn ggringo" onClick={() => ref.current?.showModal()}>
        Gringo!
      </button>
      <dialog ref={ref} className="sheet sheet--small" aria-labelledby="gringo-title">
        <div className="sheet__body leave">
          <h2 id="gringo-title">Chamar Gringo?</h2>
          <p>
            Os outros jogam mais uma vez e a ronda acaba quando a vez voltar a ti. Só se pode chamar uma vez por ronda.
            {isTurn && " Como ainda não tiraste carta, a chamada é a tua jogada."}
          </p>
          <div className="leave__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                client.send({ type: "G_CALL_GRINGO" });
                ref.current?.close();
              }}
            >
              Chamar Gringo
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => ref.current?.close()}>
              Ainda não
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function logText(e: gringo.LogEntry, nameOf: (s: number) => string, me: number): string {
  const who = (s: number) => (s === me ? "Tu" : nameOf(s));
  const verb = (s: number, mine: string, theirs: string) => (s === me ? mine : theirs);
  switch (e.type) {
    case "DREW":
      return `${who(e.seat)} ${verb(e.seat, "tiraste", "tirou")} uma carta.`;
    case "DISCARDED":
      return e.auto
        ? `Acabou o tempo de ${who(e.seat)}: ${cardName(e.cardId)} foi para o descarte.`
        : `${who(e.seat)} ${verb(e.seat, "descartaste", "descartou")} ${cardName(e.cardId)}.`;
    case "SWAPPED":
      return `${who(e.seat)} ${verb(e.seat, "trocaste", "trocou")} uma carta e ${verb(e.seat, "descartaste", "descartou")} ${cardName(e.cardId)}.`;
    case "MATCHED":
      return `${who(e.seat)} ${verb(e.seat, "igualaste", "igualou")} com ${cardName(e.cardId)}.`;
    case "WRONG_MATCH":
      return `${who(e.seat)} ${verb(e.seat, "erraste", "errou")} a igualar: ${cardName(e.cardId)} não serve.${
        e.penalty ? ` ${verb(e.seat, "Levaste", "Levou")} uma carta de castigo.` : ""
      }`;
    case "ABILITY":
      return `${who(e.seat)} ${verb(e.seat, "usaste", "usou")} ${e.kind === "QUEEN" ? "a" : "o"} ${ABILITY_NAME[e.kind]}.`;
    case "QUEEN_LOOKED":
      return `${who(e.seat)} ${verb(e.seat, "viste", "viu")} uma das ${verb(e.seat, "tuas", "suas")} cartas.`;
    case "JACK_SWAPPED":
      return `${who(e.seat)} ${verb(e.seat, "trocaste", "trocou")} às cegas uma carta ${e.targetSeat === me ? "contigo" : `com ${nameOf(e.targetSeat)}`}.`;
    case "KING_LOOKED":
      return `${who(e.seat)} ${verb(e.seat, "estás", "está")} a ver uma carta de ${e.targetSeat === me ? "ti" : nameOf(e.targetSeat)}.`;
    case "KING_DECIDED":
      return e.swapped
        ? `${who(e.seat)} ${verb(e.seat, "trocaste", "trocou")} as cartas.`
        : `${who(e.seat)} ${verb(e.seat, "ficaste", "ficou")} com a ${verb(e.seat, "tua", "sua")} carta.`;
    case "ABILITY_EXPIRED":
      return `Acabou o tempo de ${who(e.seat)} para usar a habilidade.`;
    case "GRINGO":
      return `${who(e.seat)} ${verb(e.seat, "chamaste", "chamou")} Gringo!`;
  }
}

function RoundResultSheet({ client, view, nameOf }: { client: RoomClient; view: View; nameOf: (s: number) => string }) {
  const r = view.result!;
  const room = client.room!;
  const me = room.players.find((p) => p.id === client.playerId)!;
  const isHost = room.hostId === me.id;
  const secs = useSecondsLeft(room.continueDeadline, client.clockOffset);
  const waiting = room.players.filter((p) => p.continued).length;
  const order = r.totals.map((t, seat) => ({ seat, t })).sort((x, y) => x.t - y.t);

  let headline: string;
  if (r.winners.length > 1) headline = r.winners.includes(view.mySeat) ? "Empataste a ronda" : "Empate";
  else headline = r.winners[0] === view.mySeat ? "Ganhaste a ronda" : `${nameOf(r.winners[0]!)} ganhou`;

  let reason: string;
  if (r.reason === "EMPTY_HAND") reason = `${r.emptied === view.mySeat ? "Ficaste" : `${nameOf(r.emptied!)} ficou`} sem cartas.`;
  else if (r.reason === "PILE_EMPTY") reason = "Acabou o monte.";
  else reason = `Gringo chamado por ${r.caller === view.mySeat ? "ti" : nameOf(r.caller!)}.`;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="round-title">
      <div className="paper result">
        <h2 id="round-title" className="result__title">
          {headline}
        </h2>
        <p className="result__meta">{reason}</p>

        <table className="result__table gresult">
          <thead>
            <tr>
              <th scope="col">Jogador</th>
              <th scope="col">Cartas</th>
              <th scope="col">Pontos</th>
            </tr>
          </thead>
          <tbody>
            {order.map(({ seat, t }) => (
              <tr key={seat} className={r.winners.includes(seat) ? "is-winner" : ""}>
                <th scope="row">
                  {seat === view.mySeat ? "Tu" : nameOf(seat)}
                  {r.caller === seat && <span className="gresult__tag">Gringo</span>}
                </th>
                <td>
                  <span className="gresult__cards">
                    {r.hands[seat]!.length === 0 ? "—" : r.hands[seat]!.map((id) => <CardFace key={id} id={id} size="slot" />)}
                  </span>
                </td>
                <td>{t}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="result__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={me.continued}
            onClick={() => client.send({ type: "CONTINUE" })}
          >
            {me.continued ? `À espera dos outros (${waiting}/${room.players.length})` : "Próxima ronda"}
          </button>
          {isHost && (
            <button type="button" className="btn" onClick={() => client.send({ type: "END_MATCH" })}>
              Voltar à sala
            </button>
          )}
        </div>
        {secs !== null && <p className="result__wait">A próxima ronda começa em {secs}s.</p>}
      </div>
    </div>
  );
}
