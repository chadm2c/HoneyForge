import { useCallback, useEffect, useRef, useState } from "react";
import { apiBase, apiFetch, tokenStore } from "../api/client";
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
      // Merge (don't replace): a live event may have arrived while the fetch was
      // in flight, and it must not be momentarily dropped. Dedupe by id.
      setEvents((prev) => {
        const byId = new Map<string, AttackEvent>();
        for (const e of page.items ?? []) byId.set(e.id, e);
        for (const e of prev) if (!byId.has(e.id)) byId.set(e.id, e);
        return [...byId.values()].sort(
          (a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)
        );
      });
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
        socket.send(
          JSON.stringify({ type: "auth", token: tokenStore.get() ?? "" }),
        );
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