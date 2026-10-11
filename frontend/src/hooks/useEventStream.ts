import { useCallback, useEffect, useRef, useState } from "react";
import { apiBase, apiFetch, operatorToken } from "../api/client";
import type { AttackEvent } from "../api/types";

const wsUrl = `${apiBase.replace(/^http/, "ws")}/api/ws/events`;

/**
 * Live event stream: REST history on load, then a first-message-authenticated
 * WebSocket appends new events. Events are keyed by the agent-generated id, so
 * an event pushed twice (or after a reconnect history refetch) is never
 * duplicated in the list.
 */
export function useEventStream(): { events: AttackEvent[]; connected: boolean } {
  const [events, setEvents] = useState<AttackEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  const loadHistory = useCallback(async (): Promise<void> => {
    try {
      const res = await apiFetch("/api/events?limit=100");
      if (!res.ok) return;
      const page = (await res.json()) as { items: AttackEvent[] };
      setEvents(page.items ?? []);
    } catch {
      // History fetch is best-effort; the socket keeps running and will refetch.
    }
  }, []);

  useEffect(() => {
    let disposed = false;

    const connect = (): void => {
      if (disposed) return;
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
        // First-message handshake: credentials never appear in the URL.
        socket.send(JSON.stringify({ type: "auth", token: operatorToken }));
        // Backfill on every (re)connect so a gap during downtime is covered.
        void loadHistory();
      };

      socket.onmessage = (ev) => {
        try {
          const event = JSON.parse(String(ev.data)) as AttackEvent;
          if (!event?.id) return;
          setEvents((prev) => {
            if (prev.some((e) => e.id === event.id)) return prev;
            return [event, ...prev];
          });
        } catch {
          // Ignore malformed frames.
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (disposed) return;
        retryRef.current += 1;
        const delay = Math.min(1000 * 2 ** retryRef.current, 30_000);
        setTimeout(connect, delay);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      disposed = true;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [loadHistory]);

  return { events, connected };
}