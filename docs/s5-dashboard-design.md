# S5 — Dashboard Experience

**Date:** 2026-10-15
**Status:** Design approved — pending implementation plan
**Slice:** S5 (per `AGENTS.md` §7/§11 and `docs/HoneyForge_Implementation_Plan.md` §11 Phase 4 "Dashboard and realtime")
**Related:** `AGENTS.md` §3/§4/§5/§8/§10; plan §11 Phase 4, §12 (testing plan), §13 (demo plan)

---

## 1. Goal

Give the operator an at-a-glance landing view and finish the dashboard: an
overview page, one small chart, real detail panels, and honest WebSocket
reconnection. S5 **improves** the surface S2–S4 built; it **does not introduce**
new backend capability (`AGENTS.md` §11).

Success = the plan's Phase 4 exit criteria: *a controlled decoy interaction
appears in the UI without refreshing.* Every claim below must be provable by an
automated test or a documented reproducible command (per-slice gate: runnable /
verifiable / demoable).

## 2. Current state (S1–S4, already built)

- Five routed pages exist: `LoginPage`, `FleetPage`, `ProfilesPage`,
  `EventsPage`, `AuditPage`. Frontend suite: **34 tests / 10 files**, `tsc -b`
  clean, `vite build` clean.
- `EventFeed` is mounted on `EventsPage` and consumes `useEventStream`, which
  does REST history (`limit=100`) then a first-message-authenticated WebSocket,
  deduped by the agent-generated event id, sorted `occurred_at` desc.
- `useEventStream` already refetches history on every `(re)connect` and backs
  off exponentially (1s→30s). Three real weaknesses are in scope here: **no
  jitter**, an **unbounded** in-memory array, and a gap-fill that blindly
  refetches `limit=100` rather than the actual gap.
- `StatusBadge` is binary (`live` / `reconnecting`) and has **one** consumer,
  `EventFeed`. `FleetStatusBadge` is a different axis (derived fleet status) and
  is not touched.
- **No overview page, no chart, no detail panels.** `EventsPage` renders a raw
  `JSON.stringify(details)` dump. `GET /api/honeypots/{id}` exists but the UI
  never calls it.
- No chart library. Three runtime dependencies: `react`, `react-dom`,
  `react-router-dom`.
- Tailwind classes are copy-pasted across the five pages; loading/empty/error
  treatments are inconsistent page to page.
- Backend `GET /api/events` supports `honeypot_id`, `event_type`, `source_ip`,
  `q`, `since`, `until`, `limit` (`1..200`), `offset`, and returns
  `{items, total}`. `since`/`until` filter on **`occurred_at`**; ordering is
  `occurred_at desc, id desc` (`app/services/event_service.py`). Two contract
  details drive §6 and §11: `since` is inclusive (`>=`) and `until` is
  **inclusive** (`<=`), so the API cannot express an exclusive upper bound — the
  client enforces one. `total` is the count for the whole filter scope,
  independent of `limit`/`offset`, so it is the server's window count at fetch
  time.
- `Honeypot` carries `profile.version` **and** `config_version`, so config drift
  is computable from data the UI already receives.

## 3. Scope

**In scope**

- Overview page at `/`: fleet counts, events in window, distinct sources, top
  event types, top targeted ports, and one events-per-hour chart.
- Client-side aggregation layer with an explicit, testable honesty label.
- One explicit reporting interval — the half-open `[start, end)` window — shared
  by the fetch, the KPIs, the chart buckets and the disclosure (§6), so no two
  numbers on the page can describe different intervals.
- In-place detail panels: structured event detail on `EventsPage`; honeypot
  detail on `FleetPage` via the existing `GET /api/honeypots/{id}`.
- WebSocket hardening: jitter, bounded buffer, offset-advanced gap-fill,
  tri-state status.
- A bounded theme consistency pass via shared UI primitives.
- Expanded frontend tests for every item above.

**Out of scope (deliberately)**

- **Any new backend endpoint, schema change, or migration.** The overview is
  client-side only. Server-side aggregation is the correct long-term answer and
  is explicitly deferred with this slice's honesty label as the stopgap.
- A charting library. The chart is hand-rolled inline SVG.
- New frontend routes beyond `/` (no `/events/:id`, no `/fleet/:id`): there is
  no `GET /api/events/{id}`, so a deep link could not rehydrate on refresh, and
  adding one would break the "does not introduce" rule.
