import { useRef } from "react";
import { CardFace } from "./Card";

/** In-game rules. Native <dialog>: focus trap, Esc to close, no route change. */
export function RulesButton({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={`btn btn--quiet ${className}`} onClick={() => ref.current?.showModal()}>
        Regras
      </button>
      <dialog ref={ref} className="sheet" aria-labelledby="rules-title">
        <div className="sheet__head">
          <h2 id="rules-title">Regras da Sueca</h2>
          <button type="button" className="btn btn--quiet" onClick={() => ref.current?.close()}>
            Fechar
          </button>
        </div>
        <div className="sheet__body rules">
          <p className="rules__lead">
            Assiste ao naipe que foi jogado primeiro, se tiveres. Se não tiveres, podes jogar qualquer carta,
            incluindo trunfo. Trunfar não é obrigatório.
          </p>

          <div className="rules__callout">
            <span className="rules__pair" aria-hidden="true">
              <CardFace id="7S" size="mini" />
              <CardFace id="KS" size="mini" />
            </span>
            <p>
              <strong>O sete ganha ao rei.</strong> A ordem é Ás, 7, Rei, Valete, Dama, 6, 5, 4, 3, 2.
            </p>
          </div>

          <h3>A mesa</h3>
          <p>
            Baralho de 40 cartas (sem 8, 9 e 10). Quatro jogadores em duas equipas; os parceiros sentam-se frente a
            frente. Cada um recebe 10 cartas. Joga-se para a direita.
          </p>

          <h3>Trunfo</h3>
          <p>
            A última carta do baralho baralhado é a carta de trunfo: fica na mão de quem deu, que a joga como qualquer
            outra carta. O seu naipe é o trunfo da mão. Qualquer trunfo ganha a qualquer carta de outro naipe.
          </p>

          <h3>Rondas</h3>
          <p>
            Quem está à direita de quem deu começa. Ganha a ronda o trunfo mais alto; se não houver trunfo, a carta mais
            alta do naipe jogado primeiro. Quem ganha a ronda começa a seguinte.
          </p>

          <h3>Pontos das cartas</h3>
          <table className="rules__table">
            <tbody>
              <tr><th scope="row">Ás</th><td>11</td></tr>
              <tr><th scope="row">7</th><td>10</td></tr>
              <tr><th scope="row">Rei</th><td>4</td></tr>
              <tr><th scope="row">Valete</th><td>3</td></tr>
              <tr><th scope="row">Dama</th><td>2</td></tr>
              <tr><th scope="row">6, 5, 4, 3, 2</th><td>0</td></tr>
            </tbody>
          </table>
          <p>O baralho soma 120 pontos. Ganha a mão a equipa com 61 ou mais.</p>

          <h3>Riscos</h3>
          <ul>
            <li>61 a 90 pontos: 1 risco.</li>
            <li>91 a 119 pontos: 2 riscos.</li>
            <li>120 pontos: capote, 4 riscos.</li>
            <li>Ganhar as 10 rondas é bandeira.</li>
            <li>60 a 60: depende da regra escolhida na sala.</li>
          </ul>
          <p>Ganha o jogo a primeira equipa a chegar ao número de riscos combinado, com mais riscos que a outra.</p>
        </div>
      </dialog>
    </>
  );
}
