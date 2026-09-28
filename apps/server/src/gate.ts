import { PARTY_NAME, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@cardly/protocol";

/** Open sockets per room: 6 seats plus spare tabs and reconnects still closing. */
export const MAX_CONNECTIONS = 16;

const ROOM_PATH = new RegExp(`^/parties/${PARTY_NAME}/[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function allowedOrigins(list: string): string[] {
  return list.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Only WebSocket upgrades to a well-formed room code reach a room, and only
 * from our web origins. Plain HTTP would reach the room's internal
 * create/exists endpoint, which only the Worker itself may call.
 */
export function roomRequestAllowed(request: Request, allowed: string[]): boolean {
  const url = new URL(request.url);
  if (!ROOM_PATH.test(url.pathname)) return false;
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return false;
  // Browsers always send Origin on WebSocket upgrades; other sites must not open our rooms.
  const origin = request.headers.get("Origin");
  return origin === null || allowed.includes(origin);
}