- Full restyle, new theme, dark/light toggle, decorative animation
  (`AGENTS.md` §4 forbids decorative animation).
- Login rate-limiting, payload caps, Nginx/TLS → S6.
- Alerts, IOC export, honeytokens → bonus items, only after the mandatory flow.

## 4. Approved decisions

| Decision | Choice |
|---|---|
| Overview data | Client-side aggregation from existing GETs; **no new endpoint** |
| Chart | Hand-rolled inline SVG; **zero new dependencies** |
| Detail views | In-place panels; **no new routes** |
| Theme polish | Bounded consistency pass: extract shared primitives, adopt across pages, **no rendered text/role changes** |
| Reconnect | Harden the existing hook (jitter, cap, offset-advanced gap-fill, tri-state) |
| Reporting interval | One half-open `[start, end)` window per derivation pass; client-enforced exclusive end (§6) |
| Event merge | One canonical `mergeById` derivation; the REST sample and the live buffer stay in separate, single-owner state cells (§7.1) |
| Recovery completeness | Reported separately from connection state via `gapFill`; never claimed when capped or failed (§11.3) |
| Spec location | `docs/s5-dashboard-design.md` (tracked, matching the S4 convention) |

## 5. Routes and navigation

| Route | Before | After |
|---|---|---|
| `/` | (no index; `*` caught it) | `OverviewPage` |
| `*` | redirect `/fleet` | redirect `/` |
| `/fleet`, `/profiles`, `/events`, `/audit` | unchanged | unchanged |
| `/login` | unchanged | unchanged |
| Post-login destination | `/fleet` | `/` |

`AppShell`'s `NAV` gains `{ to: "/", label: "Overview" }` as its first entry.

**Known touch points** (required, not optional, test updates):

- `LoginPage.test.tsx` — asserts where a successful login lands.
- `EventFeed.test.tsx` — asserts badge text; the initial state becomes
  `connecting`, not `reconnecting` (§12).
- `App.test.tsx` — re-check the `*` catch-all and nav assertions.

## 6. Reporting window — one interval, one capture

Every number on the overview — KPIs, chart buckets, top lists and the disclosure
— describes **one** interval:

```
window = { start, end }        // both ISO-8601 UTC instants
end    = now                   // ONE capture per derivation pass
start  = end − 24h
```

- The interval is **half-open**: `start` inclusive, `end` exclusive
  (`start ≤ occurred_at < end`).
- `now` is captured **once per derivation pass** and passed into every pure
  function. No function in `lib/stats.ts` calls `Date.now()`, so two aggregates
  cannot independently derive different boundaries and disagree about what "the
  last 24h" means.
- A **derivation pass** is the initial load, a recovery refetch, or a live event
  arriving. Each pass re-anchors the window to one fresh `now`.
  **Why per pass and not once per session:** a session-frozen `end` would place
  every event arriving after the initial load outside the window, so live events
  could never move the KPIs — contradicting §1's exit criteria. Re-anchoring
  makes the window genuinely rolling; boundaries advance as time passes, which is
  what "the last 24h" means.
- **The API cannot express the exclusive end.** `until` is inclusive (`<=`), so
  it is not used as the authority. The fetch sends `since=start&until=end` to
  bound the payload and make `total` meaningful, and the **client-side filter is
  the authority** for the interval: an event exactly at `end` is excluded client
  side even if the server returned it.
- An event with `occurred_at ≥ end` — future-dated under clock skew — is
  **excluded** and counted separately, never bucketed into the newest bar.

### 6.1 Aggregation layer — `lib/stats.ts`

Pure functions only: **no React, no fetch, no `Date.now()` inside the module**.
The window is injected so every case is unit-testable without fake timers.

```ts
export interface Window { startIso: string; endIso: string }
export interface HourBucket { startIso: string; endIso: string; count: number }
export interface Ranked { key: string; count: number }
export interface FleetCounts { total: number; online: number; offline: number; never: number }
export interface WindowDisclosure { text: string; truncated: boolean }
export interface Partition {
  inWindow: AttackEvent[]
  older: number       // occurred_at < start
  newer: number       // occurred_at >= end (future-dated)
  unparseable: number // occurred_at missing or unusable
}
export interface Overview {
  fleet: FleetCounts | null   // null iff the honeypots request failed (§7.5)
  inWindowCount: number
  buckets: HourBucket[]       // exactly 24
  distinctSources: number
  unattributed: number
  topTypes: Ranked[]
  topPorts: Ranked[]
  disclosure: WindowDisclosure
  outside: Pick<Partition, "older" | "newer" | "unparseable"> // counts only
}
```

