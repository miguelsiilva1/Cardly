import { useState } from "react";
import { gringo, sueca } from "@cardly/engine";
import { SEATS, type GameKind, type PublicPlayer } from "@cardly/protocol";
import { navigate } from "../App";
import { CAPOTE_RULE_TEXT, GAME_NAME, riscos, TIE_RULE_TEXT } from "../i18n";
import type { RoomClient } from "../net/useRoom";
import { RulesButton } from "../ui/RulesDialog";

/** Seat positions around the lobby table. Play goes 0 → 1 → 2 …, to the right. */
const SEAT_POS = {
  sueca: ["bottom", "right", "top", "left"],
  gringo: ["bottom", "bottom-right", "top-right", "top", "top-left", "bottom-left"],
} as const;
type SeatPos = (typeof SEAT_POS)[GameKind][number];
const TIMER_OPTIONS = [0, 15, 30, 60] as const;

export function Lobby({ client }: { client: RoomClient }) {
  const room = client.room!;
  const me = room.players.find((p) => p.id === client.playerId)!;
  const isHost = room.hostId === me.id;
  const seated = room.players.filter((p) => p.seat !== null);
  const isGringo = room.game === "gringo";
  const missing = (isGringo ? gringo.MIN_PLAYERS : 4) - seated.length;
  const notReady = seated.filter((p) => !p.ready).length;
  const canStart = missing <= 0 && notReady === 0;

  const bySeat = (s: number) => room.players.find((p) => p.seat === s);

  return (
    <main className="lobby felt">
      <header className="lobby__head">
        <InviteCode code={room.code} game={room.game} />
        <RulesButton game={room.game} />
      </header>

      <GamePicker client={client} isHost={isHost} />

      <section className={`lobby-table lobby-table--${room.game}`} aria-label="Lugares à mesa">
        <div className="lobby-table__top" aria-hidden="true" />
        {SEAT_POS[room.game].slice(0, SEATS[room.game]).map((pos, seat) => (
          <Seat
            key={seat}
            seat={seat}
            pos={pos}
            teams={!isGringo}
            player={bySeat(seat)}
            isMe={bySeat(seat)?.id === me.id}
            hostId={room.hostId}
            canKick={isHost && !!bySeat(seat) && bySeat(seat)!.id !== me.id}
            onSit={() => client.send({ type: "TAKE_SEAT", seat })}
            onKick={() => client.send({ type: "KICK", playerId: bySeat(seat)!.id })}
          />
        ))}
      </section>

      <section className="lobby__panel paper">
        {isGringo ? <GringoSettings client={client} isHost={isHost} /> : <Settings client={client} isHost={isHost} />}

        <div className="lobby__status" role="status">
          {missing > 0
            ? missing === 1
              ? isGringo
                ? "Falta 1 jogador (mínimo 3)."
                : "À espera de mais 1 jogador."
              : isGringo
                ? `Faltam ${missing} jogadores (mínimo 3).`
                : `À espera de mais ${missing} jogadores.`
            : notReady > 0
              ? notReady === 1
                ? "Falta 1 jogador ficar pronto."
                : `Faltam ${notReady} jogadores ficar prontos.`
              : isHost
                ? "Estão todos prontos."
                : "Estão todos prontos. O anfitrião pode começar."}
        </div>

        <div className="lobby__actions">
          {me.seat !== null && (
            <button
              type="button"
              className={`btn ${me.ready ? "" : "btn--primary"}`}
              aria-pressed={me.ready}
              onClick={() => client.send({ type: "SET_READY", ready: !me.ready })}
            >
              {me.ready ? "Afinal não estou pronto" : "Estou pronto"}
            </button>
          )}
          {isHost && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canStart}
              onClick={() => client.send({ type: "START" })}
            >
              Começar o jogo
            </button>
          )}
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              client.leave();
              navigate("/");
            }}
          >
            Sair da sala
          </button>
        </div>
      </section>
    </main>
  );
}

function GamePicker({ client, isHost }: { client: RoomClient; isHost: boolean }) {
  const room = client.room!;
  if (!isHost) {
    return (
      <p className="game-pick game-pick--read">
        Jogo: <strong>{GAME_NAME[room.game]}</strong>
      </p>
    );
  }
  const tooMany = room.players.length > SEATS.sueca;
  return (
    <fieldset className="game-pick">
      <legend className="sr-only">Jogo</legend>
      {(["sueca", "gringo"] as const).map((g) => (
        <label key={g} className={`game-pick__option ${room.game === g ? "is-on" : ""}`}>
          <input
            type="radio"
            name="game"
            value={g}
            checked={room.game === g}
            disabled={g === "sueca" && tooMany}
            onChange={() => client.send({ type: "SET_GAME", game: g })}
          />
          <span className="game-pick__name">{GAME_NAME[g]}</span>
          <span className="game-pick__meta">{g === "sueca" ? "4 jogadores, em equipas" : "3 a 6 jogadores"}</span>
        </label>
      ))}
    </fieldset>
  );
}

