import type { gringo, sueca } from "@cardly/engine";

export type GameKind = "sueca" | "gringo";

export const ROOM_CODE_LENGTH = 6;
/** No 0/O/1/I/L to keep codes easy to read aloud. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const PARTY_NAME = "room";
/** WebSocket close code sent to a player the host removed. */
export const CLOSE_KICKED = 4403;
export const NAME_MAX_LENGTH = 20;
/** Seconds players get to read the hand result before the next hand deals. */
export const HAND_RESULT_SECONDS = 15;
/** Extra time on the next turn so everyone can see a completed trick. */
export const TRICK_PAUSE_MS = 1500;
/** Seconds to look at the revealed cards before the next Gringo round deals. */
export const GRINGO_RESULT_SECONDS = 30;

export const SEATS: Record<GameKind, number> = { sueca: 4, gringo: 6 };

// ---------- client → server ----------

export type ClientMessage =
  | { type: "HELLO"; name: string; token?: string }
  | { type: "TAKE_SEAT"; seat: number }
  | { type: "SET_READY"; ready: boolean }
  | { type: "UPDATE_SETTINGS"; settings: Partial<Pick<sueca.SuecaRules, "targetRisks" | "tieAt60Rule" | "capoteRule" | "turnTimerSeconds">> }
  /** Host only, lobby only. */
  | { type: "SET_GAME"; game: GameKind }
  | { type: "UPDATE_GRINGO_SETTINGS"; settings: Partial<gringo.GringoRules> }
  | { type: "START" }
  | { type: "PLAY_CARD"; cardId: string; version: number }
  // Gringo. Slots are named by id; match and ability carry the discard event they answer.
  | { type: "G_PEEK"; slotIds: string[] }
  | { type: "G_DRAW" }
  | { type: "G_DISCARD" }
  | { type: "G_SWAP"; slotId: string }
  | { type: "G_MATCH"; slotId: string; eventId: number }
  | { type: "G_USE_ABILITY"; eventId: number }
  /** Queen: mySlotId only. Jack and black King: both. */
  | { type: "G_TARGET"; mySlotId: string; targetSlotId: string | null }
  | { type: "G_KING_DECIDE"; swap: boolean }
  | { type: "G_CALL_GRINGO" }
  /** Sueca: next hand. Gringo: next round. */
  | { type: "CONTINUE" }
  | { type: "PLAY_AGAIN" }
  /** In the lobby: leave the room. During a match: leave the table (the game pauses). */
  | { type: "LEAVE" }
  /** Host only, lobby only. */
  | { type: "KICK"; playerId: string }
  /** Host only, while seats are empty mid-match: bots take them and play resumes. */
  | { type: "REPLACE_WITH_BOT" }
  /** Host only, while seats are empty mid-match (or between Gringo rounds): back to the lobby. */
  | { type: "END_MATCH" };

// ---------- server → client ----------

export type RoomStatus = "LOBBY" | "PLAYING";

export interface PublicPlayer {
  id: string;
  name: string;
  seat: number | null;
  ready: boolean;
  connected: boolean;
  /** Pressed "Continuar" on the hand result screen. */
  continued: boolean;
  /** Played by the server. */
  bot: boolean;
}

/** A seat emptied mid-match. The game is paused until the host decides. */
export interface Vacancy {
  seat: number;
  name: string;
}

export interface RoomSnapshot {
  code: string;
  game: GameKind;
  hostId: string;
  status: RoomStatus;
  settings: sueca.SuecaRules;
  gringoSettings: gringo.GringoRules;
  players: PublicPlayer[];
  /** Epoch ms. Server-decided; client only renders a countdown. Whoever must act now. */
  turnDeadline: number | null;
  /** Gringo: end of the draw lock / ability claim after a discard. */
  windowDeadline: number | null;
  continueDeadline: number | null;
  /** Seats emptied mid-match. Non-empty means the game is paused. */
  vacancies: Vacancy[];
}

export type ServerMessage =
  | { type: "WELCOME"; playerId: string; token: string }
  | {
      type: "STATE";
      room: RoomSnapshot;
      sueca: sueca.SuecaView | null;
      gringo: gringo.GringoView | null;
      events: sueca.SuecaEvent[];
      /** Server clock, so clients can correct countdowns for skew. */
      serverNow: number;
    }
  | { type: "ERROR"; code: ErrorCode };

export type ErrorCode =
  | sueca.SuecaError
  | gringo.GringoError
  | "INVALID_MESSAGE"
  | "INVALID_NAME"
  | "INVALID_ROOM"
  | "ROOM_FULL"
  | "MATCH_ALREADY_STARTED"
  | "PLAYER_NOT_FOUND"
  | "NOT_HOST"
  | "SEAT_TAKEN"
  | "NOT_SEATED"
  | "NOT_ALL_READY"
  | "GAME_NOT_ACTIVE"
  | "STALE_ACTION"
  | "GAME_PAUSED"
  | "NO_VACANCY"
  | "TOO_MANY_PLAYERS"
  | "NOT_ENOUGH_PLAYERS";

// ---------- HTTP ----------

export interface CreateRoomResponse {
  code: string;
}
