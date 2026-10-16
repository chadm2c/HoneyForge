import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, createElement } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { BUFFER_LIMIT, useEventStream } from "./useEventStream";
import type { AttackEvent } from "../api/types";

/**
 * Fake WebSocket usable in jsdom: the hook talks to it, and the test drives
 * onopen/onmessage/onclose exactly like a real server would. Mirrors the shape
 * used in EventFeed.test.tsx, with an `instances` registry so reconnect can be
 * observed.
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

function makeEvent(id: string, occurredAt: string): AttackEvent {
  return {
    id,
    honeypot_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    event_type: "connection",
    source_ip: "192.0.2.1",
    source_port: 50000,
    target_port: 2222,
    protocol: "tcp",
    details: {},
    occurred_at: occurredAt,
    received_at: occurredAt,
  };
}

interface Pending {
  url: string;
  resolve: (body: { items: AttackEvent[]; total: number }, status?: number) => void;
  reject: (err?: unknown) => void;
}

let pending: Pending[] = [];
let urls: string[] = [];

beforeEach(() => {
  FakeWebSocket.instances = [];
  pending = [];
  urls = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // Every fetch stays pending until the test resolves/rejects it, so a test can
  // deliver live frames *during* a recovery request.
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(String(url));
      return new Promise<Response>((resolve, reject) => {
        pending.push({
          url: String(url),
          resolve: (body, status = 200) =>
            resolve({
              ok: status < 400,
              status,
              json: async () => body,
            } as unknown as Response),
          reject: (err) => reject(err ?? new Error("network")),
        });
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Flush the microtask chain of `apiFetch` -> `res.json()` -> merge. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function open(index = FakeWebSocket.instances.length - 1): Promise<void> {
  await act(async () => {
    FakeWebSocket.instances[index].onopen?.();
  });
}

async function close(index = FakeWebSocket.instances.length - 1): Promise<void> {
  await act(async () => {
    FakeWebSocket.instances[index].onclose?.();
  });
}

async function resolveNext(body: { items: AttackEvent[]; total: number }): Promise<void> {
  const deferred = pending.shift()!;
  await act(async () => {
    deferred.resolve(body);
  });
  await settle();
}

async function resolveAt(
  index: number,
  body: { items: AttackEvent[]; total: number },
): Promise<void> {
  const deferred = pending[index];
  await act(async () => {
    deferred.resolve(body);
  });
  await settle();
}

/** Connect once, resolve the initial history page, and return the held ids. */
async function bootWithHistory(held: AttackEvent[]): Promise<void> {
  await open(0);
  await resolveNext({ items: held, total: held.length });
}

/** Drop the live socket and advance past the first jitter window. */
async function dropAndReconnect(): Promise<void> {
  await close();
  await act(async () => {
    vi.advanceTimersByTime(2_000);
  });
}

const T0 = "2026-01-01T12:00:00.000Z";

describe("useEventStream status", () => {
  it("transitions connecting -> live -> reconnecting -> live", async () => {
    const { result } = renderHook(() => useEventStream({ manageHistory: false }));
    expect(result.current.status).toBe("connecting");

    await open(0);
    expect(result.current.status).toBe("live");

    await close(0);
    expect(result.current.status).toBe("reconnecting");

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    await open(1);
    expect(result.current.status).toBe("live");
  });
});

