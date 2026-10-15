/**
 * Pure aggregation for the S5 overview. The reporting window is always injected
 * (`makeWindow(endMs)`), never read from `Date.now()`, so every aggregate in one
 * derivation pass describes the exact same interval — two derived numbers can
 * never disagree about what "the last 24h" means. No React, no fetch, no side
 * effects: everything here is unit-testable without fake timers.
 */
import type { AttackEvent, Honeypot } from "../api/types";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Half-open interval `[startIso, endIso)`, both ISO-8601 UTC instants. */
export interface Window {
  startIso: string;
  endIso: string;
}

/**
 * `end` is the caller's single captured `now`. The arithmetic happens in
 * milliseconds, so a local DST jump can never stretch or shrink the window the
 * way calendar-based subtraction would.
 */
export function makeWindow(endMs: number): Window {
  return {
    startIso: new Date(endMs - DAY_MS).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

/** One chart hour: `[startIso, endIso)` is window-anchored, not wall-clock aligned. */
export interface HourBucket {
  startIso: string;
  endIso: string;
  count: number;
}

export interface Ranked {
  key: string;
  count: number;
}

export interface FleetCounts {
  total: number;
  online: number;
  offline: number;
  never: number;
}

export interface WindowDisclosure {
  text: string;
  truncated: boolean;
}

export interface Partition {
  inWindow: AttackEvent[];
  older: number;
  newer: number;
  unparseable: number;
}

/**
 * The single object the overview renders from. KPIs, chart, top lists and the
 * disclosure all read one derivation, so no two of them can drift apart.
 */
export interface Overview {
  fleet: FleetCounts | null;
  inWindowCount: number;
  buckets: HourBucket[];
  distinctSources: number;
  unattributed: number;
  topTypes: Ranked[];
  topPorts: Ranked[];
  disclosure: WindowDisclosure;
  outside: { older: number; newer: number; unparseable: number };
}

/**
 * `Date.parse` accepts more formats than the control center ever emits, but
 * rejects outright junk (`""`, `"not-a-date"`). Returning `null` rather than
 * `NaN` keeps that rejection visible to callers instead of letting a garbage
 * timestamp silently land in a bucket or a boundary comparison.
 */
function parseMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The only place events from different sources combine. `b` is scanned last so
 * it wins on id collision — it is the more recently observed representation.
 * Sorting here means every consumer of the merge sees one deterministic order:
 * `occurred_at` desc, `id` desc on ties, unparseable timestamps last.
 */
export function mergeById(a: AttackEvent[], b: AttackEvent[]): AttackEvent[] {
  const byId = new Map<string, AttackEvent>();
  for (const e of a) byId.set(e.id, e);
  for (const e of b) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => {
    const mx = parseMs(x.occurred_at);
    const my = parseMs(y.occurred_at);
    if (mx !== null && my !== null && mx !== my) return my - mx;
    if (mx !== null && my === null) return -1;
    if (mx === null && my !== null) return 1;
    return x.id === y.id ? 0 : x.id > y.id ? -1 : 1;
  });
}

/**
 * Splits on the half-open rule `start <= occurred_at < end`. The API's `until`
 * filter is inclusive, so this client-side partition — not the server — is the
 * authority for the window. Invariant: nothing is dropped,
 * `inWindow.length + older + newer + unparseable === events.length`.
 */
export function partitionByWindow(events: AttackEvent[], window: Window): Partition {
  const start = Date.parse(window.startIso);
  const end = Date.parse(window.endIso);
  const inWindow: AttackEvent[] = [];
  let older = 0;
  let newer = 0;
  let unparseable = 0;
  for (const e of events) {
    const ms = parseMs(e.occurred_at);
    if (ms === null) unparseable++;
    else if (ms < start) older++;
    else if (ms >= end) newer++;
    else inWindow.push(e);
  }
  return { inWindow, older, newer, unparseable };
}

/**
 * Exactly 24 buckets anchored to `window.start`, so they tile `[start, end)`
 * with no gap or overlap. Clock-aligned hours would need a partial 25th bucket
 * and force a choice between dropping edge events or double-counting them;
 * window-anchored buckets put every in-window event in exactly one bar.
 */
export function bucketByHour(inWindow: AttackEvent[], window: Window): HourBucket[] {
  const start = Date.parse(window.startIso);
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, i) => ({
    startIso: new Date(start + i * HOUR_MS).toISOString(),
    endIso: new Date(start + (i + 1) * HOUR_MS).toISOString(),
    count: 0,
  }));
  for (const e of inWindow) {
    const ms = parseMs(e.occurred_at);
    if (ms === null) continue; // partition guarantees parsed; never crash a render
    const index = Math.min(23, Math.max(0, Math.floor((ms - start) / HOUR_MS)));
    buckets[index].count++;
  }
  return buckets;
}

