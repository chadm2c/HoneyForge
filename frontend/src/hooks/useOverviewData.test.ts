import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  PAGE_SIZE,
  WINDOW_MAX_PAGES,
  useOverviewData,
} from "./useOverviewData";
import { BUFFER_LIMIT } from "./useEventStream";
import type {
  AttackEvent,
  FleetStatus,
  Honeypot,
} from "../api/types";

/**
 * Fake socket, mirroring useEventStream.test.ts. The overview hook owns no REST
 * for history (manageHistory: false), but it does own the socket's status
 * transitions, so the test drives onopen/onclose to reach `reconnecting -> live`.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }
}

type Kind = "events" | "honeypots";

interface Pending {
  url: string;
  kind: Kind;
  settled: boolean;
  resolve: (body: unknown, status?: number) => void;
  reject: (err?: unknown) => void;
}

const NOW = "2026-01-01T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

let pending: Pending[] = [];
let urls: string[] = [];

function response(body: unknown, status: number): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

function kindOf(url: string): Kind {
  return url.includes("/api/honeypots") ? "honeypots" : "events";
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  pending = [];
  urls = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // Every request stays pending until the test resolves it, so responses can be
  // resolved out of order and interleaved with live frames.
  vi.stubGlobal(
    "fetch",
    vi.fn((url: unknown) => {
      const u = String(url);
      urls.push(u);
      const entry: Pending = {
        url: u,
        kind: kindOf(u),
        settled: false,
        resolve: () => {},
        reject: () => {},
      };
      pending.push(entry);
      return new Promise<Response>((resolve, reject) => {
        entry.resolve = (body, status = 200) => {
          entry.settled = true;
          resolve(response(body, status));
        };
        entry.reject = (err) => {
          entry.settled = true;
          reject(err ?? new Error("network"));
        };
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function makeEvent(id: string, occurredAt: string): AttackEvent {
  return {
    id,
    honeypot_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    event_type: "connection",
    source_ip: "192.0.2.1",
    source_port: 50000,
    target_port: 22,
    protocol: "tcp",
    details: {},
    occurred_at: occurredAt,
    received_at: occurredAt,
  };
}

/** An event comfortably inside the frozen 24h window. */
function inWindowEvent(id: string, minutesAgo = 1): AttackEvent {
  return makeEvent(id, new Date(NOW_MS - minutesAgo * 60_000).toISOString());
}

function makeHoneypot(id: string, status: FleetStatus): Honeypot {
  return {
    id,
    name: id,
    profile_id: "p1",
    profile: { id: "p1", name: "low", interaction_level: "low", version: 1 },
    config_version: 1,
    status,
    last_seen_at: null,
    created_at: NOW,
  };
}

/** Flush the `fetch -> apiFetch -> apiJson -> json()` microtask chain. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function unsettled(kind: Kind): Pending[] {
  return pending.filter((p) => p.kind === kind && !p.settled);
}

async function resolveEvents(
  index: number,
  body: { items: AttackEvent[]; total: number },
): Promise<void> {
  const req = unsettled("events")[index];
  await act(async () => {
    req.resolve(body);
  });
  await settle();
}

async function resolveFleet(index: number, body: Honeypot[]): Promise<void> {
  const req = unsettled("honeypots")[index];
  await act(async () => {
    req.resolve(body);
  });
  await settle();
}

async function rejectPending(kind: Kind, index = 0): Promise<void> {
  const req = unsettled(kind)[index];
  await act(async () => {
    req.reject(new Error("network down"));
  });
  await settle();
}

async function openSocket(index = FakeWebSocket.instances.length - 1): Promise<void> {
  await act(async () => {
    FakeWebSocket.instances[index].onopen?.();
  });
}

async function closeSocket(index = FakeWebSocket.instances.length - 1): Promise<void> {
  await act(async () => {
    FakeWebSocket.instances[index].onclose?.();
  });
}

/** Drop the socket and advance past the jitter window so a reconnect lands. */
async function dropAndReconnect(): Promise<void> {
  await closeSocket();
  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });
}

async function pushLive(
  index: number,
  event: AttackEvent,
): Promise<void> {
  await act(async () => {
    FakeWebSocket.instances[index].onmessage?.({ data: JSON.stringify(event) });
  });
}

function eventUrls(): string[] {
  return urls.filter((u) => u.includes("/api/events"));
}

function offsets(): string[] {
  return eventUrls().map((u) => new URL(u).searchParams.get("offset") ?? "");
}

describe("useOverviewData constants", () => {
  it("exports the page size and page budget", () => {
    expect(PAGE_SIZE).toBe(200);
    expect(WINDOW_MAX_PAGES).toBe(3);
  });
});

