import { useEffect, useRef, useState } from "react";

export type TriggerEvent = {
  type: "trigger";
  ts: number;
  symbol: string;
  trigger_kind?: string;
  price?: number;
  rvol?: number;
  message?: string;
  [key: string]: any;
};

export function useTriggerStream() {
  const [events, setEvents] = useState<TriggerEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}/ws/scanner/triggers/`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data?.type === "trigger") {
            setEvents((prev) => [data as TriggerEvent, ...prev].slice(0, 200));
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        // simple backoff reconnect
        const attempt = Math.min(retryRef.current + 1, 10);
        retryRef.current = attempt;
        const delayMs = Math.min(1000 * attempt, 8000);

        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(connect, delayMs);
      };

      ws.onerror = () => {
        // close will trigger reconnect
        try { ws.close(); } catch {}
      };
    };

    connect();
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      try { wsRef.current?.close(); } catch {}
    };
  }, []);

  return { events };
}