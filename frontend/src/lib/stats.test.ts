import { describe, expect, it } from "vitest";
import type { AttackEvent, Honeypot } from "../api/types";
import { type Window, bucketByHour, deriveOverview, distinctSourceCount, fleetCounts, makeWindow, mergeById, partitionByWindow, topBy, windowDisclosure } from "./stats";

/**
 * Coverage map, verbatim from spec §14:
 *
 * // boundaries: exactly at start = included; exactly at end = excluded; ±1ms correct
 * // invariant: inWindow.length + older + newer + unparseable === input.length
 * // buckets: exactly 24; buckets[0].startIso === window.startIso;
 * //          buckets[23].endIso === window.endIso;
 * //          buckets[i].endIso === buckets[i+1].startIso; counts sum to inWindow.length
 * // edges: an event in the first and in the last (just before end) bucket both land correctly
 * // one window: KPI count === sum of bucket counts
 * // mergeById: union by id; later source wins; ordering occurred_at desc, id desc incl. ties
 * // topBy: deterministic order on a count tie; null keys become "unknown"
 * // fleetCounts: each of online/offline/never
 * // distinctSourceCount: null sources count as unattributed, not as a source
 * // windowDisclosure: both wordings verbatim; truncated === sampleFetched < serverTotal
 *
 * Plus the two Review Focus pins: unparseable occurred_at ("not-a-date" and "")
 * lands in no bucket, and makeWindow spans exactly 24h across a US DST
 * spring-forward transition.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const START_MS = Date.UTC(2026, 0, 2, 0, 0, 0);

const iso = (ms: number): string => new Date(ms).toISOString();

const WINDOW: Window = { startIso: iso(START_MS), endIso: iso(START_MS + DAY_MS) };

/** Full valid event; `received_at` is deliberately fixed and distinct from `occurred_at`. */
function ev(id: string, occurred_at: string, extra: Partial<AttackEvent> = {}): AttackEvent {
  return {
    id,
    honeypot_id: "hp-1",
    event_type: "ssh_bruteforce",
    source_ip: "192.0.2.10",
    source_port: 40000,
    target_port: 22,
    protocol: "tcp",
    details: {},
    occurred_at,
    received_at: "2026-01-02T06:00:00.000Z",
    ...extra,
  };
}

function hp(id: string, status: Honeypot["status"]): Honeypot {
  return {
    id,
    name: id,
    profile_id: "prof-1",
    profile: { id: "prof-1", name: "low-tcp", interaction_level: "low", version: 1 },
    config_version: 1,
    status,
    last_seen_at: status === "never" ? null : "2026-01-02T12:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("makeWindow", () => {
  it("anchors start exactly 24h before the injected end", () => {
    const endMs = START_MS + 5 * HOUR_MS;
    const w = makeWindow(endMs);
    expect(w.endIso).toBe(iso(endMs));
    expect(w.startIso).toBe(iso(endMs - DAY_MS));
  });

  it("spans exactly 24h even across a US spring-forward DST transition", () => {
    // US DST 2026 begins Sun Mar 8; this window straddles the transition.
    const endMs = Date.UTC(2026, 2, 9, 12, 0, 0);
    const w = makeWindow(endMs);
    expect(w.startIso).toBe("2026-03-08T12:00:00.000Z");
    expect(w.endIso).toBe("2026-03-09T12:00:00.000Z");
    expect(Date.parse(w.endIso) - Date.parse(w.startIso)).toBe(DAY_MS);
  });
});

