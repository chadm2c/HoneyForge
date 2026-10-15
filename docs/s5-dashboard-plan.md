# S5 Dashboard Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the honeyforge dashboard: a client-side overview page with one hand-rolled SVG chart, structured event/honeypot detail panels, a hardened WebSocket hook (jitter, bounded buffer, checkpoint-anchored gap-fill, tri-state status), and a bounded theme-consistency pass — all frontend-only.

**Architecture:** A pure aggregation layer (`src/lib/stats.ts`) derives every overview number from one half-open 24h window and one `mergeById` of a bounded REST sample (≤600) plus the hook's bounded live buffer (≤200). `useEventStream` gains a disconnection checkpoint, a single bounded recovery request and a tri-state connection status; `useOverviewData` owns the windowed sample and reconciles it race-safely. Existing routes/pages are preserved; `/` becomes the overview.

**Tech Stack:** React 19 + TypeScript (strict) + Vite 6 + Tailwind 4 + react-router-dom 7; vitest 2 + @testing-library/react in jsdom. No new runtime dependencies.

**Spec:** `docs/s5-dashboard-design.md` (the plan is subordinate to it; when they disagree, the spec wins)

## Global Constraints

- **Frontend-only.** No new backend endpoint, no schema change, no migration, no backend edit. `GET /api/honeypots/{id}` already exists and is the only "new" call.
- **No new dependencies.** Runtime deps stay exactly `react`, `react-dom`, `react-router-dom`. The chart is inline SVG.
- **No new routes** beyond `/`. No `/events/:id`, no `/fleet/:id`, no deep links.
- All timestamps UTC. `occurred_at` (decoy observed) and `received_at` (center accepted) are shown separately and never conflated.
- One reporting interval everywhere: half-open `[start, end)`, `end = now` captured **once per derivation pass**, `start = end − 24h`. **No `Date.now()` inside `src/lib/stats.ts`** — `now` is injected.
- Chart buckets: **exactly 24**, window-anchored (`bucket[i] = [start + i·1h, start + (i+1)·1h)`), tiling the window with no gap/overlap. Never fabricate `HH:00`.
- Constants: `BUFFER_LIMIT = 200`, `PAGE_SIZE = 200`, `WINDOW_MAX_PAGES = 3`.
- Hook gap-fill: **one** request, `since = checkpoint − 1s`, `limit = BUFFER_LIMIT`, `offset = 0`. Never an `offset=200/400/600` request.
- Overview reconciliation: **at most 3 requests**, offsets `0, 200, 400`, ≤600 events, **never a fourth**.
- **Theme pass guardrail:** rendered text and ARIA roles must not change. The only permitted pre-existing-test edits are the touch points listed in `docs/s5-dashboard-design.md` §5, §10 and §12.
- No decorative animation. Dark security-ops theme; restrained cyan accents.
- Test data uses reserved documentation IPs only (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`).
- Windows host + PowerShell: chain commands with `;`, **never** `&&`. Frontend commands run from `frontend/`.
- Existing suites stay green: frontend 34 tests / 10 files, backend 77, agent 22, medium 24, low 2.

## Spec tensions resolved before implementation

Three points in the approved spec are internally under-determined. Each is resolved below in favour of the requirement `docs/s5-dashboard-design.md` states as a hard rule; no new capability is added.

1. **`Overview.fleet` cannot carry a fleet success while the events request fails.** §7.6 says `overview` is `null` iff the events request failed, and §7.1 says `Overview.fleet` is `null` iff the honeypots request failed — so when events fail but honeypots succeed, the fleet counts are unreachable and Correction D ("every section states its own success/loading/error") breaks. **Resolution:** `useOverviewData` returns `fleetCounts: FleetCounts | null` at top level as well (null iff the honeypots request failed). `Overview.fleet` stays exactly as specified; both are produced by the same pure `fleetCounts()` call on the same input, so they cannot drift. The page's fleet block reads `fleetCounts`.
2. **`EventsPage.test.tsx`'s details assertion pins the JSON dump.** §10 deliberately replaces `JSON.stringify(details)` with labelled rows, so the assertion `findByText(/"username"/)` must change to the labelled form. §10 permits this explicitly ("if a test has to change, that is a behaviour change and must be justified in the plan"). It is **Task 3**'s, not the theme pass's.
3. **The gap-fill note's `{n}`.** §11.5's wording is `history is partial — recovered the most recent {n} events`. The hook's return shape is fixed at `{ events, status, gapFill }`, so `n` is `events.length` — the number of events the feed now holds (after a capped recovery that is the newest ≤200). Documented in Task 6.

## Review Focus

The spec implies these; no task's happy path exercises them. Each is pinned to a test in the task that owns the code, most likely to bite first:

1. **An event whose `occurred_at` is missing or unparseable** — must be counted in `outside.unparseable` and excluded from the KPIs, the chart and the top lists, never dropped and never bucketed into the newest bar (Task 1).
2. **A WebSocket frame that is malformed JSON, or a JSON object with no `id`** — must be ignored without throwing, without breaking the stream, and without changing `status` (Task 6).
3. **Exactly `BUFFER_LIMIT` missed events across a disconnect** — must report `complete`, not `capped`. A false "history is partial" claim is as harmful as a false "complete" one (Task 6).
4. **A reconnect that fires while a recovery fetch is still in flight** — must not double-apply rows, drop live frames, or leave `gapFill`/`recovery` stuck on an earlier value (Tasks 6 and 8).
5. **A `details` map containing a nested object, an array or `null`** — the detail panel must render a readable row and must not throw (Task 3).

Also pinned in the owning task: the window is exactly 24h of UTC across a DST transition, because `makeWindow`/`partitionByWindow` use only epoch arithmetic and never local time (Task 1).

---

### Task 1: Pure aggregation layer — `src/lib/stats.ts`

**Files:**
- Create: `frontend/src/lib/stats.ts`
- Test: `frontend/src/lib/stats.test.ts`

**Interfaces:**
- Consumes: `AttackEvent`, `Honeypot` from `../api/types`.
- Produces (all pure, all exported):
  - `interface Window { startIso: string; endIso: string }`
  - `makeWindow(endMs: number): Window` — `start = end − 24h`
  - `interface HourBucket { startIso: string; endIso: string; count: number }`
  - `interface Ranked { key: string; count: number }`
  - `interface FleetCounts { total: number; online: number; offline: number; never: number }`
  - `interface WindowDisclosure { text: string; truncated: boolean }`
  - `interface Partition { inWindow: AttackEvent[]; older: number; newer: number; unparseable: number }`
  - `interface Overview { fleet: FleetCounts | null; inWindowCount: number; buckets: HourBucket[]; distinctSources: number; unattributed: number; topTypes: Ranked[]; topPorts: Ranked[]; disclosure: WindowDisclosure; outside: { older: number; newer: number; unparseable: number } }`
  - `mergeById(a: AttackEvent[], b: AttackEvent[]): AttackEvent[]`
  - `partitionByWindow(events: AttackEvent[], window: Window): Partition`
  - `bucketByHour(inWindow: AttackEvent[], window: Window): HourBucket[]`
  - `topBy(inWindow: AttackEvent[], key: "event_type" | "target_port", n?: number): Ranked[]` (`n` defaults to 3)
  - `distinctSourceCount(inWindow: AttackEvent[]): { distinct: number; unattributed: number }`
  - `fleetCounts(honeypots: Honeypot[]): FleetCounts`
  - `windowDisclosure(input: { count: number; sampleFetched: number; serverTotal: number }): WindowDisclosure`
  - `deriveOverview(input: { sample: AttackEvent[]; live: AttackEvent[]; window: Window; honeypots: Honeypot[] | null; serverTotal: number }): Overview`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/stats.test.ts`. Cover, verbatim from the spec §14:

```ts
// boundaries: exactly at start = included; exactly at end = excluded; ±1ms correct
// invariant: inWindow.length + older + newer + unparseable === input.length
// buckets: exactly 24; buckets[0].startIso === window.startIso;
//          buckets[23].endIso === window.endIso;
//          buckets[i].endIso === buckets[i+1].startIso; counts sum to inWindow.length
// edges: an event in the first and in the last (just before end) bucket both land correctly
// one window: KPI count === sum of bucket counts
// mergeById: union by id; later source wins; ordering occurred_at desc, id desc incl. ties
// topBy: deterministic order on a count tie; null keys become "unknown"
// fleetCounts: each of online/offline/never
// distinctSourceCount: null sources count as unattributed, not as a source
// windowDisclosure: both wordings verbatim; truncated === sampleFetched < serverTotal
```

Plus the two Review Focus pins: an event with `occurred_at: "not-a-date"` (and one with `occurred_at: ""`) counts in `unparseable` and appears in no bucket; `makeWindow` straddling a DST transition (build `endMs` from `Date.UTC(...)` values around a US spring-forward date) still yields `endMs − startMs === 24 * 3600 * 1000`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend; npx vitest run src/lib/stats.test.ts`
Expected: FAIL — `Failed to resolve import "./stats"`.

- [ ] **Step 3: Implement `src/lib/stats.ts`**

Key decisions to encode:
- `parseMs(value)` returns `number | null`; anything `Number.isNaN` is `null`. All boundary tests use it, so an unusable timestamp can never be silently bucketed.
- `mergeById`: `Map` keyed by `id`; scan `a` then `b` so `b` wins on collision; return sorted by `Date.parse(occurred_at)` desc, tie-broken by `id` desc. Events with unparseable timestamps sort last, tie-broken by `id` desc (stable, deterministic).
- `partitionByWindow`: one pass, `occurred_at < start` → `older`, `>= end` → `newer`, parse failure → `unparseable`, else `inWindow`.
- `bucketByHour`: index `Math.min(23, Math.max(0, Math.floor((ms − start) / 3_600_000)))`; every bucket gets `startIso = new Date(start + i·3600000).toISOString()` and `endIso = new Date(start + (i+1)·3600000).toISOString()`.
- `topBy`: count by `key === "target_port" ? String(v ?? "unknown") : (v ?? "unknown")`, then sort count desc / key asc, then slice `n`.
- `deriveOverview`: `mergeById(sample, live)` → `partitionByWindow` → derive everything from that one partition; `fleet = honeypots === null ? null : fleetCounts(honeypots)`; `disclosure = windowDisclosure({ count: inWindow.length, sampleFetched: sample.length, serverTotal })`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend; npx vitest run src/lib/stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `cd frontend; npx tsc -b`
Expected: no output (clean). `tsconfig.tsbuildinfo` is gitignored.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/stats.ts frontend/src/lib/stats.test.ts
git commit -m "feat(s5): pure aggregation layer for the overview"
```

---

### Task 2: Shared UI primitives — `src/components/ui/`

**Files:**
- Create: `frontend/src/components/ui/Panel.tsx`, `Table.tsx`, `Button.tsx`, `EmptyState.tsx`, `LoadingText.tsx`, `ErrorState.tsx`
- Test: `frontend/src/components/ui/ui.test.tsx`
- Modify: `frontend/src/pages/FleetPage.tsx`, `ProfilesPage.tsx`, `EventsPage.tsx`, `AuditPage.tsx`, `LoginPage.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Panel({ title?: ReactNode; className?: string; children })` → `<div className={"rounded border border-slate-800 bg-slate-900 p-4 " + (className ?? "")}>` with an `<h3 className="text-xs font-semibold tracking-wide text-cyan-300">` only when `title` is set.
  - `Table({ children })` → `<table className="w-full border-collapse text-left text-sm">`
  - `Th({ children })` → `<th className="py-2 pr-4 text-xs font-medium uppercase tracking-wide text-slate-500">`
  - `Td({ colSpan?: number; className?: string; children })` → `<td className={"border-t border-slate-900 py-2 pr-4 " + (className ?? "")}>`
  - `Button({ variant?: "primary" | "secondary" | "danger"; className?: string } & ButtonHTMLAttributes)` — `primary` = the cyan filled style, `secondary` = the `border-slate-700` outline, `danger` = the `border-red-800` outline. Never destructure away `type` or `disabled`.
  - `EmptyState({ children, className? })` → `<p className={"text-sm text-slate-500 " + (className ?? "")}>`
  - `LoadingText({ children, className? })` → `EmptyState` with `children` defaulting to `"Loading…"`
  - `ErrorState({ children, className? })` → `<p role="alert" className={"text-xs text-red-400 " + (className ?? "")}>`

- [ ] **Step 1: Write the failing primitive tests**

Create `ui.test.tsx`: `ErrorState` renders `role="alert"` with its message; `Button` with `variant="primary"` renders a `button` and forwards `disabled`; `LoadingText` with no children renders exactly `Loading…`; `Panel` with no `title` renders no heading and with a title renders that exact text; `Table`/`Th`/`Td` render `table`/`columnheader`/`cell` roles.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend; npx vitest run src/components/ui/ui.test.tsx`
Expected: FAIL — `Failed to resolve import "./Button"` (etc.).

- [ ] **Step 3: Implement the six components**

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend; npx vitest run src/components/ui/ui.test.tsx`
Expected: PASS.

- [ ] **Step 5: Adopt in `FleetPage.tsx`**

Replace the local `TH`/`TD` consts and `<table>`/`<th>`/`<td>` with `Table`/`Th`/`Td`; the loading/empty `<p>` with `LoadingText`/`EmptyState`; the `role="alert"` `<p>` with `ErrorState`; the register container `<div>` + `<h3>` with `<Panel title="Register honeypot">`; the submit and Copy buttons with `Button variant="primary"` / `variant="secondary"`. Text and roles must be byte-identical (`"Register honeypot"`, `"Registering…"`, `"Register"`, `"Copy"`, `"loading"`…).
Run: `cd frontend; npx vitest run src/pages/FleetPage.test.tsx` → PASS (unchanged).

- [ ] **Step 6: Adopt in `ProfilesPage.tsx`**

`Table`/`Th`/`Td`; `ErrorState`; `LoadingText`/`EmptyState`; the "New profile" button, Save and Cancel as `Button`; Edit/Delete/Confirm delete/Cancel row actions as `Button variant="secondary" | "danger"`; wrap the create/edit `<form>` in a `Panel` whose `title` is the existing `editingId ? "Edit profile" : "New profile"` heading. Text unchanged (`"New profile"`, `"Edit profile"`, `"Save"`, `"Saving…"`, `"Cancel"`, `"Edit"`, `"Delete"`, `"Confirm delete"`, `"No profiles defined yet."`).
Run: `cd frontend; npx vitest run src/pages/ProfilesPage.test.tsx` → PASS (unchanged).

- [ ] **Step 7: Adopt in `EventsPage.tsx`**

`Table`/`Th`/`Td`; the filter bar container becomes `<Panel className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">` (no title); `ErrorState`; the Details/Hide and Previous/Next buttons become `Button variant="secondary"`. **Leave the in-cell `Loading…` / `"No events match these filters."` `<td>` as it is** — it is a table cell, not a paragraph, and changing its element would change the table's role structure.
Run: `cd frontend; npx vitest run src/pages/EventsPage.test.tsx` → PASS (unchanged).

- [ ] **Step 8: Adopt in `AuditPage.tsx`**

Same as Step 7 (filter bar `Panel`, `ErrorState`, `Table`/`Th`/`Td`, pagination `Button`), leaving the in-cell loading/empty `<td>` untouched.

Note: `renderWithProviders` points every request at `{ items: [], total: 0 }` by default, so the `"Showing …"` / `"No audit entries"` branches are what the existing tests exercise — keep those strings exact.
Run: `cd frontend; npx vitest run src/pages/AuditPage.test.tsx` → PASS (unchanged).

- [ ] **Step 9: Adopt in `LoginPage.tsx`**

Wrap the `<form>` in `<Panel className="w-full max-w-sm p-6">`; `ErrorState` with `className="mt-4"`; the submit button becomes `Button variant="primary" className="mt-6 w-full"`. Keep `"HoneyForge"`, `"Centralized honeypot control plane"`, `"Username"`, `"Password"`, `"Sign in"`, `"Signing in…"` exact.
Run: `cd frontend; npx vitest run src/pages/LoginPage.test.tsx` → PASS (unchanged).

- [ ] **Step 10: Full guardrail check**

Run: `cd frontend; npx vitest run`
Expected: **34 passed** (10 files) plus the new `ui.test.tsx` — no pre-existing test edited.
Run: `cd frontend; npx tsc -b` → clean.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/ui frontend/src/pages
git commit -m "refactor(s5): shared UI primitives, adopted across the five pages"
```

---

### Task 3: `EventDetail` panel on `EventsPage`

**Files:**
- Create: `frontend/src/components/EventDetail.tsx`
- Test: `frontend/src/components/EventDetail.test.tsx`
- Modify: `frontend/src/pages/EventsPage.tsx`, `frontend/src/pages/EventsPage.test.tsx`

**Interfaces:**
- Consumes: `AttackEvent` from `../api/types`; `Panel` from `./ui/Panel`.
- Produces: `EventDetail({ event: AttackEvent; honeypotName?: string })`.

- [ ] **Step 1: Write the failing component test**

Assert: both `Occurred at` and `Received at` labels render with their own distinct ISO values; `details` renders as labelled rows (`username` → `admin`); `null` `source_ip`/`target_port` render `—`; a `details` map whose value is an object, an array and `null` renders without throwing (Review Focus 5) — a non-primitive value is rendered with `JSON.stringify(value)`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend; npx vitest run src/components/EventDetail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `EventDetail.tsx`**

Rows, in this order: `Type`, `Protocol`, `Honeypot` (`honeypotName ?? event.honeypot_id`), `Source` (`source_ip`:`source_port`, `—` when the IP is null), `Target port`, `Occurred at`, `Received at`. Then a `Details` sub-block listing `Object.entries(event.details)` as labelled rows; render a primitive with `String(v)`, and everything else with `JSON.stringify(v)`. When `details` is empty, render nothing extra.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend; npx vitest run src/components/EventDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire it into `EventsPage.tsx`**

Replace the `rows.filter(...).map(... <pre>JSON.stringify(e.details)</pre>)` block with `<EventDetail event={e} honeypotName={honeypotName(e.honeypot_id)} />` (the page already holds the honeypot list and its `honeypotName` helper). Keep the toggle button and its `Details`/`Hide` text.

- [ ] **Step 6: Update the one justified assertion in `EventsPage.test.tsx`**

The `reveals a row's details only when asked` test currently asserts `findByText(/"username"/)` — the JSON dump. Change it to assert the labelled row: `findByText("Occurred at")` and `findByText("admin")`. This is §10's explicitly sanctioned behaviour change (**not** a theme-pass edit). No other assertion in that file moves.

- [ ] **Step 7: Run the tests**

Run: `cd frontend; npx vitest run src/pages/EventsPage.test.tsx src/components/EventDetail.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/EventDetail.tsx frontend/src/components/EventDetail.test.tsx frontend/src/pages/EventsPage.tsx frontend/src/pages/EventsPage.test.tsx
git commit -m "feat(s5): structured event detail panel replaces the JSON dump"
```

---

### Task 4: `HoneypotDetail` panel on `FleetPage`

**Files:**
- Modify: `frontend/src/api/client.ts` (add `getHoneypot`)
- Create: `frontend/src/components/HoneypotDetail.tsx`
- Test: `frontend/src/components/HoneypotDetail.test.tsx`
- Modify: `frontend/src/pages/FleetPage.tsx`, `frontend/src/pages/FleetPage.test.tsx`

**Interfaces:**
- Consumes: `Honeypot` from `../api/types`; `apiJson` from `../api/client`; `Panel`, `LoadingText`, `ErrorState`, `Button`.
- Produces:
  - `getHoneypot(id: string): Promise<Honeypot>` in `client.ts` — `apiJson<Honeypot>("/api/honeypots/" + id)`. The response is the same `HoneypotOut` shape as the list, so no new type.
  - `HoneypotDetail({ honeypotId: string })` — fetches on mount, then renders name, `FleetStatusBadge` status, assigned profile (name + version), reported `config_version`, `last_seen_at`, `created_at`.

- [ ] **Step 1: Write the failing test**

Assert: a successful fetch renders the fields above; the drift indicator `Config outdated (agent v{config_version} of v{profile.version})` appears when `config_version < profile.version` and is absent when equal; a rejected fetch renders an error (`role="alert"`) and no fields.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend; npx vitest run src/components/HoneypotDetail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `getHoneypot` and implement `HoneypotDetail.tsx`**

Fetch in a `useEffect` with a `cancelled` flag; three states (loading / error / loaded) using `LoadingText` / `ErrorState` / the field grid. Drift indicator only when `config_version < profile.version`.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend; npx vitest run src/components/HoneypotDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire it into `FleetPage.tsx`**

Add a trailing `Details`/`Hide` toggle column (mirroring `EventsPage`'s pattern) and render `HoneypotDetail` in a full-width row (`colSpan`) under the expanded honeypot. Text/roles of the existing row cells are otherwise unchanged.

- [ ] **Step 6: Add the page-level test**

In `FleetPage.test.tsx`, add one test: clicking `Details` on a row issues `GET /api/honeypots/{id}` (assert the URL) and renders the drift indicator when the fetched `config_version` is behind the profile version.

- [ ] **Step 7: Run the tests**

Run: `cd frontend; npx vitest run src/pages/FleetPage.test.tsx src/components/HoneypotDetail.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/components/HoneypotDetail.tsx frontend/src/components/HoneypotDetail.test.tsx frontend/src/pages/FleetPage.tsx frontend/src/pages/FleetPage.test.tsx
git commit -m "feat(s5): honeypot detail panel via the existing GET /api/honeypots/{id}"
```

---

### Task 5: `ConnectionBadge` + connection types

**Files:**
- Modify: `frontend/src/api/types.ts` (add the two state types)
- Create: `frontend/src/components/ConnectionBadge.tsx`
- Test: `frontend/src/components/ConnectionBadge.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type ConnectionStatus = "connecting" | "live" | "reconnecting"` and `export type GapFillState = "none" | "complete" | "capped" | "failed"` in `api/types.ts` (the module already holds derived UI state, e.g. `FleetStatus`).
  - `ConnectionBadge({ status }: { status: ConnectionStatus })` — a `<span>` with a dot and the label, exactly `connecting` (slate), `live` (emerald), `reconnecting` (red).

- [ ] **Step 1: Write the failing test**

Assert all three labels and that the `connecting` render is neither `live` nor `reconnecting`. Assert the component renders no `role="alert"` and no extra text.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend; npx vitest run src/components/ConnectionBadge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the types and implement the component**

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend; npx vitest run src/components/ConnectionBadge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/components/ConnectionBadge.tsx frontend/src/components/ConnectionBadge.test.tsx
git commit -m "feat(s5): tri-state connection badge"
```

---

### Task 6: Reconnect hardening — `useEventStream` + `EventFeed`

**Files:**
- Modify: `frontend/src/hooks/useEventStream.ts`
- Modify: `frontend/src/components/EventFeed.tsx`
- Modify: `frontend/src/components/EventFeed.test.tsx`
- Delete: `frontend/src/components/StatusBadge.tsx`
- Create: `frontend/src/hooks/useEventStream.test.ts`

**Interfaces:**
- Consumes: `AttackEvent` from `../api/types`; `ConnectionStatus`, `GapFillState` from `../api/types` (Task 5); `apiFetch`, `tokenStore`, `apiBase` from `../api/client`; `ConnectionBadge` (Task 5).
- Produces:
  - `export const BUFFER_LIMIT = 200`
  - `useEventStream(options?: { manageHistory?: boolean }): { events: AttackEvent[]; status: ConnectionStatus; gapFill: GapFillState }` — `manageHistory` defaults to `true`.

Behaviour (from spec §11, in this order of precedence):

1. **Status.** `connecting` before the first open; `live` on open; `reconnecting` on close. `status` describes the socket only — it becomes `live` even when a bounded gap-fill could not retrieve everything.
2. **Backoff with equal jitter.** On close, attempt `n` (1-based): `base = Math.min(1000 * 2 ** n, 30_000)`, `delay = base / 2 + Math.random() * base / 2`. Reset `n` to 0 on open. Clear the pending timer on dispose; never call `setState` after dispose.
3. **Bounded buffer.** Every write path (initial history, recovery, live frame) goes through one `mergeAndCap(prev, incoming)` helper: `mergeById(prev, incoming)` (Task 1's dedupe-by-id + `occurred_at desc, id desc` ordering) followed by `slice(0, BUFFER_LIMIT)`, keeping the **newest**.
4. **Checkpoint.** `checkpointRef` holds the newest `occurred_at` at which the socket was last live; it is advanced by every merge and every live append. **Snapshot it synchronously on the first line of `socket.onopen`**, before `socket.send(...)` and before any await, so a frame delivered after reconnect cannot move the anchor.
5. **Recovery (only when `manageHistory`).** If the snapshot is `null` (first connect, nothing held): `GET /api/events?limit=200`, merge, `gapFill = "none"`. Otherwise `since = new Date(Date.parse(checkpoint) - 1000).toISOString()` and **one** request `GET /api/events?since=<since>&limit=200&offset=0`; merge; then `gapFill = (items.length < BUFFER_LIMIT || total <= BUFFER_LIMIT) ? "complete" : "capped"`. A rejection keeps held events and sets `"failed"`. Never issue an `offset=200/400/600` request.
6. **`manageHistory: false`** issues no REST at all and leaves `gapFill = "none"` (the Overview owns its own sample).

- [ ] **Step 1: Write the failing hook tests**

Create `frontend/src/hooks/useEventStream.test.ts` using `renderHook` from `@testing-library/react`, fake timers, a `FakeWebSocket` (copy the shape from `EventFeed.test.tsx`), and a `fetch` spy that records URLs. Cover the spec §14 hook group:

```ts
// Jitter bounds: every scheduled delay lies in [base/2, base]; capped at 30s; resets after an open
// Exactly one recovery request: full page + total > BUFFER_LIMIT -> one request at offset=0,
//   gapFill "capped", and NO offset=200/400/600 request is ever recorded
// Anchor is the pre-drop checkpoint: since === (newest held before the drop) - 1s
// Critical gap scenario (regression): event at T0; disconnect; missed events spanning (T0, T1];
//   reconnect and deliver newer live L1, L2 during the fetch. Assert:
//     (a) since === T0 - 1s  (the live frames did NOT move the anchor)
//     (b) every missed event the page can carry is present after the merge
//     (c) L1 and L2 are preserved
//     (d) ids repeated across the page, the 1s overlap and the live frames appear exactly once
//     (e) > BUFFER_LIMIT missed -> gapFill "capped" and the NEWEST BUFFER_LIMIT are retained
// Dedupe across page/overlap/live; two events sharing occurred_at are both kept
// Short page -> "complete"; empty page -> "complete" and the buffer unchanged
// No gap on first connect: no `since` in the URL, gapFill "none"
// Failure preserves state: rejected request -> events intact, gapFill "failed", status still "live"
// No drop during recovery: a live frame before the fetch resolves survives the merge
// Buffer cap: the 201st insert drops the oldest; length <= BUFFER_LIMIT
// Dispose: unmount cancels the timer; no post-dispose setState
// Status transitions: connecting -> live; live -> reconnecting; reconnecting -> live
```

Plus the Review Focus pins: exactly `BUFFER_LIMIT` missed events → `"complete"` (pin 3); a frame whose data is `"{"` and a frame whose data is `"{}"` are both ignored, the stream keeps working and `status` stays `live` (pin 2); a second `onopen` while the first recovery fetch is unresolved applies each response at most once and leaves `gapFill` at the newest result (pin 4).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend; npx vitest run src/hooks/useEventStream.test.ts`
Expected: FAIL — `connected`/`gapFill` are not part of the return shape; no jitter.

- [ ] **Step 3: Implement the hook**

Import `mergeById` from `../lib/stats` rather than re-implementing dedupe/ordering. Keep a `disposedRef` and a per-open generation counter so a recovery response from a previous open cannot land.

- [ ] **Step 4: Run the hook tests to verify they pass**

Run: `cd frontend; npx vitest run src/hooks/useEventStream.test.ts`
Expected: PASS.

- [ ] **Step 5: Migrate `EventFeed.tsx` and delete `StatusBadge`**

`const { events, status, gapFill } = useEventStream();` → `<ConnectionBadge status={status} />`. Beside the badge, render a muted note only when `gapFill` is `capped` or `failed`:
- `capped` → `history is partial — recovered the most recent {events.length} events`
- `failed` → `history could not be recovered`

The note carries no `role="alert"` (the socket is live; this is not an error state). Then `git rm frontend/src/components/StatusBadge.tsx` — its only consumer was `EventFeed`.

- [ ] **Step 6: Update the justified `EventFeed.test.tsx` assertion**

The current test asserts no badge text; add an explicit assertion that the badge reads `connecting` before `onopen` and `live` after it (§12's sanctioned change). The list/dedupe assertions stay as they are. This is the only edit to that file.

- [ ] **Step 7: Run the tests**

Run: `cd frontend; npx vitest run src/components/EventFeed.test.tsx src/pages/EventsPage.test.tsx src/hooks/useEventStream.test.ts`
Expected: PASS.

- [ ] **Step 8: Confirm nothing else referenced the deleted component**

Run: `cd frontend; npx tsc -b`
Expected: clean (a dangling `StatusBadge` import would be a TS error).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/hooks/useEventStream.ts frontend/src/hooks/useEventStream.test.ts frontend/src/components/EventFeed.tsx frontend/src/components/EventFeed.test.tsx
git rm frontend/src/components/StatusBadge.tsx
git commit -m "feat(s5): checkpoint recovery, jitter, bounded buffer, tri-state status"
```

---

### Task 7: `EventsOverTimeChart`

**Files:**
- Modify: `frontend/src/lib/datetime.ts` (add `formatUtcMinute`)
- Test: `frontend/src/lib/datetime.test.ts` (new)
- Create: `frontend/src/components/EventsOverTimeChart.tsx`
- Test: `frontend/src/components/EventsOverTimeChart.test.tsx`

**Interfaces:**
- Consumes: `HourBucket`, `WindowDisclosure` from `../lib/stats`.
- Produces:
  - `formatUtcMinute(iso: string): string` → `"2026-10-15 13:00"` (`toISOString().slice(0, 16).replace("T", " ")`), and `"—"` for an unparseable input.
  - `EventsOverTimeChart({ buckets, disclosure }: { buckets: HourBucket[]; disclosure: WindowDisclosure })`.

- [ ] **Step 1: Write the failing tests**

`datetime.test.ts`: `formatUtcMinute("2026-10-15T13:00:00.000Z") === "2026-10-15 13:00"`; a non-UTC offset input is rendered in UTC; garbage → `"—"`.

`EventsOverTimeChart.test.tsx`: 24 bars for 24 buckets; the `max === 0` case renders a flat baseline plus a "no events" label and does not divide by zero; `aria-label` is exactly `Events per hour over the last 24h. {disclosure.text}`; each bar's `<title>` is `YYYY-MM-DD HH:MM UTC — N events` using the bucket's **actual** start instant; no axis label claims `HH:00`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend; npx vitest run src/lib/datetime.test.ts src/components/EventsOverTimeChart.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `formatUtcMinute` and the chart**

`viewBox="0 0 480 120"`, `className="h-32 w-full"`, `role="img"`, 24 `<rect>` bars oldest-left, y-scale `max(count)`, x-axis showing `buckets[0].startIso → buckets[23].endIso` (formatted with `formatUtcMinute` + `" UTC"`). No animation, no gradients, no `<script>`.

- [ ] **Step 4: Run them to verify they pass**

Run: `cd frontend; npx vitest run src/lib/datetime.test.ts src/components/EventsOverTimeChart.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/datetime.ts frontend/src/lib/datetime.test.ts frontend/src/components/EventsOverTimeChart.tsx frontend/src/components/EventsOverTimeChart.test.tsx
git commit -m "feat(s5): hand-rolled inline SVG events-per-hour chart"
```

---

### Task 8: Overview data hook — `useOverviewData`

**Files:**
- Create: `frontend/src/hooks/useOverviewData.ts`
- Test: `frontend/src/hooks/useOverviewData.test.ts`

**Interfaces:**
- Consumes: `listEvents`, `listHoneypots` from `../api/client`; `deriveOverview`, `makeWindow`, `Window`, `Overview`, `FleetCounts` from `../lib/stats`; `useEventStream` from `./useEventStream`; `ConnectionStatus`, `GapFillState`, `Honeypot` from `../api/types`.
- Produces:
  - `export const PAGE_SIZE = 200`, `export const WINDOW_MAX_PAGES = 3`
  - `interface OverviewResult { overview: Overview | null; fleetCounts: FleetCounts | null; fleetLoading: boolean; fleetError: string | null; eventsLoading: boolean; eventsError: string | null; status: ConnectionStatus; recovery: GapFillState }`
  - `useOverviewData(): OverviewResult`

Behaviour:
- `useEventStream({ manageHistory: false })` supplies `live` and `status`.
- `window` is state; re-anchored by `makeWindow(Date.now())` on every derivation pass: after the initial load, after a recovery refetch, and whenever `live` changes identity (§6).
- The events fetch pages `listEvents({ since: window.startIso, until: window.endIso, limit: PAGE_SIZE, offset })` with `offset = 0, 200, 400`, stopping when a page is short **or** `sample.length >= serverTotal`; `serverTotal` is page 0's `total`; `recovery` is `"complete"` when the loop stopped on its own condition and `"capped"` when the page budget ran out. **Never a fourth request.**
- Race safety: a `useRef` monotonic request id per endpoint. Only the newest in-flight events response is applied (a stale one is dropped, not merged); the same guard is applied to the single honeypots request for uniformity.
- On the `reconnecting → live` transition (tracked with a previous-status ref), refetch the window. A **recovery** failure sets `recovery = "failed"` and leaves the previous overview intact (stale sample, never an empty page); only the **initial** failure sets `eventsError` (and `overview` stays null).
- `deriveOverview` is memoised on `{ sample, live, window, honeypots, serverTotal }`, so KPIs, buckets, top lists and the disclosure always read one partition.
- `fleetCounts = honeypots === null ? null : fleetCounts(honeypots)` (spec tension 1).

- [ ] **Step 1: Write the failing tests**

Cover the spec §14 `useOverviewData` group:

```ts
// A live event arriving BEFORE the initial REST response resolves is present in the derived counts
// A live event arriving WHILE a REST request is in flight survives the response (sample-only replace)
// REST ids already received over the socket do not duplicate in the KPIs
// A stale response (older request id) resolving after a newer one does not overwrite the newer sample
// A recovery refetch overlapping live events produces correct KPI/chart values
// Window reconciliation advances: offset=0, 200, 400, at most 3 requests, never a fourth;
//   recovery "capped" when the third page is full, "complete" on a short page
// The derived input stays bounded: sample <= 600 and live <= 200
```

Plus Review Focus pin 4: a second reconnect (`reconnecting → live`) while the first refetch is unresolved applies each response at most once and ends with `recovery` equal to the newest response's result.
Plus spec tension 1's guarantee: honeypots succeed + events fail → `overview === null`, `eventsError` set, and `fleetCounts` still populated.
Plus the exact-boundary case: `total === 200` with one full page → `recovery === "complete"`, one request.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend; npx vitest run src/hooks/useOverviewData.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

- [ ] **Step 4: Run them to verify they pass**

Run: `cd frontend; npx vitest run src/hooks/useOverviewData.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useOverviewData.ts frontend/src/hooks/useOverviewData.test.ts
git commit -m "feat(s5): race-safe overview data hook with bounded window reconciliation"
```

---

### Task 9: `OverviewPage` + routes, nav and post-login destination

**Files:**
- Create: `frontend/src/pages/OverviewPage.tsx`
- Test: `frontend/src/pages/OverviewPage.test.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/components/AppShell.tsx`, `frontend/src/pages/LoginPage.tsx`
- Modify (sanctioned touch points): `frontend/src/App.test.tsx`, `frontend/src/pages/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `useOverviewData` (Task 8), `ConnectionBadge` (Task 5), `EventsOverTimeChart` (Task 7), `Panel`/`Table`/`Th`/`Td`/`EmptyState`/`ErrorState`/`LoadingText` (Task 2).
- Produces: `OverviewPage()` default export.

- [ ] **Step 1: Write the failing page test**

Assert, with a stubbed fetch: the KPI row renders fleet total/online/offline/never and the in-window event count; the chart renders 24 bars; the truncated disclosure `Most recent {n} of {m} events in the last 24h` appears when the sample is capped and the untruncated `All {n} events in the last 24h` when it is not; **a pushed live event increments the count with no refetch** (the Phase 4 exit criteria as a test); a live event that lands while the initial REST response is in flight is counted once.

Plus the partial-failure block (Correction D): fleet fails + events succeed → error in the fleet block and the event KPIs still render; events fail + fleet succeeds → `fleetCounts` still render while the event blocks show errors; **no block renders a misleading `0`**; loading renders a placeholder that is neither `0` nor an error.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend; npx vitest run src/pages/OverviewPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `OverviewPage.tsx`**

Top to bottom: `ConnectionBadge` + the disclosure line; KPI row (fleet total + online/offline/never; events in window; distinct source IPs with a muted `(N unattributed)` note); the chart panel; top event types (3); top targeted ports (3). Every panel gets its own loading, empty (`no events in the last 24h`) and error state, driven by the two requests independently. The muted recovery note from §11.5 renders when `recovery` is `capped` or `failed`. The chart is `role="img"` with the disclosure in its `aria-label`; no KPI is communicated by colour alone.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend; npx vitest run src/pages/OverviewPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the routes and nav**

- `App.tsx`: add `<Route path="" element={<OverviewPage />} />` as the first child of the authenticated shell route; change the catch-all to `<Navigate to="/" replace />`.
- `AppShell.tsx`: prepend `{ to: "/", label: "Overview" }` to `NAV`.
- `LoginPage.tsx`: `navigate("/", { replace: true })` on success.

- [ ] **Step 6: Update the two sanctioned test touch points**

- `App.test.tsx`: assert the `Overview` nav link renders for a signed-in operator and that an unknown path lands on the overview (not `/fleet`). Keep the anonymous-visitor test as it is (its route can stay `/fleet`).
- `LoginPage.test.tsx`: add a navigation assertion by rendering a two-route element through the existing helper —
  `renderWithProviders(<Routes><Route path="/login" element={<LoginPage />} /><Route path="/" element={<div>overview-stub</div>} /></Routes>, { route: "/login", fetchImpl })` — then assert `await screen.findByText("overview-stub")`. Keep the existing token assertion.

- [ ] **Step 7: Run the affected tests**

Run: `cd frontend; npx vitest run src/App.test.tsx src/pages/LoginPage.test.tsx src/pages/OverviewPage.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/OverviewPage.tsx frontend/src/pages/OverviewPage.test.tsx frontend/src/App.tsx frontend/src/components/AppShell.tsx frontend/src/pages/LoginPage.tsx frontend/src/App.test.tsx frontend/src/pages/LoginPage.test.tsx
git commit -m "feat(s5): overview landing page at / with routes, nav and post-login redirect"
```

---

### Task 10: Whole-branch verification, docs and fresh review

**Files:**
- Modify: `AGENTS.md` §11 (current focus)
- Modify: `docs/s5-dashboard-design.md` only if a review finding proves a factual error in it

**Interfaces:**
- Consumes: everything above.
- Produces: the slice-end review record.

- [ ] **Step 1: Full frontend gates**

Run: `cd frontend; npx tsc -b`
Run: `cd frontend; npx vitest run`
Run: `cd frontend; npx vite build`
Expected: type-check clean; **every pre-existing test still present and passing** (34 to start, plus the new unit/component/page tests); build succeeds.

- [ ] **Step 2: Confirm the untouched suites are untouched**

Run: `docker compose run --rm --no-deps -e HF_REPO_ROOT=/repo -v "$($PWD.Path):/repo" -v "$($PWD.Path)/backend:/app" backend pytest -q`
Expected: 77 passed. (S5 makes no backend change; this is the regression check that nothing leaked.)
Run: `docker compose run --rm --no-deps agent pytest -q`
Expected: 22 passed.

- [ ] **Step 3: Stack + live walkthrough**

Run: `docker compose up -d --build` then read the output (Compose returns exit code 1 on Windows even on success) and `docker compose ps`.
Walk: `/` serves the overview → sign in and land on it → a real decoy connection moves the KPIs and the chart **without a refresh** → stop the backend and observe the badge go `reconnecting`, restart it and observe `live`. Extended: stop the backend long enough that more than `BUFFER_LIMIT` events are missed, restart it, and confirm the partial-recovery note appears while the badge returns to `live`.

- [ ] **Step 4: Update the working agreement**

Set `AGENTS.md` §11 to: S5 complete (overview, chart, detail panels, reconnect hardening, theme consistency pass); next → S6 (reliability & security, TLS/encryption matrix); remaining before submission unchanged. Keep the S5 rows' wording consistent with what actually shipped.

- [ ] **Step 5: Fresh whole-branch review**

Dispatch a fresh reviewer over the S5 commit range (`a19d384..HEAD`, plus this plan) with the spec in hand. It must check, at minimum: the theme-pass guardrail (rendered text/ARIA unchanged outside the sanctioned touch points); the checkpoint/recovery semantics and request counts; the reporting-window boundaries; the race-safe merge; partial-failure honesty; and that no limitation in spec §15 was silently dropped. Record Critical/Important/Minor findings.

- [ ] **Step 6: Fix findings and re-verify**

Fix every Critical/Important finding (and any Minor worth it), re-run Step 1, and commit the fixes.

- [ ] **Step 7: Close out**

```bash
git add AGENTS.md docs
git commit -m "docs(s5): record the completed slice and its review"
git log --oneline a19d384..HEAD
```

The slice is complete only when Step 1 and Step 3 both pass on the final commit and the reviewer's Critical/Important findings are closed.