function InviteCode({ code, game }: { code: string; game: GameKind }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/sala/${code}`;

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: `${GAME_NAME[game]} no Cardly`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Share sheet dismissed.
    }
  }

  return (
    <div className="invite">
      <p className="invite__label">Código da sala</p>
      <p className="invite__code">{code}</p>
      <button type="button" className="btn btn--small" onClick={share}>
        {copied ? "Link copiado" : "Convidar amigos"}
      </button>
    </div>
  );
}

interface SeatProps {
  seat: number;
  pos: SeatPos;
  teams: boolean;
  player: PublicPlayer | undefined;
  isMe: boolean;
  hostId: string;
  canKick: boolean;
  onSit: () => void;
  onKick: () => void;
}

function Seat({ seat, pos, teams, player, isMe, hostId, canKick, onSit, onKick }: SeatProps) {
  const team = sueca.teamOf(seat);
  // Two steps so a mis-tap on a phone does not remove a friend.
  const [confirming, setConfirming] = useState(false);
  return (
    <div className={`seat seat--${pos} ${teams ? `team-${team}` : "no-team"}`}>
      {teams && <span className="seat__team">Equipa {team}</span>}
      {player ? (
        <div className={`seat__plate ${isMe ? "seat__plate--me" : ""}`}>
          <span className="seat__name">
            {player.name}
            {isMe && <span className="seat__you"> (tu)</span>}
          </span>
          <span className="seat__meta">
            {player.id === hostId && "Anfitrião. "}
            {player.bot ? "Bot" : !player.connected ? "Desligado" : player.ready ? "Pronto" : "A preparar"}
          </span>
          {canKick &&
            (confirming ? (
              <span className="seat__kick">
                <button type="button" className="btn btn--small btn--danger" onClick={onKick}>
                  Tirar {player.name}
                </button>
                <button type="button" className="btn btn--small btn--quiet" onClick={() => setConfirming(false)}>
                  Cancelar
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn--small btn--quiet seat__kick-open" onClick={() => setConfirming(true)}>
                Tirar da sala
              </button>
            ))}
        </div>
      ) : (
        <button type="button" className="seat__empty" onClick={onSit}>
          Sentar aqui
        </button>
      )}
    </div>
  );
}

function Settings({ client, isHost }: { client: RoomClient; isHost: boolean }) {
  const s = client.room!.settings;
  const update = (settings: Parameters<RoomClient["send"]>[0] & { type: "UPDATE_SETTINGS" }) => client.send(settings);

  if (!isHost) {
    return (
      <dl className="settings settings--read">
        <div>
          <dt>Jogo até</dt>
          <dd>{riscos(s.targetRisks)}</dd>
        </div>
        <div>
          <dt>Empate a 60</dt>
          <dd>{TIE_RULE_TEXT[s.tieAt60Rule]}</dd>
        </div>
        <div>
          <dt>Capote com</dt>
          <dd>{CAPOTE_RULE_TEXT[s.capoteRule]}</dd>
        </div>
        <div>
          <dt>Tempo por jogada</dt>
          <dd>{s.turnTimerSeconds ? `${s.turnTimerSeconds} segundos` : "Sem limite"}</dd>
        </div>
      </dl>
    );
  }

  return (
    <div className="settings">
      <label>
        Jogo até
        <select
          className="input"
          value={s.targetRisks}
          onChange={(e) => update({ type: "UPDATE_SETTINGS", settings: { targetRisks: Number(e.target.value) } })}
        >
          {sueca.TARGET_RISK_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {riscos(n)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Empate a 60
        <select
          className="input"
          value={s.tieAt60Rule}
          onChange={(e) =>
            update({
              type: "UPDATE_SETTINGS",
              settings: { tieAt60Rule: e.target.value as sueca.SuecaRules["tieAt60Rule"] },
            })
          }
        >
          {Object.entries(TIE_RULE_TEXT).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        Capote com
        <select
          className="input"
          value={s.capoteRule}
          onChange={(e) =>
            update({
              type: "UPDATE_SETTINGS",
              settings: { capoteRule: e.target.value as sueca.SuecaRules["capoteRule"] },
            })
          }
        >
          {Object.entries(CAPOTE_RULE_TEXT).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tempo por jogada
        <select
          className="input"
          value={s.turnTimerSeconds}
          onChange={(e) =>
            update({ type: "UPDATE_SETTINGS", settings: { turnTimerSeconds: Number(e.target.value) } })
          }
        >
          {TIMER_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n ? `${n} segundos` : "Sem limite"}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function GringoSettings({ client, isHost }: { client: RoomClient; isHost: boolean }) {
  const s = client.room!.gringoSettings;
  const update = (settings: Partial<gringo.GringoRules>) => client.send({ type: "UPDATE_GRINGO_SETTINGS", settings });

  if (!isHost) {
    return (
      <dl className="settings settings--read">
        <div>
          <dt>Tempo por jogada</dt>
          <dd>{s.turnTimerSeconds ? `${s.turnTimerSeconds} segundos` : "Sem limite"}</dd>
        </div>
        <div>
          <dt>Tempo para usar habilidade</dt>
          <dd>{s.abilityWindowSeconds} segundos</dd>
        </div>
      </dl>
    );
  }

  return (
    <div className="settings">
      <label>
        Tempo por jogada
        <select
          className="input"
          value={s.turnTimerSeconds}
          onChange={(e) => update({ turnTimerSeconds: Number(e.target.value) })}
        >
          {gringo.TURN_TIMER_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n ? `${n} segundos` : "Sem limite"}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tempo para usar habilidade
        <select
          className="input"
          value={s.abilityWindowSeconds}
          onChange={(e) => update({ abilityWindowSeconds: Number(e.target.value) })}
        >
          {gringo.ABILITY_WINDOW_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} segundos
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