describe("partitionByWindow boundaries (half-open [start, end))", () => {
  // exactly at start = included; exactly at end = excluded; ±1ms correct
  it("includes start and start+1ms; start-1ms is older", () => {
    const p = partitionByWindow(
      [
        ev("at-start", iso(START_MS)),
        ev("start-plus", iso(START_MS + 1)),
        ev("before-start", iso(START_MS - 1)),
      ],
      WINDOW,
    );
    expect(p.inWindow.map((e) => e.id)).toEqual(["at-start", "start-plus"]);
    expect(p.older).toBe(1);
    expect(p.newer).toBe(0);
    expect(p.unparseable).toBe(0);
  });

  it("excludes end and end+1ms as newer; end-1ms is included", () => {
    const endMs = START_MS + DAY_MS;
    const p = partitionByWindow(
      [
        ev("at-end", iso(endMs)),
        ev("end-plus", iso(endMs + 1)),
        ev("end-minus", iso(endMs - 1)),
      ],
      WINDOW,
    );
    expect(p.inWindow.map((e) => e.id)).toEqual(["end-minus"]);
    expect(p.newer).toBe(2);
    expect(p.older).toBe(0);
    expect(p.unparseable).toBe(0);
  });

  // invariant: inWindow.length + older + newer + unparseable === input.length
  it("conserves every input event across the four partitions", () => {
    const events = [
      ev("in-early", iso(START_MS + 1000)),
      ev("in-late", iso(START_MS + DAY_MS - 1000)),
      ev("old", iso(START_MS - HOUR_MS)),
      ev("future", iso(START_MS + DAY_MS + HOUR_MS)),
      ev("bad", "not-a-date"),
      ev("empty", ""),
    ];
    const p = partitionByWindow(events, WINDOW);
    expect(p.inWindow.length + p.older + p.newer + p.unparseable).toBe(events.length);
    expect(p).toMatchObject({ older: 1, newer: 1, unparseable: 2 });
  });

  it("Review Focus pin: unparseable occurred_at counts in unparseable and lands in no bucket", () => {
    const events = [
      ev("bad", "not-a-date"),
      ev("empty", ""),
      ev("good", iso(START_MS + 5 * HOUR_MS + 30 * 60_000)),
    ];
    const p = partitionByWindow(events, WINDOW);
    expect(p.unparseable).toBe(2);
    expect(p.inWindow.map((e) => e.id)).toEqual(["good"]);
    const buckets = bucketByHour(p.inWindow, WINDOW);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(1);
    expect(buckets[5].count).toBe(1);
  });
});

describe("bucketByHour", () => {
  // buckets: exactly 24; buckets[0].startIso === window.startIso;
  //          buckets[23].endIso === window.endIso;
  //          buckets[i].endIso === buckets[i+1].startIso
  it("tiles the window with exactly 24 contiguous buckets, zero case included", () => {
    const buckets = bucketByHour([], WINDOW);
    expect(buckets).toHaveLength(24);
    expect(buckets[0].startIso).toBe(WINDOW.startIso);
    expect(buckets[23].endIso).toBe(WINDOW.endIso);
    for (let i = 0; i < 23; i++) {
      expect(buckets[i].endIso).toBe(buckets[i + 1].startIso);
    }
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });

  it("counts sum to inWindow.length", () => {
    const events = [
      ev("b0a", iso(START_MS)),
      ev("b0b", iso(START_MS + HOUR_MS - 1)),
      ev("b1", iso(START_MS + HOUR_MS)),
      ev("b13", iso(START_MS + 13 * HOUR_MS + 30 * 60_000)),
      ev("b23", iso(START_MS + DAY_MS - 1)),
    ];
    const p = partitionByWindow(events, WINDOW);
    const buckets = bucketByHour(p.inWindow, WINDOW);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(p.inWindow.length);
    expect(buckets[0].count).toBe(2);
    expect(buckets[1].count).toBe(1);
    expect(buckets[13].count).toBe(1);
    expect(buckets[23].count).toBe(1);
  });

  it("anchors buckets to the window, never to wall-clock HH:00", () => {
    // Off-hour anchor: a clock-flooring implementation would emit `04:00:00.000Z`
    // as buckets[0] and fail the not-on-the-hour assertion below.
    const offHour: Window = {
      startIso: iso(Date.UTC(2026, 0, 2, 3, 37, 0)),
      endIso: iso(Date.UTC(2026, 0, 3, 3, 37, 0)),
    };
    const buckets = bucketByHour([], offHour);
    expect(buckets).toHaveLength(24);
    expect(buckets[0].startIso).toBe(offHour.startIso);
    expect(buckets[0].startIso).not.toMatch(/T\d{2}:00:00\.000Z$/);
    expect(buckets[23].endIso).toBe(offHour.endIso);
  });

  // edges: an event in the first and in the last (just before end) bucket both land correctly
  it("buckets the first- and last-bucket edge events correctly", () => {
    const buckets = bucketByHour(
      [ev("first", iso(START_MS)), ev("last", iso(START_MS + DAY_MS - 1))],
      WINDOW,
    );
    expect(buckets[0].count).toBe(1);
    expect(buckets[23].count).toBe(1);
    expect(buckets.slice(1, 23).every((b) => b.count === 0)).toBe(true);
  });
});