describe("useOverviewData two independent event stores", () => {
  it("includes a live event that arrives before the initial REST response resolves", async () => {
    const { result } = renderHook(() => useOverviewData());

    await openSocket(0);
    await pushLive(0, inWindowEvent("L", 1));

    await resolveEvents(0, { items: [inWindowEvent("S1", 2)], total: 1 });

    expect(result.current.overview?.inWindowCount).toBe(2);
    expect(result.current.overview?.buckets.reduce((s, b) => s + b.count, 0)).toBe(2);
  });

  it("preserves a live event that arrives while a REST request is in flight", async () => {
    const { result } = renderHook(() => useOverviewData());
    await openSocket(0);
    await resolveEvents(0, { items: [inWindowEvent("S1", 10)], total: 1 });
    expect(result.current.overview?.inWindowCount).toBe(1);

    // Reconnect: a fresh window request is issued and left in flight.
    await dropAndReconnect();
    await openSocket(1);
    await pushLive(1, inWindowEvent("L", 1));

    await resolveEvents(0, {
      items: [inWindowEvent("S1", 10), inWindowEvent("S2", 5)],
      total: 2,
    });

    // The response replaced `sample` only; the live L survived the merge.
    expect(result.current.overview?.inWindowCount).toBe(3);
  });

  it("does not duplicate a REST id already received over the socket", async () => {
    const { result } = renderHook(() => useOverviewData());
    await openSocket(0);
    await pushLive(0, inWindowEvent("DUP", 1));

    await resolveEvents(0, {
      items: [inWindowEvent("S1", 2), inWindowEvent("DUP", 1)],
      total: 2,
    });

    expect(result.current.overview?.inWindowCount).toBe(2);
    expect(result.current.overview?.topTypes).toEqual([
      { key: "connection", count: 2 },
    ]);
  });
});

describe("useOverviewData stale-response safety", () => {
  it("drops a stale events response instead of overwriting a newer sample", async () => {
    const { result } = renderHook(() => useOverviewData());
    await openSocket(0);

    // Initial fetch A is left in flight.
    expect(unsettled("events")).toHaveLength(1);

    // Reconnect issues a newer fetch B.
    await dropAndReconnect();
    await openSocket(1);
    expect(unsettled("events")).toHaveLength(2);

    // The newer response lands first.
    await resolveEvents(1, { items: [inWindowEvent("NEW", 1)], total: 1 });

    // The stale one lands last and must be dropped, not merged.
    await resolveEvents(0, { items: [inWindowEvent("OLD", 2)], total: 1 });

    const ids = result.current.overview?.topTypes ?? [];
    expect(result.current.overview?.inWindowCount).toBe(1);
    expect(ids).toEqual([{ key: "connection", count: 1 }]);
    // The stale page's id never reached the derivation.
    expect(JSON.stringify(result.current.overview)).not.toContain("OLD");
  });
});

describe("useOverviewData recovery reconciliation", () => {
  it("produces correct KPI and chart values for a recovery refetch overlapping live events", async () => {
    const { result } = renderHook(() => useOverviewData());
    await openSocket(0);
    await resolveEvents(0, { items: [inWindowEvent("S1", 20)], total: 1 });

    await dropAndReconnect();
    await openSocket(1);
    const shared = inWindowEvent("L", 1);
    await pushLive(1, shared);

    await resolveEvents(0, {
      items: [inWindowEvent("S1", 20), inWindowEvent("S2", 10), shared],
      total: 3,
    });

    // S1, S2, L; L is deduped across the page and the socket.
    expect(result.current.overview?.inWindowCount).toBe(3);
    expect(result.current.overview?.buckets.reduce((s, b) => s + b.count, 0)).toBe(3);
    expect(result.current.overview?.distinctSources).toBe(1);
  });

  it("walks offset=0,200,400 and reports capped when the page budget is exhausted", async () => {
    const { result } = renderHook(() => useOverviewData());

    const page = (p: number): AttackEvent[] =>
      Array.from({ length: PAGE_SIZE }, (_, i) =>
        inWindowEvent(`p${p}-${i}`, 1 + i + p * PAGE_SIZE),
      );

    await resolveEvents(0, { items: page(0), total: 700 });
    // A full page advances the walk: offset=200 is already in flight.
    expect(offsets()).toEqual(["0", "200"]);
    await resolveEvents(0, { items: page(1), total: 700 });
    expect(offsets()).toEqual(["0", "200", "400"]);
    await resolveEvents(0, { items: page(2), total: 700 });

    // The budget is exhausted here; no fourth request is ever issued.
    expect(offsets()).toEqual(["0", "200", "400"]);
    expect(offsets()).not.toContain("600");
    expect(result.current.recovery).toBe("capped");
    expect(result.current.overview?.inWindowCount).toBe(600);
  });

  it("stops on a short page and reports complete", async () => {
    const { result } = renderHook(() => useOverviewData());

    const full = Array.from({ length: PAGE_SIZE }, (_, i) =>
      inWindowEvent(`full-${i}`, 1 + i),
    );
    const short = Array.from({ length: 50 }, (_, i) =>
      inWindowEvent(`short-${i}`, 300 + i),
    );

    await resolveEvents(0, { items: full, total: 250 });
    await resolveEvents(0, { items: short, total: 250 });

    expect(offsets()).toEqual(["0", "200"]);
    expect(result.current.recovery).toBe("complete");
    expect(result.current.overview?.inWindowCount).toBe(250);
  });

  it("reports complete with a single request when one full page equals the server total", async () => {
    const { result } = renderHook(() => useOverviewData());

    const full = Array.from({ length: PAGE_SIZE }, (_, i) =>
      inWindowEvent(`e-${i}`, 1 + i),
    );
    await resolveEvents(0, { items: full, total: 200 });

    expect(eventUrls()).toHaveLength(1);
    expect(offsets()).toEqual(["0"]);
    expect(result.current.recovery).toBe("complete");
    expect(result.current.overview?.inWindowCount).toBe(200);
  });
});

