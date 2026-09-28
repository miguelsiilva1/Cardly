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
      if (m.accessToken !== undefined && !str(m.accessToken, 3000)) return null;
      return {
        type: "HELLO",
        name: m.name,
        ...(m.token === undefined ? {} : { token: m.token }),
        ...(m.accessToken === undefined ? {} : { accessToken: m.accessToken }),
      };
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
    case "SET_GAME":
      return m.game === "sueca" || m.game === "gringo" ? { type: "SET_GAME", game: m.game } : null;
    case "UPDATE_GRINGO_SETTINGS": {
      const s = m.settings;
      if (!isObj(s)) return null;
      const settings: Obj = {};
      for (const key of ["turnTimerSeconds", "abilityWindowSeconds"]) {
        if (s[key] === undefined) continue;
        if (!int(s[key])) return null;
        settings[key] = s[key];
      }
      return { type: "UPDATE_GRINGO_SETTINGS", settings } as ClientMessage;
    }
    case "G_PEEK":
      return Array.isArray(m.slotIds) && m.slotIds.length <= 4 && m.slotIds.every((id) => str(id, 16))
        ? { type: "G_PEEK", slotIds: m.slotIds as string[] }
        : null;
    case "G_SWAP":
      return str(m.slotId, 16) ? { type: "G_SWAP", slotId: m.slotId } : null;
    case "G_MATCH":
      return str(m.slotId, 16) && int(m.eventId) ? { type: "G_MATCH", slotId: m.slotId, eventId: m.eventId } : null;
    case "G_USE_ABILITY":
      return int(m.eventId) ? { type: "G_USE_ABILITY", eventId: m.eventId } : null;
    case "G_TARGET":
      if (!str(m.mySlotId, 16)) return null;
      if (m.targetSlotId !== null && !str(m.targetSlotId, 16)) return null;
      return { type: "G_TARGET", mySlotId: m.mySlotId, targetSlotId: m.targetSlotId };
    case "G_KING_DECIDE":
      return typeof m.swap === "boolean" ? { type: "G_KING_DECIDE", swap: m.swap } : null;
    case "G_DRAW":
    case "G_DISCARD":
    case "G_CALL_GRINGO":
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