/**
 * Tie-breaks by key asc so a re-render can never reorder identical counts.
 * Ports stringify because that is how the UI renders them; a missing value
 * becomes `"unknown"` rather than silently vanishing from the ranking.
 */
export function topBy(
  inWindow: AttackEvent[],
  key: "event_type" | "target_port",
  n = 3,
): Ranked[] {
  const counts = new Map<string, number>();
  for (const e of inWindow) {
    const label =
      key === "target_port" ? String(e.target_port ?? "unknown") : (e.event_type ?? "unknown");
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ key: label, count }))
    .sort((x, y) => y.count - x.count || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
    .slice(0, n);
}

/**
 * Missing sources are reported separately instead of being folded into the
 * distinct count, so the UI can say how much of the picture has no attribution
 * rather than understating it.
 */
export function distinctSourceCount(inWindow: AttackEvent[]): {
  distinct: number;
  unattributed: number;
} {
  const sources = new Set<string>();
  let unattributed = 0;
  for (const e of inWindow) {
    // `==` catches both explicit null and an omitted key in serialized JSON.
    if (e.source_ip == null) unattributed++;
    else sources.add(e.source_ip);
  }
  return { distinct: sources.size, unattributed };
}

/** `status` is derived at read time from `last_seen_at` by the API, never stored. */
export function fleetCounts(honeypots: Honeypot[]): FleetCounts {
  const counts: FleetCounts = { total: honeypots.length, online: 0, offline: 0, never: 0 };
  for (const h of honeypots) counts[h.status]++;
  return counts;
}

/**
 * The wordings are verbatim (spec §6.1) so the label can never drift from the
 * arithmetic behind it. `count` is the merged in-window count — the same
 * partition the KPIs read — while `truncated` reports whether the fetch was
 * capped; `serverTotal` can only understate once live events arrive, so the
 * "most recent" wording never over-claims completeness.
 */
export function windowDisclosure(input: {
  count: number;
  sampleFetched: number;
  serverTotal: number;
}): WindowDisclosure {
  const truncated = input.sampleFetched < input.serverTotal;
  return {
    text: truncated
      ? `Most recent ${input.count} of ${input.serverTotal} events in the last 24h`
      : `All ${input.count} events in the last 24h`,
    truncated,
  };
}

/**
 * The overview's single entry point: merge once, partition once, then derive
 * every number from that one partition. KPIs, chart, top lists and the
 * disclosure therefore describe the same interval by construction. `fleet` is
 * `null` iff the honeypots request failed, so the UI can distinguish "loading"
 * from "zero machines".
 */
export function deriveOverview(input: {
  sample: AttackEvent[];
  live: AttackEvent[];
  window: Window;
  honeypots: Honeypot[] | null;
  serverTotal: number;
}): Overview {
  const merged = mergeById(input.sample, input.live);
  const partition = partitionByWindow(merged, input.window);
  const { distinct, unattributed } = distinctSourceCount(partition.inWindow);
  return {
    fleet: input.honeypots === null ? null : fleetCounts(input.honeypots),
    inWindowCount: partition.inWindow.length,
    buckets: bucketByHour(partition.inWindow, input.window),
    distinctSources: distinct,
    unattributed,
    topTypes: topBy(partition.inWindow, "event_type"),
    topPorts: topBy(partition.inWindow, "target_port"),
    disclosure: windowDisclosure({
      count: partition.inWindow.length,
      sampleFetched: input.sample.length,
      serverTotal: input.serverTotal,
    }),
    outside: {
      older: partition.older,
      newer: partition.newer,
      unparseable: partition.unparseable,
    },
  };
}
