import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { navigate } from "../App";
import { GAME_NAME } from "../i18n";
import { displayName, signIn, supabase, useSession } from "../net/auth";

interface Row {
  seat: number;
  name: string;
  user_id: string | null;
  bot: boolean;
  team: "A" | "B" | null;
  score: number;
  won: boolean;
}

interface Match {
  id: string;
  game: "sueca" | "gringo";
  room_code: string;
  played_at: string;
  summary: { round?: number };
  match_players: Row[];
}

const LIMIT = 50;

const when = new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeStyle: "short" });

export function History() {
  const session = useSession();

  return (
    <main className="history felt">
      <header className="history__head">
        <button type="button" className="btn btn--small history__back" onClick={() => navigate("/")}>
          ← Início
        </button>
        <h1 className="page-title">Histórico</h1>
        {session && <p className="history__who">{displayName(session)}</p>}
      </header>
      {session === undefined ? null : session ? (
        <MatchList session={session} />
      ) : (
        <section className="paper paper--narrow">
          <p>Entra com o Google para veres os teus jogos.</p>
          {supabase && (
            <button type="button" className="btn btn--primary btn--wide" onClick={signIn}>
              Entrar com Google
            </button>
          )}
        </section>
      )}
    </main>
  );
}

function MatchList({ session }: { session: Session }) {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    // RLS returns only games this user played.
    supabase!
      .from("matches")
      .select("id, game, room_code, played_at, summary, match_players(seat, name, user_id, bot, team, score, won)")
      .order("played_at", { ascending: false })
      .limit(LIMIT)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setFailed(true);
        else setMatches(data as Match[]);
      });
    return () => {
      live = false;
    };
  }, [session.user.id]);

  if (failed) return <p className="notice history__msg">Não foi possível carregar o histórico. Tenta outra vez.</p>;
  if (!matches) return <p className="history__msg">A carregar…</p>;
  if (matches.length === 0) return <p className="history__msg">Ainda não há jogos. Joga uma partida com a conta ligada.</p>;

  return (
    <ol className="history__list">
      {matches.map((m) => (
        <MatchItem key={m.id} match={m} userId={session.user.id} />
      ))}
    </ol>
  );
}

function MatchItem({ match, userId }: { match: Match; userId: string }) {
  const me = match.match_players.find((p) => p.user_id === userId);
  const players = [...match.match_players].sort((a, b) => a.seat - b.seat);
  const label = (p: Row) => (p.user_id === userId ? `${p.name} (tu)` : p.name);

  return (
    <li className="paper history__item">
      <div className="history__line">
        <strong>
          {GAME_NAME[match.game]}
          {match.game === "gringo" && match.summary.round ? ` · ronda ${match.summary.round}` : ""}
        </strong>
        {me && <span className={`history__badge${me.won ? " history__badge--won" : ""}`}>{me.won ? "Vitória" : "Derrota"}</span>}
      </div>
      <p className="history__meta">
        {when.format(new Date(match.played_at))} · sala {match.room_code}
      </p>
      {match.game === "sueca" ? (
        <SuecaScore players={players} me={me} label={label} />
      ) : (
        <ol className="history__rank">
          {[...players]
            .sort((a, b) => a.score - b.score)
            .map((p) => (
              <li key={p.seat} className={p.won ? "history__winner" : undefined}>
                <span>{label(p)}</span>
                <span>{p.score} pts</span>
              </li>
            ))}
        </ol>
      )}
    </li>
  );
}

function SuecaScore({ players, me, label }: { players: Row[]; me: Row | undefined; label: (p: Row) => string }) {
  const mine = me?.team ?? "A";
  const teams = [mine, mine === "A" ? "B" : "A"] as const;
  return (
    <ul className="history__teams">
      {teams.map((t) => {
        const team = players.filter((p) => p.team === t);
        return (
          <li key={t} className={`history__team history__team--${t.toLowerCase()}`}>
            <span>{team.map(label).join(" e ")}</span>
            <span>{team[0]?.score ?? 0} riscos</span>
          </li>
        );
      })}
    </ul>
  );
}