describe("mergeById", () => {
  it("unions by id with the later source (b) winning on collision", () => {
    const a = [
      ev("e1", iso(START_MS + 1000), { event_type: "ssh_bruteforce" }),
      ev("e2", iso(START_MS + 2000), { event_type: "http_scanner" }),
    ];
    const b = [ev("e2", iso(START_MS + 3000), { event_type: "telnet_bruteforce" }), ev("e3", iso(START_MS + 4000))];
    const merged = mergeById(a, b);
    expect(merged.map((e) => e.id).sort()).toEqual(["e1", "e2", "e3"]);
    expect(merged.find((e) => e.id === "e2")?.event_type).toBe("telnet_bruteforce");
  });

  // ordering occurred_at desc, id desc incl. ties
  it("orders by occurred_at desc, id desc on ties, across both sources", () => {
    const merged = mergeById(
      [ev("a", iso(START_MS + 1000)), ev("d", iso(START_MS + 2000))],
      [ev("c", iso(START_MS + 1000)), ev("b", iso(START_MS + 3000))],
    );
    expect(merged.map((e) => e.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("sorts unparseable timestamps last, id desc among them", () => {
    const merged = mergeById(
      [ev("z-bad", "not-a-date"), ev("a-good", iso(START_MS)), ev("m-bad", "")],
      [],
    );
    expect(merged.map((e) => e.id)).toEqual(["a-good", "z-bad", "m-bad"]);
  });
});

describe("topBy", () => {
  // deterministic order on a count tie
  it("breaks count ties by key asc and defaults to n = 3", () => {
    const events = [
      ev("1", iso(START_MS + 1), { event_type: "alpha" }),
      ev("2", iso(START_MS + 2), { event_type: "beta" }),
      ev("3", iso(START_MS + 3), { event_type: "alpha" }),
      ev("4", iso(START_MS + 4), { event_type: "gamma" }),
      ev("5", iso(START_MS + 5), { event_type: "delta" }),
    ];
    expect(topBy(events, "event_type")).toEqual([
      { key: "alpha", count: 2 },
      { key: "beta", count: 1 },
      { key: "delta", count: 1 },
    ]);
    expect(topBy(events, "event_type", 1)).toEqual([{ key: "alpha", count: 2 }]);
  });

  // null keys become "unknown"
  it('renders null keys as "unknown" and ports as strings', () => {
    const events = [
      ev("1", iso(START_MS + 1), { target_port: null }),
      ev("2", iso(START_MS + 2), { target_port: null }),
      ev("3", iso(START_MS + 3), { target_port: 22 }),
    ];
    expect(topBy(events, "target_port")).toEqual([
      { key: "unknown", count: 2 },
      { key: "22", count: 1 },
    ]);
  });
});

describe("fleetCounts", () => {
  // each of online/offline/never
  it("counts each status and totals", () => {
    const honeypots = [hp("h1", "online"), hp("h2", "online"), hp("h3", "offline"), hp("h4", "never")];
    expect(fleetCounts(honeypots)).toEqual({ total: 4, online: 2, offline: 1, never: 1 });
    expect(fleetCounts([])).toEqual({ total: 0, online: 0, offline: 0, never: 0 });
  });
});

describe("distinctSourceCount", () => {
  // null sources count as unattributed, not as a source
  it("counts distinct non-null sources and reports missing ones separately", () => {
    const events = [
      ev("1", iso(START_MS + 1), { source_ip: "192.0.2.1" }),
      ev("2", iso(START_MS + 2), { source_ip: "192.0.2.1" }),
      ev("3", iso(START_MS + 3), { source_ip: "198.51.100.7" }),
      ev("4", iso(START_MS + 4), { source_ip: null }),
      ev("5", iso(START_MS + 5), { source_ip: null }),
    ];
    expect(distinctSourceCount(events)).toEqual({ distinct: 2, unattributed: 2 });
    expect(distinctSourceCount([])).toEqual({ distinct: 0, unattributed: 0 });
  });

  it("treats an omitted source_ip key as unattributed, not as a source", () => {
    const omitted = { ...ev("6", iso(START_MS + 6)) };
    delete (omitted as Partial<AttackEvent>).source_ip;
    expect(omitted).not.toHaveProperty("source_ip");
    expect(
      distinctSourceCount([omitted, ev("7", iso(START_MS + 7), { source_ip: "203.0.113.5" })]),
    ).toEqual({ distinct: 1, unattributed: 1 });
  });
});

describe("windowDisclosure", () => {
  // both wordings verbatim; truncated === sampleFetched < serverTotal
  it("uses the untruncated wording verbatim when the sample is complete", () => {
    expect(windowDisclosure({ count: 12, sampleFetched: 12, serverTotal: 12 })).toEqual({
      text: "All 12 events in the last 24h",
      truncated: false,
    });
    // fetched more than the server's window total (live events arrived): not truncated
    expect(windowDisclosure({ count: 12, sampleFetched: 14, serverTotal: 12 }).truncated).toBe(false);
  });

  it("uses the truncated wording verbatim when the sample is capped", () => {
    expect(windowDisclosure({ count: 600, sampleFetched: 600, serverTotal: 742 })).toEqual({
      text: "Most recent 600 of 742 events in the last 24h",
      truncated: true,
    });
    expect(windowDisclosure({ count: 5, sampleFetched: 5, serverTotal: 6 }).truncated).toBe(true);
  });
});

describe("deriveOverview", () => {
  it("derives every aggregate from one merged partition", () => {
    const sample = [
      ev("s1", iso(START_MS + 1000), { source_ip: "192.0.2.1", event_type: "ssh_bruteforce", target_port: 22 }),
      ev("s2", iso(START_MS + HOUR_MS + 1000), { source_ip: "192.0.2.1", event_type: "http_scanner", target_port: 80 }),
      ev("s3", "not-a-date"),
    ];
    const live = [
      // same id as the sample entry: the live representation must win
      ev("s1", iso(START_MS + 2000), { source_ip: "203.0.113.9", event_type: "ssh_bruteforce", target_port: 22 }),
      ev("l1", iso(START_MS + 2 * HOUR_MS + 1000), { source_ip: "198.51.100.4", event_type: "ssh_bruteforce", target_port: 22 }),
      ev("future", iso(START_MS + DAY_MS + 1000)),
    ];
    const o = deriveOverview({
      sample,
      live,
      window: WINDOW,
      honeypots: [hp("h1", "online"), hp("h2", "offline")],
      serverTotal: 3,
    });
    expect(o.inWindowCount).toBe(3);
    expect(o.outside).toEqual({ older: 0, newer: 1, unparseable: 1 });
    expect(o.fleet).toEqual({ total: 2, online: 1, offline: 1, never: 0 });
    expect(o.distinctSources).toBe(3); // 203.0.113.9 overwrote 192.0.2.1 for s1
    expect(o.unattributed).toBe(0);
    expect(o.topTypes).toEqual([
      { key: "ssh_bruteforce", count: 2 },
      { key: "http_scanner", count: 1 },
    ]);
    expect(o.topPorts).toEqual([
      { key: "22", count: 2 },
      { key: "80", count: 1 },
    ]);
    expect(o.disclosure).toEqual({ text: "All 3 events in the last 24h", truncated: false });
  });

  // one window: KPI count === sum of bucket counts
  it("KPI count equals the sum of bucket counts", () => {
    const sample = [
      ev("s1", iso(START_MS + 30 * 60_000)),
      ev("s2", iso(START_MS + 10 * HOUR_MS)),
      ev("s3", iso(START_MS + DAY_MS - 1)),
      ev("old", iso(START_MS - 1)),
    ];
    const live = [ev("l1", iso(START_MS + 20 * HOUR_MS))];
    const o = deriveOverview({ sample, live, window: WINDOW, honeypots: [], serverTotal: 5 });
    const bucketSum = o.buckets.reduce((sum, b) => sum + b.count, 0);
    expect(o.inWindowCount).toBe(4);
    expect(o.inWindowCount).toBe(bucketSum);
    expect(o.outside).toEqual({ older: 1, newer: 0, unparseable: 0 });
  });

  it("fleet is null iff the honeypots request failed", () => {
    const o = deriveOverview({ sample: [], live: [], window: WINDOW, honeypots: null, serverTotal: 0 });
    expect(o.fleet).toBeNull();
    expect(o.disclosure).toEqual({ text: "All 0 events in the last 24h", truncated: false });
    expect(o.buckets).toHaveLength(24);
  });

  it("reports truncation from serverTotal while counting the merged window", () => {
    const sample = [ev("s1", iso(START_MS + 500))];
    const live = [ev("l1", iso(START_MS + 600))];
    const o = deriveOverview({ sample, live, window: WINDOW, honeypots: [], serverTotal: 900 });
    expect(o.inWindowCount).toBe(2);
    expect(o.disclosure).toEqual({ text: "Most recent 2 of 900 events in the last 24h", truncated: true });
  });
});
