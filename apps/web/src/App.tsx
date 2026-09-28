import { useEffect, useState } from "react";
import { Home } from "./pages/Home";
import { RoomPage } from "./pages/RoomPage";

const ROOM_PATH = /^\/sala\/([A-Za-z0-9]{6})\/?$/;

export function navigate(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const match = ROOM_PATH.exec(path);
  if (match) return <RoomPage key={match[1]} code={match[1]!.toUpperCase()} />;
  return <Home />;
}