describe("useEventStream backoff", () => {
  it("schedules every reconnect in [base/2, base] and caps base at 30s", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    renderHook(() => useEventStream({ manageHistory: false }));

    const delays: number[] = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
      await close();
      delays.push(spy.mock.calls[spy.mock.calls.length - 1][1] as number);
      // Fire the reconnect, which increments the attempt counter on the next close.
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
    }

    for (let attempt = 1; attempt <= 6; attempt++) {
      const base = Math.min(1000 * 2 ** attempt, 30_000);
      const delay = delays[attempt - 1];
      expect(delay).toBeGreaterThanOrEqual(base / 2);
      expect(delay).toBeLessThanOrEqual(base);
    }
    // The cap: the sixth attempt's base is 30s and its delay cannot exceed it.
    expect(delays[5]).toBeLessThanOrEqual(30_000);
  });

  it("uses equal jitter: random 0 -> base/2, random ~1 -> base", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const spy = vi.spyOn(globalThis, "setTimeout");
    renderHook(() => useEventStream({ manageHistory: false }));

    await close(0); // attempt 1: base 2000
    expect(spy.mock.calls[spy.mock.calls.length - 1][1]).toBe(1000); // exactly base/2

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await open(1); // reset the attempt counter

    random.mockReturnValue(0.999999);
    await close(1); // attempt 1 again: base 2000
    const upper = spy.mock.calls[spy.mock.calls.length - 1][1] as number;
    expect(upper).toBeGreaterThan(1_000);
    expect(upper).toBeLessThan(2_000); // just below base
  });

  it("resets the attempt counter after a successful open", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    renderHook(() => useEventStream({ manageHistory: false }));

    await close();
    const first = spy.mock.calls[spy.mock.calls.length - 1][1] as number;
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    await open(1); // resets n to 0
    await close(1);
    const second = spy.mock.calls[spy.mock.calls.length - 1][1] as number;

    // Both are attempt 1: base = 2000, so both lie in [1000, 2000], not the
    // [2000, 4000] a stale counter would produce.
    expect(first).toBeGreaterThanOrEqual(1000);
    expect(first).toBeLessThanOrEqual(2_000);
    expect(second).toBeGreaterThanOrEqual(1000);
    expect(second).toBeLessThanOrEqual(2_000);
  });
});

