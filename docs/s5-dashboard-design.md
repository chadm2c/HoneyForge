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
  `occurred_at desc, id desc` (`app/services/event_service.py`).
- `Honeypot` carries `profile.version` **and** `config_version`, so config drift
  is computable from data the UI already receives.

## 3. Scope

**In scope**

- Overview page at `/`: fleet counts, events in window, distinct sources, top
  event types, top targeted ports, and one events-per-hour chart.
- Client-side aggregation layer with an explicit, testable honesty label.
- In-place detail panels: structured event detail on `EventsPage`; honeypot
  detail on `FleetPage` via the existing `GET /api/honeypots/{id}`.
- WebSocket hardening: jitter, bounded buffer, exact gap-fill, tri-state status.
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
| Reconnect | Harden the existing hook (jitter, cap, exact gap-fill, tri-state) |
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

## 6. Aggregation layer — `lib/stats.ts`

Pure functions only: **no React, no fetch, no `Date.now()` inside the module**.
`now` is injected so every case is unit-testable without fake timers.

```ts
export interface HourBucket { startIso: string; count: number }
export interface Ranked { key: string; count: number }
export interface FleetCounts { total: number; online: number; offline: number; never: number }
export interface WindowDisclosure { text: string; truncated: boolean }
```

- `fleetCounts(honeypots): FleetCounts` — counts by the derived `status`.
- `bucketByHour(events, now, hours = 24): { buckets: HourBucket[]; outsideWindow: number }`
  — exactly 24 buckets, oldest first. Bucket `i` (0-based) starts at
  `floorToHourUtc(now) - (hours - 1 - i)` hours. An event is in-window when
  `buckets[0].start ≤ occurred_at < buckets[0].start + hours`. Everything else
  — including unparseable `occurred_at` — is excluded and returned as
  `outsideWindow`, never silently dropped.
- `topBy(events, key, n = 3): Ranked[]` — `key` selects `event_type` or
  `target_port`. Null/undefined keys become `"unknown"`. Tie-break is
  deterministic: count desc, then key asc, so tests do not flake.
- `distinctSourceCount(events): { distinct: number; unattributed: number }` —
  distinct non-null `source_ip`, plus a count of events with no source so the UI
  can be honest about incompleteness.
- `windowDisclosure(fetched, total): WindowDisclosure` — the two **verbatim**
  wordings, so the label can never drift from the arithmetic. The window length
  is fixed at 24h for this slice and is therefore hardcoded in the strings
  rather than passed in:

  - fully read → `All {fetched} events in the last 24h`
  - truncated → `Most recent {fetched} of {total} events in the last 24h`

All internal time math is UTC. `lib/stats.ts` is the *only* place these numbers
are computed, so the page and the chart cannot disagree.

## 7. Overview data hook — `hooks/useOverviewData.ts`

**Fetch plan** (bounded, and reported):

1. `GET /api/honeypots` — once.
2. `GET /api/events?since=<now − 24h>&limit=<PAGE_SIZE>&offset=…` — paged per the
   constants below, stopping early when a page returns fewer than `PAGE_SIZE`
   items or the fetched count reaches `total`.

600 is a deliberate ceiling: big enough that a demo's whole event history fits,
small enough to stay one bounded burst of requests. The page cap is why the
disclosure label exists at all.

**Constants.** `PAGE_SIZE = 200`, `WINDOW_MAX_PAGES = 3` (600 events) for the
initial window fetch; the gap-fill cap in §11 is the same 3 pages.

**Derivation.** All from `lib/stats.ts` over the fetched window, plus live events.

**Live merge.** Subscribe to the hardened `useEventStream`. Live events whose
`occurred_at` falls in the window are folded into the same aggregation, deduped
by id against the fetched set. The aggregation input is therefore bounded by
construction: the fetched window (≤600) plus the hook's live buffer (≤200, §11).
A live event moves the KPIs and the chart **without a refresh** — the Phase 4
exit criteria.

**Recovery refetch.** When the stream transitions `reconnecting → live`, refetch
the window. While the socket is down the aggregates are only as fresh as the
last fetch, and the page says so via the badge (§12).

**Errors.** Partial failure is allowed and reported: a failed honeypots fetch
blanks only the fleet block, a failed events fetch blanks only the
KPI/chart block. **A block that failed renders an error state, never a zero.**

**Return.** `{ kpis, buckets, outsideWindow, disclosure, loading, error, status }`.

## 8. Overview page — `pages/OverviewPage.tsx`

Layout, top to bottom:

1. Connection badge (§12) and the window disclosure line.
2. KPI row: fleet total + online/offline/never; events in window; distinct
   source IPs, with a muted `(N unattributed)` note when any event has no source.
3. Chart panel (§9).
4. Top event types panel (top 3, with counts).
5. Top targeted ports panel (top 3, with counts).

Each panel has its own loading, empty ("no events in the last 24h"), and error
state. Accessibility: the chart is `role="img"` with an `aria-label` that
carries the disclosure text; no KPI is communicated by colour alone.

## 9. Chart — `components/EventsOverTimeChart.tsx`

