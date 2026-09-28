import type { CreateRoomResponse } from "@cardly/protocol";

export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? "http://127.0.0.1:8787";

/** host[:port] for partysocket, which picks ws:// or wss:// itself. */
export const SERVER_HOST = new URL(SERVER_URL).host;

export async function createRoom(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/rooms`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as CreateRoomResponse;
  return body.code;
}

const tokenKey = (code: string) => `cardly:token:${code}`;
const NAME_KEY = "cardly:name";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode: reconnect after refresh will not work, play still does.
  }
}

export const storage = {
  getToken: (code: string) => read(tokenKey(code)),
  setToken: (code: string, token: string | null) => write(tokenKey(code), token),
  getName: () => read(NAME_KEY) ?? "",
  setName: (name: string) => write(NAME_KEY, name),
};
