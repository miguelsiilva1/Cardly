import { useCallback, useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import type { gringo, sueca } from "@cardly/engine";
import { CLOSE_KICKED, PARTY_NAME, type ClientMessage, type ErrorCode, type RoomSnapshot, type ServerMessage } from "@cardly/protocol";
import { SERVER_HOST, storage } from "./api";

/** "paused": the server closed an idle room's connections; we wait for the player to come back. */
export type Connection = "connecting" | "open" | "reconnecting" | "paused" | "kicked" | "gone";

export interface RoomClient {
  connection: Connection;
  playerId: string | null;
  room: RoomSnapshot | null;
  sueca: sueca.SuecaView | null;
  gringo: gringo.GringoView | null;
  /**
   * Gringo cards shown to me once. Kept apart from `gringo` because the next
   * STATE drops them, possibly before React renders the one that had them.
   */
  glimpse: NonNullable<gringo.GringoView["glimpse"]> | null;
  /** Events from the latest STATE, for animation only. `seq` changes on every STATE. */
  events: { seq: number; list: sueca.SuecaEvent[] };
  error: { code: ErrorCode; at: number } | null;
  /** serverNow − Date.now(), for countdowns. */
  clockOffset: number;
  /** True between sending a game action and the next STATE; blocks double plays. */
  pending: boolean;
  join: (name: string) => void;
  send: (msg: ClientMessage) => void;
  resume: () => void;
  /** Leave the room (lobby) or the table (mid-match). Final: the seat is not kept. */
  leave: () => void;
}

/** Close codes set by the server. */
const CLOSE_IDLE = 4408;
const CLOSE_GONE = [4404, 4410];

/** Errors that mean a stored token no longer gets us back in. */
const TOKEN_DEAD: readonly ErrorCode[] = ["MATCH_ALREADY_STARTED", "ROOM_FULL", "PLAYER_NOT_FOUND"];

export function useRoom(code: string): RoomClient {
  const socketRef = useRef<PartySocket | null>(null);
  const joinedRef = useRef(false);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [view, setView] = useState<sueca.SuecaView | null>(null);
  const [gringoView, setGringoView] = useState<gringo.GringoView | null>(null);
  const [glimpse, setGlimpse] = useState<RoomClient["glimpse"]>(null);
  const [events, setEvents] = useState<RoomClient["events"]>({ seq: 0, list: [] });
  const [error, setError] = useState<RoomClient["error"]>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const socket = new PartySocket({ host: SERVER_HOST, party: PARTY_NAME, room: code });
    socketRef.current = socket;

    const hello = (name: string, token?: string) =>
      socket.send(JSON.stringify({ type: "HELLO", name, ...(token ? { token } : {}) } satisfies ClientMessage));

    socket.addEventListener("open", () => {
      setConnection("open");
      // Resume our seat after a refresh or a dropped connection.
      const token = storage.getToken(code);
      if (token) hello(storage.getName() || "Jogador", token);
    });
    socket.addEventListener("close", (e: CloseEvent) => {
      setPending(false);
      if (e.code === CLOSE_IDLE) {
        socket.close(); // stop automatic reconnects until the player returns
        setConnection("paused");
      } else if (e.code === CLOSE_KICKED) {
        socket.close();
        storage.setToken(code, null);
        setConnection("kicked");
      } else if (CLOSE_GONE.includes(e.code)) {
        socket.close();
        setConnection("gone");
      } else {
        setConnection((c) => (c === "open" || c === "connecting" ? "reconnecting" : c));
      }
    });
    socket.addEventListener("message", (e: MessageEvent<string>) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      switch (msg.type) {
        case "WELCOME":
          joinedRef.current = true;
          storage.setToken(code, msg.token);
          setPlayerId(msg.playerId);
          break;
        case "STATE":
          setRoom(msg.room);
          setView(msg.sueca);
          setGringoView(msg.gringo);
          if (msg.gringo?.glimpse) setGlimpse(msg.gringo.glimpse);
          setEvents((prev) => ({ seq: prev.seq + 1, list: msg.events }));
          setClockOffset(msg.serverNow - Date.now());
          setPending(false);
          break;
        case "ERROR":
          setPending(false);
          setError({ code: msg.code, at: Date.now() });
          if (msg.code === "INVALID_ROOM") {
            setConnection("gone");
            socket.close();
          }
          if (!joinedRef.current && TOKEN_DEAD.includes(msg.code)) storage.setToken(code, null);
          break;
      }
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [code]);

  const send = useCallback((msg: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (msg.type === "PLAY_CARD" || msg.type.startsWith("G_")) setPending(true);
    socket.send(JSON.stringify(msg));
  }, []);

  const join = useCallback(
    (name: string) => {
      storage.setName(name);
      send({ type: "HELLO", name });
    },
    [send],
  );

  const resume = useCallback(() => {
    setConnection("connecting");
    socketRef.current?.reconnect();
  }, []);

  const leave = useCallback(() => {
    send({ type: "LEAVE" });
    storage.setToken(code, null);
  }, [send, code]);

  return {
    connection,
    playerId,
    room,
    sueca: view,
    gringo: gringoView,
    glimpse,
    events,
    error,
    clockOffset,
    pending,
    join,
    send,
    resume,
    leave,
  };
}
