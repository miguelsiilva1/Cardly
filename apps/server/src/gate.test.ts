import { describe, expect, it } from "vitest";
import { allowedOrigins, roomRequestAllowed } from "./gate";

const allowed = allowedOrigins("http://localhost:5173, https://cardly.vercel.app");

const req = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  new Request(`https://server.test${path}`, { method, headers });

const ws = { Upgrade: "websocket", Origin: "http://localhost:5173" };

describe("room request gate", () => {
  it("lets a WebSocket from our web app into a valid room code", () => {
    expect(roomRequestAllowed(req("/parties/room/K7M2QX", ws), allowed)).toBe(true);
    expect(roomRequestAllowed(req("/parties/room/K7M2QX", { ...ws, Origin: "https://cardly.vercel.app" }), allowed)).toBe(true);
  });

  it("refuses plain HTTP, which would reach the room's internal create endpoint", () => {
    expect(roomRequestAllowed(req("/parties/room/K7M2QX", {}, "POST"), allowed)).toBe(false);
    expect(roomRequestAllowed(req("/parties/room/K7M2QX"), allowed)).toBe(false);
  });

  it("refuses malformed room names", () => {
    for (const code of ["k7m2qx", "K7M2Q", "K7M2QXX", "K7M2Q0", "../../x", "K7M2QX/extra"]) {
      expect(roomRequestAllowed(req(`/parties/room/${code}`, ws), allowed)).toBe(false);
    }
    expect(roomRequestAllowed(req("/parties/other/K7M2QX", ws), allowed)).toBe(false);
  });

  it("refuses WebSockets opened by other websites", () => {
    expect(roomRequestAllowed(req("/parties/room/K7M2QX", { ...ws, Origin: "https://evil.example" }), allowed)).toBe(false);
  });
});