describe("useOverviewData bounds", () => {
  it("keeps the live input bounded at BUFFER_LIMIT", async () => {
    const { result } = renderHook(() => useOverviewData());
    await openSocket(0);
    await resolveEvents(0, { items: [], total: 0 });

    await act(async () => {
      for (let i = 0; i < BUFFER_LIMIT + 1; i++) {
        FakeWebSocket.instances[0].onmessage?.({
          data: JSON.stringify(inWindowEvent(`e${i}`, 1 + i)),
        });
      }
    });

    expect(result.current.overview?.inWindowCount).toBe(BUFFER_LIMIT);
  });
});

describe("useOverviewData review-focus pins", () => {
  it("applies each of two in-flight recovery responses at most once, newest wins", async () => {
    const { result } = renderHook(() => useOverviewData());
    await openSocket(0);
    await resolveEvents(0, { items: [inWindowEvent("seed", 30)], total: 1 });

    // First reconnect: recovery A is left in flight.
    await dropAndReconnect();
    await openSocket(1);
    expect(unsettled("events")).toHaveLength(1);

    // Second reconnect while A is still unresolved: recovery B.
    await dropAndReconnect();
    await openSocket(2);
    expect(unsettled("events")).toHaveLength(2);

    // Resolve the NEWER response (B) with a short page.
    await resolveEvents(1, { items: [inWindowEvent("new", 5)], total: 1 });
    expect(result.current.recovery).toBe("complete");

    // Resolve the stale response (A) with a full page: it must be ignored.
    const stale = Array.from({ length: PAGE_SIZE }, (_, i) =>
      inWindowEvent(`stale-${i}`, 100 + i),
    );
    await resolveEvents(0, { items: stale, total: 700 });

    expect(result.current.recovery).toBe("complete");
    expect(result.current.overview?.inWindowCount).toBe(1);
    expect(JSON.stringify(result.current.overview)).not.toContain("stale-");
  });

  it("keeps fleetCounts populated when honeypots succeed but events fail", async () => {
    const { result } = renderHook(() => useOverviewData());

    await resolveFleet(0, [
      makeHoneypot("h1", "online"),
      makeHoneypot("h2", "offline"),
      makeHoneypot("h3", "never"),
    ]);
    await rejectPending("events");

    expect(result.current.overview).toBeNull();
    expect(result.current.eventsError).not.toBeNull();
    expect(result.current.eventsLoading).toBe(false);
    expect(result.current.fleetCounts).toEqual({
      total: 3,
      online: 1,
      offline: 1,
      never: 1,
    });
    expect(result.current.fleetError).toBeNull();
  });
});

describe("useOverviewData failure semantics", () => {
  it("sets eventsError and leaves overview null on an initial failure", async () => {
    const { result } = renderHook(() => useOverviewData());

    await rejectPending("events");

    expect(result.current.overview).toBeNull();
    expect(result.current.eventsError).not.toBeNull();
    expect(result.current.eventsLoading).toBe(false);
  });

  it("preserves the previous overview and reports failed on a recovery failure", async () => {
    const { result } = renderHook(() => useOverviewData());
    await openSocket(0);
    await resolveEvents(0, { items: [inWindowEvent("S1", 10)], total: 1 });
    expect(result.current.overview?.inWindowCount).toBe(1);

    await dropAndReconnect();
    await openSocket(1);
    await rejectPending("events");

    expect(result.current.recovery).toBe("failed");
    expect(result.current.eventsError).toBeNull();
    expect(result.current.overview?.inWindowCount).toBe(1);
  });

  it("reports a fleet error while the events overview still renders", async () => {
    const { result } = renderHook(() => useOverviewData());

    await rejectPending("honeypots");
    await resolveEvents(0, { items: [inWindowEvent("S1", 10)], total: 1 });

    expect(result.current.fleetError).not.toBeNull();
    expect(result.current.fleetCounts).toBeNull();
    expect(result.current.fleetLoading).toBe(false);
    expect(result.current.overview?.inWindowCount).toBe(1);
  });
});

describe("useOverviewData window re-anchoring", () => {
  it("re-anchors the window when the live buffer changes identity", async () => {
    const { result } = renderHook(() => useOverviewData());
    await openSocket(0);
    await resolveEvents(0, { items: [], total: 0 });

    const before = result.current.overview?.buckets[0].startIso;

    await act(async () => {
      vi.setSystemTime(NOW_MS + 3_600_000);
    });
    await pushLive(0, makeEvent("L", new Date(NOW_MS + 3_540_000).toISOString()));

    const after = result.current.overview?.buckets[0].startIso;
    expect(after).not.toBe(before);
    expect(result.current.overview?.inWindowCount).toBe(1);
  });
});
