import type { sueca } from "@cardly/engine";
import type { ErrorCode } from "@cardly/protocol";

export const ERROR_TEXT: Record<ErrorCode, string> = {
  HAND_NOT_ACTIVE: "A mão já terminou.",
  NOT_YOUR_TURN: "Ainda não é a tua vez.",
  INVALID_CARD: "Essa carta não existe.",
  CARD_NOT_IN_HAND: "Essa carta já não está na tua mão.",
  MUST_FOLLOW_SUIT: "Não podes jogar essa carta porque tens cartas do naipe pedido.",
  INVALID_MESSAGE: "Pedido inválido. Recarrega a página.",
  INVALID_NAME: "Escreve um nome com 1 a 20 caracteres.",
  INVALID_ROOM: "Esta sala não existe ou já expirou.",
  ROOM_FULL: "A sala já tem quatro jogadores.",
  MATCH_ALREADY_STARTED: "O jogo nesta sala já começou.",
  PLAYER_NOT_FOUND: "Já não fazes parte desta sala.",
  NOT_HOST: "Só o anfitrião pode fazer isso.",
  SEAT_TAKEN: "Esse lugar já está ocupado.",
  NOT_SEATED: "Senta-te num lugar primeiro.",
  NOT_ALL_READY: "Os quatro jogadores têm de estar prontos.",
  GAME_NOT_ACTIVE: "Não há nenhum jogo a decorrer.",
  STALE_ACTION: "O jogo mudou entretanto. Tenta outra vez.",
  GAME_PAUSED: "O jogo está em pausa até o anfitrião decidir.",
  NO_VACANCY: "Já não há lugares vazios na mesa.",
};

export const SUIT_NAME: Record<sueca.Suit, string> = {
  hearts: "Copas",
  diamonds: "Ouros",
  clubs: "Paus",
  spades: "Espadas",
};

/** U+FE0E forces the text glyph so iOS does not draw emoji suits. */
export const SUIT_SYMBOL: Record<sueca.Suit, string> = {
  hearts: "♥︎",
  diamonds: "♦︎",
  clubs: "♣︎",
  spades: "♠︎",
};

export const RANK_NAME: Record<sueca.Rank, string> = {
  A: "Ás",
  "7": "Sete",
  K: "Rei",
  J: "Valete",
  Q: "Dama",
  "6": "Seis",
  "5": "Cinco",
  "4": "Quatro",
  "3": "Três",
  "2": "Dois",
};

export const cardLabel = (c: sueca.Card) => `${RANK_NAME[c.rank]} de ${SUIT_NAME[c.suit]}`;

export const TIE_RULE_TEXT: Record<sueca.SuecaRules["tieAt60Rule"], string> = {
  EACH_TEAM_GETS_ONE: "Cada equipa ganha 1 risco",
  NO_POINTS: "Ninguém ganha riscos",
  CARRY_TO_NEXT_HAND: "O risco passa para a mão seguinte",
};

export const CAPOTE_RULE_TEXT: Record<sueca.SuecaRules["capoteRule"], string> = {
  "120_POINTS": "120 pontos",
  ALL_TEN_TRICKS: "As 10 rondas",
};

export const riscos = (n: number) => (n === 1 ? "1 risco" : `${n} riscos`);