- `mergeById(a, b): AttackEvent[]` — union by event `id`; on collision **`b`
  wins** (the most recently observed representation). The single place events
  from different sources are combined.
- `partitionByWindow(events, window): Partition` — splits on the exact half-open
  rule above. Invariant, asserted in tests:
  `inWindow.length + older + newer + unparseable === events.length`. Nothing is
  silently dropped; an unusable `occurred_at` lands in `unparseable`.
- `bucketByHour(inWindow, window): HourBucket[]` — **exactly 24 buckets** that
  tile the window with no gap and no overlap. Bucket `i` (0-based, oldest →
  newest) is `[start + i·1h, start + (i+1)·1h)`, so every in-window event belongs
  to exactly one bucket (binned by `floor((occurred_at − start) / 1h)`, clamped
  to `0..23`).
- `topBy(inWindow, key, n = 3): Ranked[]` — `key` selects `event_type` or
  `target_port`; null/undefined becomes `"unknown"`; deterministic tie-break
  (count desc, then key asc) so tests cannot flake.
- `distinctSourceCount(inWindow): { distinct: number; unattributed: number }` —
  distinct non-null `source_ip`, plus a count of events with no source, so the UI
  can be honest about incompleteness.
- `windowDisclosure({ count, sampleFetched, serverTotal }): WindowDisclosure` —
  the two **verbatim** wordings, so the label can never drift from the
  arithmetic. The window length is fixed at 24h for this slice and is therefore
  hardcoded in the strings:

  - not truncated → `All {count} events in the last 24h`
  - truncated → `Most recent {count} of {serverTotal} events in the last 24h`

  `count` is the **merged, in-window** event count — exactly what the KPIs are
  computed from, so the label and the numbers cannot diverge. `truncated` is
  `sampleFetched < serverTotal`. `serverTotal` is the server's count for the
  fetch filter at fetch time; once live events have arrived it can only
  *understate* the window total, so the "most recent N of M" wording never
  over-claims completeness (§15.1).
- `deriveOverview({ sample, live, window, honeypots }): Overview` — the **only**
  entry point the page uses: merge (`mergeById`), partition once, then compute
  every aggregate from that single partition. The page and the chart cannot
  disagree because they read the same `Overview`.

All internal time math is UTC.

### 6.2 Chart bucket alignment — window-anchored, not clock-aligned

Buckets are anchored to `window.start`, not to wall-clock hours. A clock-aligned
tiling would need 25 calendar hours to cover a 24-hour window, leaving a partial
25th bucket and a choice between dropping events at the edges or double-counting
them. Window-anchored tiling covers `[start, end)` exactly with 24 buckets.

Consequence, stated plainly: the oldest and newest buckets are **partial
wall-clock hours** (they begin and end mid-hour). Each bucket is therefore
identified by its **actual start instant** (`HH:MM` UTC) rather than a fabricated
`HH:00`, and the axis prints the window bounds (§9).

## 7. Overview data hook — `hooks/useOverviewData.ts`

### 7.1 Ownership of event state (Correction C)

Two event stores exist and they are **not** interchangeable. Each has exactly one
owner:

| State | Owner | Bound | Purpose |
|---|---|---|---|
| `sample` — the window snapshot | `useOverviewData` | ≤ 600 (`WINDOW_MAX_PAGES · PAGE_SIZE`) | the fetched 24h basis for the aggregates |
| `events` — the live rolling buffer | `useEventStream` | ≤ 200 (`BUFFER_LIMIT`) | frames received on the socket; also powers `EventFeed` |

**Canonical merge.** Neither store is the truth on its own. The truth is produced
at render time by `deriveOverview`, which calls `mergeById(sample, live)` and then
partitions once (§6.1). This is the **only** merge in the slice; there is no second
place where the two lists are combined, so they cannot drift apart.

**The overview must not mount `EventFeed`** — that would open a second WebSocket
for the same view. The overview takes live updates only from the hook.

