import { useEffect, useState, type FormEvent } from "react";
import { NAME_MAX_LENGTH } from "@cardly/protocol";
import { navigate } from "../App";
import { ERROR_TEXT } from "../i18n";
import { storage } from "../net/api";
import { displayName, useSession } from "../net/auth";
import { useRoom, type RoomClient } from "../net/useRoom";
import { GringoTable } from "./GringoTable";
import { Lobby } from "./Lobby";
import { Table } from "./Table";

export function RoomPage({ code }: { code: string }) {
  const client = useRoom(code);
  const { connection, playerId, room } = client;

  if (connection === "kicked") {
    return (
      <main className="center-page felt">
        <div className="paper paper--narrow">
          <h1 className="page-title">Sala {code}</h1>
          <p>O anfitrião tirou-te desta sala.</p>
          <button type="button" className="btn btn--primary" onClick={() => navigate("/")}>
            Voltar ao início
          </button>
        </div>
      </main>
    );
  }

  if (connection === "gone") {
    return (
      <main className="center-page felt">
        <div className="paper paper--narrow">
          <h1 className="page-title">Sala {code}</h1>
          <p>{ERROR_TEXT.INVALID_ROOM}</p>
          <button type="button" className="btn btn--primary" onClick={() => navigate("/")}>
            Voltar ao início
          </button>
        </div>
      </main>
    );
  }

  let body;
  if (!playerId || !room) {
    body = <JoinForm client={client} code={code} />;
  } else if (room.status === "LOBBY") {
    body = <Lobby client={client} />;
  } else if (room.game === "gringo") {
    body = <GringoTable client={client} />;
  } else {
    body = <Table client={client} />;
  }

  return (
    <>
      {body}
      {connection === "paused" && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="paused-title">
          <div className="paper paper--narrow">
            <h2 id="paused-title" className="page-title">
              Mesa em pausa
            </h2>
            <p>Ninguém jogou nos últimos 20 minutos, por isso a ligação foi fechada. O teu lugar continua guardado.</p>
            <button type="button" className="btn btn--primary btn--wide" onClick={client.resume}>
              Voltar à mesa
            </button>
          </div>
        </div>
      )}
      {connection === "reconnecting" && playerId && (
        <p className="banner" role="status">
          Ligação perdida. A tentar voltar à mesa…
        </p>
      )}
      <ErrorToast client={client} />
    </>
  );
}

function JoinForm({ client, code }: { client: RoomClient; code: string }) {
  const [name, setName] = useState(storage.getName);
  const session = useSession();
  const resuming = !!storage.getToken(code) && client.error === null;

  // First visit while signed in: suggest the Google first name.
  useEffect(() => {
    if (session) setName((n) => n || displayName(session).split(" ")[0]!.slice(0, NAME_MAX_LENGTH));
  }, [session]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (clean) void client.join(clean);
  }

  return (
    <main className="center-page felt">
      <form className="paper paper--narrow join-room" onSubmit={onSubmit}>
        <h1 className="page-title">Sala {code}</h1>
        {resuming ? (
          <p role="status">A voltar à mesa…</p>
        ) : (
          <>
            <label htmlFor="name">Como te chamam à mesa?</label>
            <input
              id="name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX_LENGTH}
              autoComplete="nickname"
              autoFocus
              required
            />
            <button type="submit" className="btn btn--primary btn--wide" disabled={client.connection !== "open"}>
              {client.connection === "open" ? "Entrar na sala" : "A ligar…"}
            </button>
            {session && <p className="join-room__who">Com a conta {displayName(session)}. Os jogos ficam no teu histórico.</p>}
          </>
        )}
      </form>
    </main>
  );
}

function ErrorToast({ client }: { client: RoomClient }) {
  const [visible, setVisible] = useState(false);
  const err = client.error;
  useEffect(() => {
    if (!err) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3500);
    return () => clearTimeout(t);
  }, [err]);
  if (!err || !visible) return null;
  return (
    <p className="toast" role="alert">
      {ERROR_TEXT[err.code]}
    </p>
  );
}
