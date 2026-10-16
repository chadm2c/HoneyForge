import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listEvents, listHoneypots } from "../api/client";
import {
  deriveOverview,
  fleetCounts as computeFleetCounts,
  makeWindow,
} from "../lib/stats";
import type { FleetCounts, Overview, Window } from "../lib/stats";
import { useEventStream } from "./useEventStream";
import type {
  AttackEvent,
  ConnectionStatus,
  GapFillState,
  Honeypot,
} from "../api/types";

/**
 * Matches the events API page cap: one page is the largest burst the server
 * will return, and three pages is the ceiling on a single reconciliation.
 */
export const PAGE_SIZE = 200;
export const WINDOW_MAX_PAGES = 3;

const EVENTS_ERROR = "Could not load events.";
const FLEET_ERROR = "Could not load the fleet.";

export interface OverviewResult {
  overview: Overview | null;
  fleetCounts: FleetCounts | null;
  fleetLoading: boolean;
  fleetError: string | null;
  eventsLoading: boolean;
  eventsError: string | null;
  status: ConnectionStatus;
  recovery: GapFillState;
}

/**
 * The Overview's data owner.
 *
 * Two event stores exist and neither is the truth on its own: the REST `sample`
 * (page 0..2 of the window, ≤ 600) and the socket's `live` buffer (≤ 200,
 * owned by `useEventStream`). `deriveOverview` merges them at render time, so a
 * live frame that arrives while a request is in flight is never erased by that
 * response — the response replaces `sample` only.
 *
 * `recovery` is this hook's own bounded window walk (`reconnecting -> live`),
 * deliberately distinct from the stream's `gapFill`: the stream performs no
 * history fetch when `manageHistory: false`.
 */
export function useOverviewData(): OverviewResult {
  const { events: live, status } = useEventStream({ manageHistory: false });

  const [window, setWindow] = useState<Window>(() => makeWindow(Date.now()));
  // `null` means "no events response has ever been applied": `overview` is null
  // iff the events request failed (an empty successful sample is `[]`).
  const [sample, setSample] = useState<AttackEvent[] | null>(null);
  const [serverTotal, setServerTotal] = useState(0);
  const [honeypots, setHoneypots] = useState<Honeypot[] | null>(null);

  const [fleetLoading, setFleetLoading] = useState(true);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<GapFillState>("none");

  // One monotonic request id per endpoint: only the newest in-flight response
  // for an endpoint is applied, so a stale response is dropped, never merged.
  const eventsReqId = useRef(0);
  const fleetReqId = useRef(0);
  const prevStatusRef = useRef<ConnectionStatus | null>(null);
  const prevLiveRef = useRef(live);

  /**
   * Walks the window at `offset = 0, 200, 400`, stopping when a page is short
   * or the running sample reaches page 0's `serverTotal`. `serverTotal` is read
   * from page 0 only. The whole walk shares one request id, so a newer pass
   * started mid-walk aborts it before any state is written.
   */
  const fetchEvents = useCallback(
    async (win: Window, initial: boolean): Promise<void> => {
      const reqId = ++eventsReqId.current;
      const acc: AttackEvent[] = [];
      let total = 0;
      let stopped = false;
      try {
        for (let page = 0; page < WINDOW_MAX_PAGES; page++) {
          const res = await listEvents({
            since: win.startIso,
            until: win.endIso,
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
          });
          if (reqId !== eventsReqId.current) return;
          if (page === 0) total = res.total;
          acc.push(...res.items);
          if (res.items.length < PAGE_SIZE || acc.length >= total) {
            stopped = true;
            break;
          }
        }
        if (reqId !== eventsReqId.current) return;
        setSample(acc);
        setServerTotal(total);
        setEventsError(null);
        setEventsLoading(false);
        setRecovery(stopped ? "complete" : "capped");
      } catch {
        if (reqId !== eventsReqId.current) return;
        if (initial) {
          setEventsError(EVENTS_ERROR);
          setEventsLoading(false);
        } else {
          // A failed refetch degrades to the stale sample, never an empty page.
          setRecovery("failed");
        }
      }
    },
    [],
  );

  const fetchFleet = useCallback(async (): Promise<void> => {
    const reqId = ++fleetReqId.current;
    try {
      const list = await listHoneypots();
      if (reqId !== fleetReqId.current) return;
      setHoneypots(list);
      setFleetError(null);
      setFleetLoading(false);
    } catch {
      if (reqId !== fleetReqId.current) return;
      setFleetError(FLEET_ERROR);
      setFleetLoading(false);
    }
  }, []);

  // Initial pass: anchor the window once and fetch the sample plus the fleet.
  useEffect(() => {
    const win = makeWindow(Date.now());
    setWindow(win);
    void fetchEvents(win, true);
    void fetchFleet();
    return () => {
      // Supersede any in-flight response so a late one cannot set state after
      // unmount — the same monotonic-id mechanism, just advanced.
      eventsReqId.current++;
      fleetReqId.current++;
    };
  }, [fetchEvents, fetchFleet]);

  // Derivation pass on a live change: re-anchor the rolling window once, using
  // a single captured `now`. The identity check keeps mount from re-anchoring
  // on top of the initial pass.
  useEffect(() => {
    if (prevLiveRef.current === live) return;
    prevLiveRef.current = live;
    setWindow(makeWindow(Date.now()));
  }, [live]);

  // Recovery pass: only the `reconnecting -> live` transition reconciles, so a
  // first `connecting -> live` (already covered by the initial pass) does not.
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev !== "reconnecting" || status !== "live") return;
    const win = makeWindow(Date.now());
    setWindow(win);
    void fetchEvents(win, false);
  }, [status, fetchEvents]);

  const overview = useMemo(() => {
    if (sample === null) return null;
    return deriveOverview({ sample, live, window, honeypots, serverTotal });
  }, [sample, live, window, honeypots, serverTotal]);

  const fleet = useMemo(
    () => (honeypots === null ? null : computeFleetCounts(honeypots)),
    [honeypots],
  );

  return {
    overview,
    fleetCounts: fleet,
    fleetLoading,
    fleetError,
    eventsLoading,
    eventsError,
    status,
    recovery,
  };
}
