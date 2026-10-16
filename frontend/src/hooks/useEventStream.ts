import { useCallback, useEffect, useRef, useState } from "react";
import { apiBase, apiFetch, tokenStore } from "../api/client";
import type { AttackEvent, ConnectionStatus, GapFillState } from "../api/types";
import { mergeById } from "../lib/stats";

/**
 * The buffer keeps only the newest `BUFFER_LIMIT` events, matching the API page
 * cap so "what we hold" agrees with "what a page can show".
 */
export const BUFFER_LIMIT = 200;

const wsUrl = `${apiBase.replace(/^http/, "ws")}/api/ws/events`;

interface EventPage {
  items?: AttackEvent[];
  total?: number;
}

/**
 * Live event stream with reconnect hardening.
 *
 * `status` describes the socket only ("connecting" before the first open,
 * "live" while open, "reconnecting" after a close) and becomes `live` even when
 * a bounded gap-fill could not retrieve everything. `gapFill` reports recovery
 * completeness separately, so the UI cannot conflate "connected" with "we have
 * every missed event".
 *
 * Recovery is anchored on the newest `occurred_at` held as of the last moment
 * the socket was live (the checkpoint), snapshotted synchronously at the top of
 * `onopen` so a frame delivered after reconnect cannot move the anchor. Exactly
 * one request is issued: the buffer's newest-first ordering means page 0 already
 * contains everything the buffer will retain.
 *
 * `manageHistory` defaults to `true`; the overview passes `false` because it
 * owns its own windowed sample and must not have this hook issue overlapping
 * REST requests.
 */
export function useEventStream(options?: { manageHistory?: boolean }): {
  events: AttackEvent[];
  status: ConnectionStatus;
  gapFill: GapFillState;
} {
  const manageHistory = options?.manageHistory ?? true;

  const [events, setEvents] = useState<AttackEvent[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [gapFill, setGapFill] = useState<GapFillState>("none");

  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef(0);
  const checkpointRef = useRef<string | null>(null);
  const bufferRef = useRef<AttackEvent[]>([]);
  const disposedRef = useRef(false);
  // Bumped per open so a recovery response belonging to a previous open cannot
  // land after a newer open has superseded it.
  const generationRef = useRef(0);

  // The one place events combine: dedupe-by-id plus `occurred_at desc` ordering
  // (Task 1's mergeById), then keep the newest BUFFER_LIMIT. Every write path
  // (initial history, recovery, live frame) goes through here, so the cap and
  // the dedupe can never diverge between paths.
  const mergeAndCap = useCallback(
    (prev: AttackEvent[], incoming: AttackEvent[]): AttackEvent[] =>
      mergeById(prev, incoming).slice(0, BUFFER_LIMIT),
    [],
  );

  const applyIncoming = useCallback(
    (incoming: AttackEvent[]): void => {
      const merged = mergeAndCap(bufferRef.current, incoming);
      bufferRef.current = merged;
      // mergeById orders `occurred_at desc`, so [0] is the newest held event.
      checkpointRef.current = merged[0]?.occurred_at ?? checkpointRef.current;
      if (!disposedRef.current) setEvents(merged);
    },
    [mergeAndCap],
  );

  const recover = useCallback(
    async (generation: number, checkpoint: string | null): Promise<void> => {
      try {
        let path: string;
        if (checkpoint === null) {
          path = `/api/events?limit=${BUFFER_LIMIT}`;
        } else {
          const since = new Date(Date.parse(checkpoint) - 1000).toISOString();
          const params = new URLSearchParams({
            since,
            limit: String(BUFFER_LIMIT),
            offset: "0",
          });
          path = `/api/events?${params.toString()}`;
        }

        const res = await apiFetch(path);
        if (disposedRef.current || generation !== generationRef.current) return;
        if (!res.ok) {
          setGapFill("failed");
          return;
        }

        const page = (await res.json()) as EventPage;
        if (disposedRef.current || generation !== generationRef.current) return;

        const items = page.items ?? [];
        applyIncoming(items);
        if (checkpoint === null) {
          // First connect, nothing was held: there is no gap to describe.
          setGapFill("none");
        } else {
          const total = page.total ?? 0;
          // A short page — or a `total` the buffer can hold entirely — means the
          // whole missed set is here. Only a full page above the cap is partial.
          setGapFill(
            items.length < BUFFER_LIMIT || total <= BUFFER_LIMIT
              ? "complete"
              : "capped",
          );
        }
      } catch {
        if (disposedRef.current || generation !== generationRef.current) return;
        // Keep whatever we held; report only that recovery failed.
        setGapFill("failed");
      }
    },
    [applyIncoming],
  );

  useEffect(() => {
    disposedRef.current = false;

    const connect = (): void => {
      if (disposedRef.current) return;
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        // First statement: snapshot the pre-drop checkpoint synchronously,
        // before the handshake or any await, so a frame delivered after
        // reconnect cannot move the anchor.
        const checkpoint = checkpointRef.current;
        const generation = ++generationRef.current;
        retryRef.current = 0;
        if (disposedRef.current) return;
        setStatus("live");
        // First-message handshake: credentials never appear in the URL.
        socket.send(
          JSON.stringify({ type: "auth", token: tokenStore.get() ?? "" }),
        );
        if (!manageHistory) return;
        void recover(generation, checkpoint);
      };

      socket.onmessage = (ev) => {
        try {
          const event = JSON.parse(String(ev.data)) as AttackEvent | null;
          if (!event?.id) return;
          applyIncoming([event]);
        } catch {
          // Malformed frames are ignored; the stream keeps running.
        }
      };

      socket.onclose = () => {
        if (disposedRef.current) return;
        setStatus("reconnecting");
        retryRef.current += 1;
        // Equal jitter: the delay always lies in [base/2, base], so reconnects
        // stay snappy while simultaneous clients spread out.
        const base = Math.min(1000 * 2 ** retryRef.current, 30_000);
        const delay = base / 2 + Math.random() * (base / 2);
        timerRef.current = setTimeout(connect, delay);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      disposedRef.current = true;
      generationRef.current += 1;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [manageHistory, applyIncoming, recover]);

  return { events, status, gapFill };
}