### 7.2 Fetch plan

1. `GET /api/honeypots` — once per pass.
2. `GET /api/events?since=<start>&until=<end>&limit=<PAGE_SIZE>&offset=…` — paged by
   advancing `offset`, stopping early when a page returns fewer than `PAGE_SIZE`
   items or the running count reaches `total`.

`since`/`until` are the window bounds from §6, so the server's `total` is the
count for the same interval (modulo the inclusive-`end` edge, §6).

**Constants.** `PAGE_SIZE = 200`, `WINDOW_MAX_PAGES = 3` → at most 600 events in
one bounded burst. The cap is why the disclosure label exists at all. 600 is a
deliberate ceiling: big enough that a demo's whole event history fits, small
enough to stay bounded.

### 7.3 Race-safe fetch and merge (Correction C)

The REST sample and the WebSocket deliver events concurrently. The rules:

- A REST response **replaces only `sample`.** It never touches the live buffer, so
  a live event received while a request was in flight cannot be erased by the
  response — that event is still in the other store and is included again by
  `mergeById` on the next derivation.
- Responses are guarded by a **monotonic request id** (`useRef` counter). Only the
  response from the newest in-flight request to each endpoint is applied; a stale
  response — an initial load that resolves *after* a recovery refetch — is dropped
  rather than overwriting fresher state. A per-effect `cancelled` flag alone is not
  enough, because both requests are issued from the same mounted hook.
- Every derivation calls `mergeById` **before** partitioning, so the KPIs, the
  hourly buckets and the top lists are all computed over the deduped set.
- Ordering after merge: `occurred_at desc`, then `id desc`, matching the server's
  `ORDER BY` and making same-timestamp ties deterministic (the current client sort
  has no tie-break).
- **Recovery:** on `reconnecting → live`, refetch the window (a fresh pass with a
  fresh `now`). The response replaces `sample` only; live events arriving during
  the refetch are preserved, and id-dedupe absorbs the overlap. No state is
  cleared, so a failed refetch degrades to "stale sample" rather than "empty page".
- No polling timer and no state-management library. The socket is the update
  mechanism; the recovery refetch is the reconciliation.

### 7.4 Live merge

The hook subscribes to `useEventStream({ manageHistory: false })` — the overview
owns its own window sample, so the hook must not issue its own REST (§11.1). Live
frames land in the hook's bounded buffer and are folded into the next derivation.
The derivation input is bounded by construction: `sample` ≤ 600 plus `live` ≤ 200.
A live event moves the KPIs and the chart **without a refresh** — the Phase 4 exit
criteria.

### 7.5 Partial failure (Correction D)

The overview depends on two independent requests. Each drives its own sections and
has four distinct states:

| Request | Sections it governs | `loading` | `error` | genuine empty |
|---|---|---|---|---|
| `GET /api/honeypots` | fleet KPI block | placeholder | error in the fleet block | four zero counts is a **valid** result here |
| `GET /api/events` | events KPI, chart, top types, top ports, disclosure | placeholders | error in each of those blocks | "no events in the last 24h" |

- **A failed request is never rendered as zero.** The block shows an error message;
  a zero is shown only for a *successful* response that genuinely contained no
  rows.
- The two requests succeed or fail independently: a successful events fetch still
  renders its KPIs, chart and top lists while the fleet block shows an error, and
  vice versa.
- `loading` renders a placeholder, distinct from both `0` and the error state.
- Both failing renders two independent error states, not one blank page.

### 7.6 Return

```ts
interface OverviewResult {
  overview: Overview | null   // null iff the events request failed
  fleetLoading: boolean
  fleetError: string | null
  eventsLoading: boolean
  eventsError: string | null
  status: ConnectionStatus    // from the hook (§11.1)
  gapFill: GapFillState       // from the hook (§11.3)
}
```

`Overview.fleet` is `null` iff the honeypots request failed, independently of
`overview` itself.

## 8. Overview page — `pages/OverviewPage.tsx`

Layout, top to bottom:

1. Connection badge (§12) and the window disclosure line.
2. KPI row: fleet total + online/offline/never; events in window; distinct
   source IPs, with a muted `(N unattributed)` note when any event has no source.
3. Chart panel (§9).
4. Top event types panel (top 3, with counts).
5. Top targeted ports panel (top 3, with counts).