Props: `{ buckets: HourBucket[]; disclosure: WindowDisclosure }`.

- Inline SVG, fixed `viewBox="0 0 480 120"`, `className="h-32 w-full"`.
- 24 bars, oldest left. The y-scale is `max(count)`, with an explicit
  `max === 0` case rendering a flat baseline plus a "no events" label rather
  than dividing by zero.
- Axis text kept minimal: the max value on the y-axis, first/last hour labels on
  the x-axis only.
- Each bar carries a `<title>` of `HH:00 — N events`.
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

Returns `{ events, status }` where
`status: "connecting" | "live" | "reconnecting"`. `connected: boolean` is
removed (one consumer, §12).

- **Backoff with equal jitter.** For attempt `n` (1-based):
  `base = min(1000 * 2 ** (n - 1), 30_000)`, then
  `delay = base / 2 + random() * (base / 2)`. A floor of `base / 2` keeps
  reconnects snappy while spreading simultaneous clients. The attempt counter
  resets on a successful open.
- **Bounded buffer.** `BUFFER_LIMIT = 200` (exported for tests), matching the
  API's page cap so "what we hold" agrees with "what a page can show". Applied
  to both the history merge and live appends; the oldest events are dropped.
- **Exact gap-fill.** On open, when events are already held, request
  `GET /api/events?since=<newest held occurred_at − 1s>&limit=200`, repeating
  while a full page returns, **max 3 pages**. When nothing is held, fall back to
  the initial window fetch. The 1-second overlap is absorbed by existing id
  dedupe, which is documented in the code.
- `since` is derived from a **server-generated** `occurred_at`, not the browser
  clock, so gap-fill is immune to client clock skew.
- A pending reconnect timer is cancelled on dispose; no timer outlives the hook.

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

**Unit — `lib/stats.test.ts`**

- `bucketByHour`: exactly 24 buckets; an event exactly on the oldest boundary is
  inside; one second earlier is outside (`outsideWindow`); a future-dated event
  is outside; unparseable `occurred_at` counts as outside, not dropped.
- `topBy`: deterministic order on a count tie; null keys become `unknown`.
- `fleetCounts`: each of online/offline/never.
- `distinctSourceCount`: null sources counted as unattributed, not as a source.
- `windowDisclosure`: both wordings, verbatim, chosen by `fetched < total`.

**Unit — `useEventStream` with fake timers**

- Jitter bounds: every scheduled delay lies in `[base / 2, base]`; capped at 30s.
- Cap: inserting past `BUFFER_LIMIT` drops the oldest and keeps length ≤ limit.
- Gap-fill: the reconnect request URL carries a `since` equal to the newest held
  `occurred_at` minus one second.
- Dispose: no pending timer remains after unmount.
- Status transitions: `connecting → live`, and `live → reconnecting` on close.

**Component**

- `OverviewPage`: KPIs render from a stubbed window; the truncated disclosure
  appears when `total` exceeds the cap; **a pushed live event increments the
  count with no refresh** (the Phase 4 exit criteria, as a test); each error
  state renders instead of a zero.
- `EventsOverTimeChart`: 24 bars; the `max === 0` case; the `aria-label`
  contains the disclosure text.
- `EventDetail`: renders both timestamps distinctly; `details` as key/values.
- `HoneypotDetail`: drift shown when `config_version < profile.version`, absent
  when equal; error state when the fetch fails.
- `ConnectionBadge`: all three labels.
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
recovers when it returns.

## 15. Risks and documented limits

1. **Client-side aggregation is not a reporting engine.** It reads at most the
   most recent 600 events of the 24h window and says so in the disclosure. Early
   in a busy fleet the numbers are a floor on the window, not a total.
2. **The 24h window is computed from the browser clock.** A skewed client clock
   shifts the window it requests. Gap-fill does not share this weakness because
   it uses a server-generated timestamp. Server-side aggregation would remove it
   and is deferred with the endpoint.
3. **Aggregates go stale while the socket is down.** The badge says
   `reconnecting` and the window refetches on recovery, but there is no polling
   fallback.
4. **Hourly resolution only.** Counts are bucketed per hour; sub-hour spikes are
   not representable.
5. **The chart is not interactive** beyond a `<title>` per bar.
6. **Fleet online/offline inherits S4's derived-at-read boundary** (45s / 3×
   heartbeat). The overview does not make it any fresher.
7. **No new backend surface means no server-side aggregation.** The cap in §7 is
   a UI decision: raising it changes how much is fetched and what the label
   reports, but not correctness, because the label always states its own basis.

## 16. Exit criteria and gate

- **Runnable** — `/` serves the overview from a clean Compose startup.
- **Verifiable** — the tests in §14 pass; `tsc -b`, `vitest run`, `vite build`
  are clean; the live walkthrough is reproducible.
- **Demoable** — a decoy interaction visibly moves the overview without a
  refresh, and that moment is asserted by a test, not by luck.
- **Fresh review** at slice end over the slice's commit range, as with S4, with
  Critical/Important findings fixed before the slice is called done.

Nothing in this slice is done until it is implemented, tested, and observable.
