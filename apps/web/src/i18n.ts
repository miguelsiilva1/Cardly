import type { gringo, sueca } from "@cardly/engine";
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
  TOO_MANY_PLAYERS: "Há jogadores a mais para a Sueca. Só dá para quatro.",
  NOT_ENOUGH_PLAYERS: "O Gringo precisa de pelo menos 3 jogadores.",
  ROUND_NOT_ACTIVE: "A ronda já terminou.",
  INVALID_PEEK: "Escolhe exatamente 2 cartas.",
  ALREADY_PEEKED: "Já viste as tuas 2 cartas.",
  ALREADY_DREW: "Já tiraste uma carta.",
  MUST_DRAW_FIRST: "Tira uma carta primeiro.",
  DRAW_LOCKED: "Espera um instante: ainda se pode usar a habilidade.",
  ABILITY_IN_PROGRESS: "Espera: alguém está a usar uma habilidade.",
  NOT_YOUR_CARD: "Essa carta não é tua.",
  INVALID_TARGET: "Escolhe uma carta tua e uma de outro jogador.",
  NOTHING_TO_MATCH: "Ainda não há carta no monte.",
  MATCH_TOO_LATE: "Outro jogador foi mais rápido.",
  ALREADY_TRIED: "Já tentaste igualar esta carta.",
  NO_ABILITY: "Já não podes usar essa habilidade.",
  GRINGO_ALREADY_CALLED: "Já alguém chamou Gringo nesta ronda.",
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

export const RANK_NAME: Record<gringo.Rank, string> = {
  A: "Ás",
  "2": "Dois",
  "3": "Três",
  "4": "Quatro",
  "5": "Cinco",
  "6": "Seis",
  "7": "Sete",
  "8": "Oito",
  "9": "Nove",
  "10": "Dez",
  J: "Valete",
  Q: "Dama",
  K: "Rei",
  JOKER: "Joker",
};

/** Works for both decks: Sueca ids are a subset of the Gringo deck. */
export const cardLabel = (c: gringo.Card) => (c.suit ? `${RANK_NAME[c.rank]} de ${SUIT_NAME[c.suit]}` : RANK_NAME[c.rank]);

export const ABILITY_NAME: Record<gringo.Ability, string> = {
  QUEEN: "Dama",
  JACK: "Valete",
  BLACK_KING: "Rei preto",
};

export const GAME_NAME = { sueca: "Sueca", gringo: "Gringo" } as const;

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