Each panel has its own loading, empty ("no events in the last 24h"), and error
state, governed independently by the two requests (§7.5) — a failed request shows
an error, never a zero. Accessibility: the chart is `role="img"` with an
`aria-label` that carries the disclosure text; no KPI is communicated by colour
alone.

## 9. Chart — `components/EventsOverTimeChart.tsx`

Props: `{ buckets: HourBucket[]; disclosure: WindowDisclosure }`.

- Inline SVG, fixed `viewBox="0 0 480 120"`, `className="h-32 w-full"`.
- 24 bars, oldest left. The y-scale is `max(count)`, with an explicit
  `max === 0` case rendering a flat baseline plus a "no events" label rather
  than dividing by zero.
- Axis text kept minimal: the max value on the y-axis; the x-axis shows the
  window bounds (oldest bucket start → newest bucket end). Because buckets are
  window-anchored (§6.2), no label claims `HH:00`.
- Each bar carries a `<title>` of `YYYY-MM-DD HH:MM UTC — N events`, using the
  bucket's **actual** start instant.
- `aria-label` = `Events per hour over the last 24h. {disclosure.text}`.
- No animation, no gradients. Cyan accent on the existing slate palette.
- Not interactive beyond the `<title>`; this is stated in §14, not implied.

## 10. Detail panels

### `components/EventDetail.tsx`

Replaces the raw JSON dump inside `EventsPage`'s existing row expansion. Props:
`{ event: AttackEvent; honeypotName?: string }`.

| Field | Source |
|---|---|
| Type | `event_type` |
| Protocol | `protocol` |
| Honeypot | resolved **name** from the honeypot list `EventsPage` already fetches, falling back to `honeypot_id` (`AttackEvent` has no name) |
| Source | `source_ip`:`source_port`, `—` when null |
| Target port | `target_port`, `—` when null |
| Occurred at | `occurred_at` (decoy observed) |
| Received at | `received_at` (center accepted) — shown separately, per `AGENTS.md` §4 |

`details` renders as labelled key/value rows (not a JSON blob). The existing
disclosure toggle and any selectors `EventsPage.test.tsx` depends on must keep
working; if a test has to change, that is a behaviour change and must be
justified in the plan, not silenced.

### `components/HoneypotDetail.tsx`

New, reached by expanding a row on `FleetPage`. Calls the already-existing
`GET /api/honeypots/{id}` on expand, with loading and error states.

Renders: name, `FleetStatusBadge` status, assigned profile (name + version),
reported `config_version`, `last_seen_at`, `created_at`.

**Drift indicator:** when `config_version < profile.version`, show
`Config outdated (agent v{config_version} of v{profile.version})`. That is the
honest, useful reading of two fields the API already returns.

## 11. Reconnect hardening — `hooks/useEventStream.ts`

### 11.1 Return shape and options

```ts
export type ConnectionStatus = "connecting" | "live" | "reconnecting"
export type GapFillState = "none" | "complete" | "capped" | "failed"

useEventStream(options?: { manageHistory?: boolean }): {
  events: AttackEvent[]
  status: ConnectionStatus
  gapFill: GapFillState
}
```

- `connected: boolean` is removed; the three states above replace it (one
  consumer, §12).
- `status` describes **the socket and nothing else**. It becomes `live` when the
  socket is open, even if a bounded gap-fill could not retrieve everything.
- `gapFill` describes **recovery completeness**, separately, so the UI cannot
  conflate "connected" with "we have every missed event" (§11.5).
