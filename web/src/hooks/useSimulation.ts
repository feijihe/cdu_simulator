import { useEffect, useRef, useState } from "react";
import type { ConnStatus, Snapshot } from "@/lib/api";

export function useSimulation() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");

  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const connectRef = useRef<() => void>(() => {});
  const suppressReconnect = useRef(false);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${proto}://${window.location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => setStatus("open");
      socket.onmessage = (event) => {
        try {
          setSnapshot(JSON.parse(event.data) as Snapshot);
        } catch {
          // ignore malformed frame
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (disposed) return;
        setStatus("closed");
        if (suppressReconnect.current) {
          suppressReconnect.current = false;
          return;
        }
        timerRef.current = window.setTimeout(connect, 1500);
      };
    };

    connectRef.current = connect;
    connect();

    return () => {
      disposed = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      socketRef.current?.close();
    };
  }, []);

  const retry = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const socket = socketRef.current;
    if (socket) {
      suppressReconnect.current = true;
      socket.close();
    }
    connectRef.current();
  };

  return { snapshot, status, retry };
}