describe("useEventStream recovery", () => {
  it("does not fetch on first connect beyond the initial page and reports none", async () => {
    const { result } = renderHook(() => useEventStream());

    await open(0);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(`limit=${BUFFER_LIMIT}`);
    expect(urls[0]).not.toContain("since");
    expect(urls[0]).not.toContain("offset");

    await resolveNext({ items: [makeEvent("T0", T0)], total: 1 });
    expect(result.current.gapFill).toBe("none");
    expect(result.current.events.map((e) => e.id)).toEqual(["T0"]);
  });

  it("issues exactly one recovery request at offset=0 and reports capped", async () => {
    const { result } = renderHook(() => useEventStream());
    await bootWithHistory([makeEvent("T0", T0)]);
    await dropAndReconnect();
    await open(1);

    const full = Array.from({ length: BUFFER_LIMIT }, (_, i) =>
      makeEvent(`M${i}`, new Date(Date.parse(T0) + (i + 1) * 1000).toISOString()),
    );
    await resolveNext({ items: full, total: BUFFER_LIMIT + 50 });

    expect(result.current.gapFill).toBe("capped");
    // Initial page + one recovery request.
    expect(urls).toHaveLength(2);
    expect(urls.filter((u) => u.includes("offset="))).toHaveLength(1);
    expect(urls.some((u) => /offset=(200|400|600)/.test(u))).toBe(false);
    expect(urls.filter((u) => u.includes("since="))).toHaveLength(1);
  });

  it("anchors the recovery at the pre-drop checkpoint minus one second", async () => {
    renderHook(() => useEventStream());
    await bootWithHistory([makeEvent("T0", T0)]);
    await dropAndReconnect();
    await open(1);

    const decoded = decodeURIComponent(urls[1]);
    expect(decoded).toContain(`since=${new Date(Date.parse(T0) - 1000).toISOString()}`);
    expect(decoded).toContain("offset=0");
  });

  it("completes on a short page and reports the recovered events", async () => {
    const { result } = renderHook(() => useEventStream());
    await bootWithHistory([makeEvent("T0", T0)]);
    await dropAndReconnect();
    await open(1);

    await resolveNext({
      items: [makeEvent("M1", "2026-01-01T12:01:00.000Z")],
      total: 1,
    });

    expect(result.current.gapFill).toBe("complete");
    expect(result.current.events.map((e) => e.id).sort()).toEqual(["M1", "T0"]);
  });

  it("reports complete and leaves the buffer unchanged on an empty page", async () => {
    const { result } = renderHook(() => useEventStream());
    await bootWithHistory([makeEvent("T0", T0)]);
    await dropAndReconnect();
    await open(1);

    await resolveNext({ items: [], total: 0 });

    expect(result.current.gapFill).toBe("complete");
    expect(result.current.events.map((e) => e.id)).toEqual(["T0"]);
  });

  it("reports complete when exactly BUFFER_LIMIT events were missed", async () => {
    const { result } = renderHook(() => useEventStream());
    await bootWithHistory([makeEvent("T0", T0)]);
    await dropAndReconnect();
    await open(1);

    const full = Array.from({ length: BUFFER_LIMIT }, (_, i) =>
      makeEvent(`M${i}`, new Date(Date.parse(T0) + (i + 1) * 1000).toISOString()),
    );
    await resolveNext({ items: full, total: BUFFER_LIMIT });

    expect(result.current.gapFill).toBe("complete");
    expect(result.current.events).toHaveLength(BUFFER_LIMIT);
  });

  it("preserves held events and reports failed when the request rejects", async () => {
    const { result } = renderHook(() => useEventStream());
    await bootWithHistory([makeEvent("T0", T0)]);
    await dropAndReconnect();
    await open(1);

    await act(async () => {
      pending.shift()!.reject(new Error("network down"));
    });
    await settle();

    expect(result.current.events.map((e) => e.id)).toEqual(["T0"]);
    expect(result.current.gapFill).toBe("failed");
    expect(result.current.status).toBe("live");
  });

  it("dedupes across the page, the 1s overlap and live frames, keeping same-timestamp events", async () => {
    const { result } = renderHook(() => useEventStream());
    await bootWithHistory([makeEvent("T0", T0)]);
    await dropAndReconnect();

    const ws = FakeWebSocket.instances[1];
    await open(1);
    // Two live frames, one of which the recovery page also carries.
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify(makeEvent("M2", "2026-01-01T12:02:00.000Z")) });
      ws.onmessage?.({ data: JSON.stringify(makeEvent("L1", "2026-01-01T12:05:00.000Z")) });
    });

    await resolveNext({
      items: [
        makeEvent("T0", T0), // overlap with the held checkpoint
        makeEvent("M1", "2026-01-01T12:01:00.000Z"),
        makeEvent("M2", "2026-01-01T12:02:00.000Z"), // duplicate of live
        makeEvent("M3", "2026-01-01T12:02:00.000Z"), // same occurred_at as M2
      ],
      total: 4,
    });

    const ids = result.current.events.map((e) => e.id);
    for (const id of ["T0", "M1", "M2", "M3", "L1"]) {
      expect(ids.filter((x) => x === id)).toHaveLength(1);
    }
  });

  it("preserves a live frame that arrives before the recovery resolves", async () => {
    const { result } = renderHook(() => useEventStream());
    await bootWithHistory([makeEvent("T0", T0)]);
    await dropAndReconnect();

    const ws = FakeWebSocket.instances[1];
    await open(1);
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify(makeEvent("L3", "2026-01-01T12:09:00.000Z")) });
    });
    await resolveNext({ items: [makeEvent("M1", "2026-01-01T12:01:00.000Z")], total: 1 });

    const ids = result.current.events.map((e) => e.id).sort();
    expect(ids).toEqual(["L3", "M1", "T0"]);
  });

  it("manageHistory false issues no REST and leaves gapFill none", async () => {
    const { result } = renderHook(() => useEventStream({ manageHistory: false }));

    await open(0);
    await settle();

    expect(urls).toHaveLength(0);
    expect(result.current.gapFill).toBe("none");
    expect(result.current.status).toBe("live");

    // The socket still streams without any REST history.
    await act(async () => {
      FakeWebSocket.instances[0].onmessage?.({
        data: JSON.stringify(makeEvent("live", "2026-01-01T12:00:00.000Z")),
      });
    });
    expect(result.current.events.map((e) => e.id)).toEqual(["live"]);
  });
});