- `manageHistory` defaults to `true` (`EventFeed` keeps today's behaviour). The
  overview passes `false` because it owns a windowed sample and reconciles by
  refetching it (§7.3) — the hook must not issue its own REST there, or the two
  would fetch overlapping windows and the "one merge" rule would be ambiguous.

### 11.2 Backoff with equal jitter

For attempt `n` (1-based): `base = min(1000 · 2^(n−1), 30_000)`, then
`delay = base/2 + random() · base/2`. The floor of `base/2` keeps reconnects snappy
while spreading simultaneous clients; the cap is 30s. The attempt counter resets on
a successful open. A pending timer is cancelled on dispose — no timer outlives the
hook, and a post-dispose resolution can never call `setState`.

### 11.3 Gap-fill: deterministic, offset-advanced, bounded (Correction B)

The gap is everything the socket missed while it was down. The recovery fetch must
**advance `offset` on each page** — repeating the same `since`/`limit` would return
the same first page forever.

Algorithm, run on every open when `manageHistory` is true:

1. **Anchor.** Let `anchor` = the newest held event's `occurred_at`. If no events
   are held, fetch the initial window instead (`GET /api/events?limit=<BUFFER_LIMIT>`,
   dedupe, done). Otherwise set `since = anchor − 1s`.
   *Why the overlap:* the API's `since` is inclusive and its ordering is
   `occurred_at desc, id desc`, so `since = anchor` already re-includes `anchor`
   and its same-timestamp ties. The extra second is a margin for representation
   differences between the parsed client value (ms) and the stored server value
   (µs). Over-fetching is free because step 4 dedupes by id.
2. **Page.** For `page = 0, 1, 2` (max 3 pages, unchanged budget):
   `GET /api/events?since=<since>&limit=<BUFFER_LIMIT>&offset=<page · BUFFER_LIMIT>`.
3. **Terminate** when any of:
   - a page returned fewer than `BUFFER_LIMIT` items (a short page — the end);
   - the 3-page budget is exhausted → `gapFill = "capped"`;
   - a request fails → `gapFill = "failed"`, held events preserved.
4. **Dedupe and merge without dropping.** Collect the pages into one list, then
   `setEvents(prev => cap(mergeById(prev, recovered)))` — a **functional update**,
   so events appended by the socket *during* recovery are preserved, never
   overwritten. `mergeById` dedupes across REST pages, the overlap range, and
   buffered live frames.
5. **Report.** `gapFill = "complete"` when a short page (or an empty first page)
   ended the loop; `"capped"` when the budget ran out; `"failed"` on error.
   Because ordering is newest-first, a capped recovery holds the **newest**
   `3 × 200` events — the most useful 600 — not the oldest.

**What this does not guarantee.** Offset pagination against a live table can still
miss events: concurrent inserts shift rows down between pages, so a row can move
from beyond page 1 into page 1 *after* page 1 was read. Duplicates are eliminated
by id-dedupe; **skips cannot be, with this API.** A capped or failed recovery is
therefore explicitly incomplete, and the hook says so through `gapFill` (§11.5)
rather than pretending otherwise.

### 11.4 Bounded buffer

`BUFFER_LIMIT = 200` (exported for tests), matching the API page cap so "what we
hold" agrees with "what a page can show". Applied to the history merge, the
gap-fill and live appends alike; when the bound is exceeded the **oldest** events
are dropped (the buffer keeps the newest). Trimming happens after dedupe.

### 11.5 UI behaviour for incomplete recovery

| `gapFill` | UI |
|---|---|
| `none` | nothing (overview owner, or no events held yet) |
| `complete` | nothing — the buffer spans the gap |
| `capped` | muted note: `history is partial — recovered the most recent {n} events` |
| `failed` | muted note: `history could not be recovered` |

The badge keeps reading `live` in the `capped` and `failed` rows, because the
socket *is* live; the note carries the uncertainty. On the overview, an incomplete
recovery is additionally repaired by the window refetch (§7.3), a second and
larger reconciliation path (up to 600 events over the exact interval).

`since` is derived from a **server-generated** `occurred_at`, so gap-fill is immune
to client clock skew — unlike the initial window (§15.2).

## 12. Connection badge — `components/ConnectionBadge.tsx`

Tri-state replacement for `StatusBadge`, which is deleted after `EventFeed`
migrates (it has no other consumer):

| status | label | treatment |
|---|---|---|
| `connecting` | `connecting` | slate (neutral — connecting is normal on load) |
| `live` | `live` | emerald |
| `reconnecting` | `reconnecting` | red |

`EventFeed` renders `ConnectionBadge` and passes through `status`. The spec
accepted here: on first render the badge reads `connecting`, which is a change
from today's `reconnecting`, so `EventFeed.test.tsx` must be updated to match.

`gapFill` (§11.5) renders as a separate muted note, **not** as a fourth badge
state: connection state and recovery completeness are different axes, and a
connected socket does not imply a complete history.

## 13. Shared UI primitives — `components/ui/`

Extract the classes currently copy-pasted across the five pages into small
components: `Panel` (bordered section + title), table primitives (`Table`,
`Th`, `Td`), `Button`, `EmptyState`, `ErrorState`, `LoadingText`.

Adopted by **all five existing pages** plus the overview — that adoption is what
makes this a consistency pass rather than a new page that matches nothing.

**Hard guardrail:** rendered text and ARIA roles must not change. The existing 34
tests are the check; the only permitted test edits are the three touch points in
§5 and §12. If another test moves, the change is behavioural and must be
reverted or explicitly justified.

## 14. Testing plan

### Unit — `lib/stats.ts` (window, buckets, disclosure — Correction A)

- **Boundaries:** an event exactly at `window.start` is included; an event exactly
  at `window.end` is **excluded**; one millisecond inside each boundary behaves
  correctly; an event before `start` and a future-dated event at/after `end` are
  both excluded.
- **Invariant:** `inWindow.length + older + newer + unparseable === total input`,
  for mixed input including a null/unparseable `occurred_at` (counted as
  `unparseable`, never dropped).
- **Bucket tiling:** exactly 24 buckets; `buckets[0].startIso === window.startIso`;
  `buckets[23].endIso === window.endIso`; consecutive buckets are contiguous
  (`buckets[i].endIso === buckets[i+1].startIso`); bucket counts sum to
  `inWindow.length`.
- **Partial edge buckets:** an event in the first bucket and an event in the last
  bucket (just before `end`) both bucket correctly; the zero case is valid.
- **One window everywhere:** the KPI count equals the sum of the bucket counts,
  proving the chart and the KPI share a window.
- `mergeById`: union by id; later source wins on collision; ordering is
  `occurred_at desc, id desc` including same-`occurred_at` ties.
- `topBy`: deterministic order on a count tie; null keys become `unknown`.
- `fleetCounts`: each of online/offline/never.
- `distinctSourceCount`: null sources counted as `unattributed`, not as a source.
- `windowDisclosure`: both wordings, verbatim; `truncated` is
  `sampleFetched < serverTotal`; the untruncated wording uses the merged in-window
  count.

### Unit — `useEventStream` with fake timers (Correction B)

- **Jitter bounds:** every scheduled delay lies in `[base/2, base]`; capped at 30s;
  the counter resets after an open.
- **Offset advances:** with three full pages then a short page, the requests are
  `offset=0, 200, 400` (plus a fourth at `offset=600`); **no two requests are
  identical** — this is the regression the old spec would have produced.
- **Anchor:** the first recovery request's `since` is the newest held
  `occurred_at` minus one second.
- **Dedupe:** ids repeated across REST pages, the 1-second overlap, and live frames
  collapse to one entry; two events sharing the same `occurred_at` are both kept
  (dedupe is by id, not timestamp).
- **Short page stops:** recovery ends on the first page shorter than the limit and
  `gapFill === "complete"`.
- **Cap:** after 3 full pages recovery stops with `gapFill === "capped"`, and the
  note from §11.5 is rendered; the hook never claims completeness.
- **Failure preserves state:** a rejected recovery request leaves previously held
  events intact and sets `gapFill === "failed"`.
- **No drop during recovery:** a live frame arriving between page 0 and page 1 is
  still present after the merge.
- **Buffer cap:** the 201st insert drops the oldest; length ≤ `BUFFER_LIMIT`.
- **Dispose:** unmounting cancels the reconnect timer, and no post-dispose
  resolution mutates state (no act warning).
- **Status transitions:** `connecting → live`; `live → reconnecting` on close;
  `reconnecting → live` on reopen.

### Unit/component — `useOverviewData` (Correction C)

- A live event arriving **before** the initial REST response resolves is present in
  the derived counts once the response lands.
- A live event arriving **while** a REST request is in flight survives the response
  (the response replaces only `sample`).
- A REST response containing ids already received over the socket does not
  duplicate them in the KPIs.
- A **stale** response (older request id) resolving after a newer one does not
  overwrite the newer sample.
- A recovery refetch overlapping live events produces correct KPI/chart values.
- The derived input stays bounded: ≤ 600 sample + ≤ 200 live.

### Component — partial failure (Correction D)

- Fleet request fails, events succeed → the fleet block shows an error while the
  events KPIs, chart and top lists still render.
- Events request fails, fleet succeeds → the event blocks show errors while the
  fleet KPI still renders.
- Both fail → two independent error states; **no block renders a misleading `0`**.
- Successful-but-empty responses → "no events in the last 24h", and the fleet
  block's four zeros are valid.
- Loading states render a placeholder — not `0` and not an error.

### Component — the rest

- `OverviewPage`: KPIs render from a stubbed window; the truncated disclosure
  appears when the sample is capped; **a pushed live event increments the count
  with no refresh** (the Phase 4 exit criteria, as a test).
- `EventsOverTimeChart`: 24 bars; the `max === 0` case; the `aria-label` contains
  the disclosure text; no axis label claims `HH:00`.
- `EventDetail`: renders both timestamps distinctly; `details` as key/values.
- `HoneypotDetail`: drift shown when `config_version < profile.version`, absent
  when equal; error state when the fetch fails.
- `ConnectionBadge`: all three labels; the `capped`/`failed` gap-fill note renders
  beside it without changing the badge.
- `LoginPage` / `App`: post-login lands on `/`; `*` redirects to `/`.

**Regression.** Nothing else may move: frontend 34 (plus the new tests), backend
76, agent 22, medium 24, low 2.

**Commands**

```
cd frontend && npx tsc -b
cd frontend && npx vitest run
cd frontend && npx vite build
docker compose up -d --build && docker compose ps
```

**Live walkthrough.** Compose stack up → `/` serves the overview → sign in and
land on it → a real decoy connection moves the KPIs and the chart without a
refresh → a reconnecting badge is observable when the backend is stopped and
recovers when it returns. Extended: stop the backend long enough to exceed the
3-page recovery budget, restart it, and confirm the partial-recovery note appears
while the badge returns to `live`.

## 15. Risks and documented limits

1. **The overview is a bounded sample, not a dataset.** It reads at most the most
   recent 600 events of the window and states its basis in the disclosure. The
   disclosure's denominator (`serverTotal`) is the server's count at fetch time;
   live events received afterwards are added to the numerator, so the ratio can
   only *understate* the sample. It never claims completeness.
2. **The window is computed from the browser clock** — both the request and each
   derivation pass. A skewed client clock shifts the window. Gap-fill does not
   share this weakness: it uses a server-generated `occurred_at`. Server-side
   aggregation would remove it and is deferred with the endpoint.
3. **Offset pagination can skip events under concurrent inserts.** A row can shift
   between pages while a multi-page recovery is in flight. Duplicates are removed
   by id-dedupe; skips cannot be, with this API. Mitigations: newest-first ordering
   means a capped recovery keeps the newest events, and the overview's window
   refetch is a second reconciliation path.
4. **Bounded recovery does not guarantee completeness.** The 3-page cap bounds
   effort; `gapFill` reports `capped`/`failed` rather than claiming success, and
   §11.5 renders that honestly.
5. **Aggregates go stale while the socket is down.** The badge says
   `reconnecting`, the window refetches on recovery, and `gapFill` may report a
   partial recovery — but there is no polling fallback.
6. **The window advances only on a derivation pass** (a live event or a refetch).
   With no live traffic and a healthy socket, "the last 24h" does not creep
   forward second by second; it is exact as of the last pass. A consequence of not
   polling.
7. **Hourly resolution only**, in 24 window-anchored buckets whose first and last
   are partial wall-clock hours (§6.2). Sub-hour spikes are not representable.
8. **The chart is not interactive** beyond a `<title>` per bar.
9. **Fleet online/offline inherits S4's derived-at-read boundary** (45s / 3×
   heartbeat). The overview does not make it any fresher.
10. **`serverTotal` uses the API's inclusive `until`** while the client interval is
    half-open. The discrepancy is at most the events exactly at `end` — a single
    instant — and is documented rather than papered over.

## 16. Exit criteria and gate

- **Runnable** — `/` serves the overview from a clean Compose startup.
- **Verifiable** — the tests in §14 pass; `tsc -b`, `vitest run`, `vite build`
  are clean; the live walkthrough is reproducible.
- **Demoable** — a decoy interaction visibly moves the overview without a
  refresh, and that moment is asserted by a test, not by luck.
- **Fresh review** at slice end over the slice's commit range, as with S4, with
  Critical/Important findings fixed before the slice is called done.

Nothing in this slice is done until it is implemented, tested, and observable.
