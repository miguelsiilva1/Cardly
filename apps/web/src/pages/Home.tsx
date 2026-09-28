import { useState, type FormEvent } from "react";
import { ROOM_CODE_LENGTH } from "@cardly/protocol";
import { navigate } from "../App";
import { createRoom } from "../net/api";
import { CardFace } from "../ui/Card";
import { RulesButton } from "../ui/RulesDialog";

export function Home() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function onCreate() {
    setBusy(true);
    setProblem(null);
    try {
      navigate(`/sala/${await createRoom()}`);
    } catch {
      setProblem("Não foi possível criar a sala. Verifica a ligação e tenta outra vez.");
      setBusy(false);
    }
  }

  function onJoin(e: FormEvent) {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean.length !== ROOM_CODE_LENGTH) {
      setProblem(`O código tem ${ROOM_CODE_LENGTH} letras e números.`);
      return;
    }
    navigate(`/sala/${clean}`);
  }

  return (
    <main className="home felt">
      <section className="home__hero" aria-label="Uma ronda">
        <div className="home__trick" aria-hidden="true">
          <CardFace id="KH" className="home__c home__c--1" />
          <CardFace id="3H" className="home__c home__c--2" />
          <CardFace id="AC" className="home__c home__c--3" />
          <CardFace id="7H" className="home__c home__c--4" />
        </div>
        <h1 className="home__title">Cardly</h1>
        <p className="home__lede">Sueca com os amigos, cada um em sua casa.</p>
      </section>

      <section className="home__actions paper">
        <button type="button" className="btn btn--primary btn--wide" onClick={onCreate} disabled={busy}>
          {busy ? "A criar sala…" : "Criar sala"}
        </button>

        <form className="join" onSubmit={onJoin}>
          <label htmlFor="code" className="join__label">
            Tens um código?
          </label>
          <div className="join__row">
            <input
              id="code"
              className="input input--code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={ROOM_CODE_LENGTH}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="K7M2QX"
            />
            <button type="submit" className="btn">
              Entrar
            </button>
          </div>
        </form>

        {problem && (
          <p className="notice" role="alert">
            {problem}
          </p>
        )}

        <RulesButton className="home__rules" />
      </section>
    </main>
  );
}