describe("useEventStream critical gap scenario", () => {
  it("does not move the anchor when live frames arrive during the recovery fetch", async () => {
    const { result } = renderHook(() => useEventStream());
    await bootWithHistory([makeEvent("T0", T0)]);
    await dropAndReconnect();

    const ws = FakeWebSocket.instances[1];
    await open(1);
    // Newer-than-everything live frames delivered *during* the fetch.
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify(makeEvent("L1", "2026-01-01T12:05:00.000Z")) });
      ws.onmessage?.({ data: JSON.stringify(makeEvent("L2", "2026-01-01T12:06:00.000Z")) });
    });

    const missed = [
      makeEvent("T0", T0), // overlap
      makeEvent("M1", "2026-01-01T12:01:00.000Z"),
      makeEvent("M2", "2026-01-01T12:02:00.000Z"),
      makeEvent("M3", "2026-01-01T12:03:00.000Z"),
      makeEvent("M4", "2026-01-01T12:04:00.000Z"),
      makeEvent("L2", "2026-01-01T12:06:00.000Z"), // duplicate of live
    ];
    await resolveNext({ items: missed, total: missed.length });

    // (a) The live L frames did NOT move the anchor; it is the pre-drop T0.
    expect(decodeURIComponent(urls[1])).toContain(
      `since=${new Date(Date.parse(T0) - 1000).toISOString()}`,
    );

    // (b) every missed event the page can carry is present;
    // (c) L1 and L2 are preserved;
    // (d) nothing is duplicated.
    const ids = result.current.events.map((e) => e.id);
    for (const id of ["T0", "M1", "M2", "M3", "M4", "L1", "L2"]) {
      expect(ids.filter((x) => x === id)).toHaveLength(1);
    }
    expect(result.current.gapFill).toBe("complete");
    expect(result.current.status).toBe("live");
  });

  it("(e) a > BUFFER_LIMIT outage is capped and keeps the newest BUFFER_LIMIT", async () => {
    const { result } = renderHook(() => useEventStream());
    await bootWithHistory([makeEvent("T0", T0)]);
    await dropAndReconnect();
    await open(1);

    const full = Array.from({ length: BUFFER_LIMIT }, (_, i) =>
      makeEvent(`M${i}`, new Date(Date.parse(T0) + (i + 1) * 1000).toISOString()),
    );
    await resolveNext({ items: full, total: BUFFER_LIMIT + 100 });

    expect(result.current.gapFill).toBe("capped");
    expect(result.current.events).toHaveLength(BUFFER_LIMIT);
    const ids = result.current.events.map((e) => e.id);
    expect(ids).not.toContain("T0"); // oldest dropped
    expect(ids).toContain(`M${BUFFER_LIMIT - 1}`); // newest kept
  });
});

describe("useEventStream buffer cap", () => {
  it("drops the oldest on the 201st insert and never exceeds BUFFER_LIMIT", async () => {
    const { result } = renderHook(() => useEventStream({ manageHistory: false }));
    const ws = FakeWebSocket.instances[0];
    await open(0);

    await act(async () => {
      for (let i = 0; i < BUFFER_LIMIT + 1; i++) {
        ws.onmessage?.({
          data: JSON.stringify(
            makeEvent(`e${i}`, new Date(Date.parse(T0) + i * 1000).toISOString()),
          ),
        });
      }
    });

    expect(result.current.events).toHaveLength(BUFFER_LIMIT);
    const ids = result.current.events.map((e) => e.id);
    expect(ids).not.toContain("e0");
    expect(ids).toContain(`e${BUFFER_LIMIT}`);
  });
});

