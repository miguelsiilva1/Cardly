import { useRef } from "react";
import type { GameKind } from "@cardly/protocol";
import { CardFace } from "./Card";

interface Props {
  game: GameKind;
  label?: string;
  className?: string;
}

/** In-game rules. Native <dialog>: focus trap, Esc to close, no route change. */
export function RulesButton({ game, label = "Regras", className = "" }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={`btn btn--quiet ${className}`} onClick={() => ref.current?.showModal()}>
        {label}
      </button>
      <dialog ref={ref} className="sheet" aria-labelledby={`rules-title-${game}`}>
        <div className="sheet__head">
          <h2 id={`rules-title-${game}`}>{game === "sueca" ? "Regras da Sueca" : "Regras do Gringo"}</h2>
          <button type="button" className="btn btn--quiet" onClick={() => ref.current?.close()}>
            Fechar
          </button>
        </div>
        {game === "sueca" ? <SuecaRules /> : <GringoRules />}
      </dialog>
    </>
  );
}

function SuecaRules() {
  return (
    <div className="sheet__body rules">
      <p className="rules__lead">
        Assiste ao naipe que foi jogado primeiro, se tiveres. Se não tiveres, podes jogar qualquer carta, incluindo
        trunfo. Trunfar não é obrigatório.
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
        Baralho de 40 cartas (sem 8, 9 e 10). Quatro jogadores em duas equipas; os parceiros sentam-se frente a frente.
        Cada um recebe 10 cartas. Joga-se para a direita.
      </p>

      <h3>Trunfo</h3>
      <p>
        A última carta do baralho baralhado é a carta de trunfo: fica na mão de quem deu, que a joga como qualquer outra
        carta. O seu naipe é o trunfo da mão. Qualquer trunfo ganha a qualquer carta de outro naipe.
      </p>

      <h3>Rondas</h3>
      <p>
        Quem está à direita de quem deu começa. Ganha a ronda o trunfo mais alto; se não houver trunfo, a carta mais alta
        do naipe jogado primeiro. Quem ganha a ronda começa a seguinte.
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
  );
}

function GringoRules() {
  return (
    <div className="sheet__body rules">
      <p className="rules__lead">
        Acaba a ronda com o menor número de pontos. Tens 4 cartas viradas para baixo e só conheces as que já viste.
      </p>

      <div className="rules__callout">
        <span className="rules__pair" aria-hidden="true">
          <CardFace id="KH" size="mini" />
          <CardFace id="KS" size="mini" />
        </span>
        <p>
          <strong>O rei vermelho vale −2.</strong> O rei preto vale 13, como o valete e a dama.
        </p>
      </div>

      <h3>A mesa</h3>
      <p>
        De 3 a 6 jogadores, um baralho de 52 cartas e 2 jokers. Cada um recebe 4 cartas e escolhe 2 para ver. Cada carta
        que te deixam ver fica à vista uns segundos e volta a ficar virada para baixo: tens de a memorizar. Joga-se
        para a direita. Na primeira ronda começa um jogador ao acaso; depois, quem começa roda para a direita.
      </p>

      <h3>A tua vez</h3>
      <p>
        Tira uma carta do monte. Só tu a vês. Depois, ou a descartas, ou trocas por uma das tuas cartas (mesmo uma que
        não conheces); a carta que sai vai para o descarte.
      </p>

      <h3>Igualar</h3>
      <p>
        Sempre que cai uma carta no descarte, qualquer jogador pode pôr por cima uma carta igual, mesmo fora da sua vez:
        o mesmo valor, de qualquer naipe. Reis só igualam reis da mesma cor; jokers igualam jokers. Não recebes carta
        nova, por isso podes ficar com menos de 4. Quem ficar sem cartas ganha logo a ronda.
      </p>
      <p>
        Se errares, a carta fica virada para cima à vista de todos e levas uma carta de castigo que não podes ver. Só
        podes tentar uma vez por cada carta do descarte.
      </p>

      <h3>Habilidades</h3>
      <p>
        Uma dama, valete ou rei preto dá a sua habilidade a quem a põe no descarte: ao descartar a carta tirada, ao
        trocá-la por uma carta tirada, ou ao igualar. Uma carta especial que só está na tua mão não dá nada.
      </p>
      <ul>
        <li><strong>Dama:</strong> vês uma das tuas cartas.</li>
        <li><strong>Valete:</strong> trocas às cegas uma carta tua com uma de outro jogador.</li>
        <li>
          <strong>Rei preto:</strong> escolhes uma carta tua e uma de outro jogador, vês a dele e decides se trocas.
        </li>
      </ul>
      <p>
        Depois de cada descarte, o próximo jogador espera uns segundos antes de tirar, para dar tempo a quem pode usar a
        habilidade carregar em «Usar habilidade».
      </p>

      <h3>Gringo</h3>
      <p>
        Quando achares que tens menos pontos que todos, chama Gringo. Se for a tua vez e ainda não tiraste carta, a
        chamada é a tua jogada. Os outros jogam mais uma vez e a ronda acaba quando a vez voltaria a ti. Também acaba se
        o monte ficar vazio.
      </p>

      <h3>Pontos das cartas</h3>
      <table className="rules__table">
        <tbody>
          <tr><th scope="row">Ás</th><td>1</td></tr>
          <tr><th scope="row">2 a 10</th><td>o valor da carta</td></tr>
          <tr><th scope="row">Valete, dama, rei preto</th><td>13</td></tr>
          <tr><th scope="row">Rei vermelho</th><td>−2</td></tr>
          <tr><th scope="row">Joker</th><td>0</td></tr>
        </tbody>
      </table>
      <p>Só se vê a última jogada; as anteriores não se podem rever. No fim viram-se todas as cartas. Ganha quem tiver menos pontos; empates ficam empatados.</p>
    </div>
  );
}
