import type { ClientMessage } from "@cardly/protocol";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.length <= max;
const int = (v: unknown): v is number => Number.isInteger(v);

/** Shape-checks untrusted input. Game legality is checked later by the room. */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > 4096) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m) || !str(m.type, 32)) return null;

  switch (m.type) {
    case "HELLO":
      if (!str(m.name, 100)) return null;
      if (m.token !== undefined && !str(m.token, 200)) return null;
      return m.token === undefined ? { type: "HELLO", name: m.name } : { type: "HELLO", name: m.name, token: m.token };
    case "TAKE_SEAT":
      return int(m.seat) ? { type: "TAKE_SEAT", seat: m.seat } : null;
    case "SET_READY":
      return typeof m.ready === "boolean" ? { type: "SET_READY", ready: m.ready } : null;
    case "UPDATE_SETTINGS": {
      const s = m.settings;
      if (!isObj(s)) return null;
      const settings: Obj = {};
      if (s.targetRisks !== undefined) {
        if (!int(s.targetRisks)) return null;
        settings.targetRisks = s.targetRisks;
      }
      if (s.turnTimerSeconds !== undefined) {
        if (!int(s.turnTimerSeconds)) return null;
        settings.turnTimerSeconds = s.turnTimerSeconds;
      }
      if (s.tieAt60Rule !== undefined) {
        if (!str(s.tieAt60Rule, 32)) return null;
        settings.tieAt60Rule = s.tieAt60Rule;
      }
      if (s.capoteRule !== undefined) {
        if (!str(s.capoteRule, 32)) return null;
        settings.capoteRule = s.capoteRule;
      }
      // Values are checked against the allowed options in the room.
      return { type: "UPDATE_SETTINGS", settings } as ClientMessage;
    }
    case "PLAY_CARD":
      return str(m.cardId, 8) && int(m.version) ? { type: "PLAY_CARD", cardId: m.cardId, version: m.version } : null;
    case "KICK":
      return str(m.playerId, 64) ? { type: "KICK", playerId: m.playerId } : null;
    case "START":
    case "CONTINUE":
    case "PLAY_AGAIN":
    case "LEAVE":
    case "REPLACE_WITH_BOT":
    case "END_MATCH":
      return { type: m.type };
    default:
      return null;
  }
}