describe("useEventStream review-focus pins", () => {
  it("ignores a malformed '{' frame and an id-less '{}' frame and keeps streaming", async () => {
    const { result } = renderHook(() => useEventStream({ manageHistory: false }));
    const ws = FakeWebSocket.instances[0];
    await open(0);

    await act(async () => {
      ws.onmessage?.({ data: "{" });
      ws.onmessage?.({ data: "{}" });
    });

    expect(result.current.events).toHaveLength(0);
    expect(result.current.status).toBe("live");

    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify(makeEvent("ok", T0)) });
    });
    expect(result.current.events.map((e) => e.id)).toEqual(["ok"]);
    expect(result.current.status).toBe("live");
  });

  it("applies each of two in-flight recovery responses at most once, newest wins", async () => {
    const { result } = renderHook(() => useEventStream());
    await bootWithHistory([makeEvent("T0", T0)]);

    // Two reconnects fire before either recovery fetch resolves.
    await dropAndReconnect();
    await open(1); // fetch A pending
    await close(1);
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    await open(2); // fetch B pending

    expect(pending).toHaveLength(2);

    // Resolve the NEWER response first with a complete page.
    await resolveAt(1, {
      items: [makeEvent("B1", "2026-01-01T12:10:00.000Z")],
      total: 1,
    });
    // Then resolve the STALE one with a capped page: it must be ignored.
    const capped = Array.from({ length: BUFFER_LIMIT }, (_, i) =>
      makeEvent(`A${i}`, new Date(Date.parse(T0) + (i + 1) * 1000).toISOString()),
    );
    await resolveAt(0, { items: capped, total: BUFFER_LIMIT + 10 });

    expect(result.current.gapFill).toBe("complete");
    const ids = result.current.events.map((e) => e.id);
    expect(ids).toContain("B1");
    expect(ids.some((id) => id.startsWith("A"))).toBe(false);
  });
});

describe("useEventStream disposal", () => {
  it("cancels the reconnect timer and creates no socket after unmount", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderHook(() => useEventStream({ manageHistory: false }));

    await open(0);
    await close(0);
    const before = FakeWebSocket.instances.length;

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(FakeWebSocket.instances).toHaveLength(before);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("never sets state from a recovery response that resolves after unmount", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderHook(() => useEventStream());

    await open(0);
    expect(pending).toHaveLength(1);

    unmount();
    await resolveNext({ items: [makeEvent("late", T0)], total: 1 });

    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("useEventStream under StrictMode", () => {
  it("scopes the socket lifecycle to each effect instance", async () => {
    const latest: { current: ReturnType<typeof useEventStream> | null } = {
      current: null,
    };
    // `renderHook`'s wrapper does not trigger StrictMode's effect double-invoke
    // in this environment; a plain `render` of a harness does, so use that.
    function Harness() {
      latest.current = useEventStream({ manageHistory: false });
      return null;
    }

    const { unmount } = render(
      createElement(StrictMode, null, createElement(Harness)),
    );

    // StrictMode runs effect -> cleanup -> effect on mount. The first socket is
    // disposed during the double-invoke, leaving exactly one current socket.
    expect(FakeWebSocket.instances).toHaveLength(2);
    const disposed = FakeWebSocket.instances[0];
    const current = FakeWebSocket.instances[1];

    await act(async () => {
      current.onopen?.();
    });
    expect(latest.current!.status).toBe("live");

    // The disposed socket's close event is asynchronous, so it arrives after the
    // second effect run. It must not flip the live status or re-arm a reconnect.
    await act(async () => {
      disposed.onclose?.();
    });
    expect(latest.current!.status).toBe("live");

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);

    unmount();
  });
});
