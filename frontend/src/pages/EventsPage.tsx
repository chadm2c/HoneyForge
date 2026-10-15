import { useEffect, useState } from "react";
import { listEvents, listHoneypots } from "../api/client";
import type { AttackEvent, Honeypot } from "../api/types";
import EventDetail from "../components/EventDetail";
import EventFeed from "../components/EventFeed";
import Button from "../components/ui/Button";
import ErrorState from "../components/ui/ErrorState";
import Panel from "../components/ui/Panel";
import Table, { Td, Th } from "../components/ui/Table";
import { localToIso } from "../lib/datetime";

const PAGE_SIZE = 50;
const FIELD =
  "mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-cyan-600 focus:outline-none";

interface Filters {
  honeypot_id: string;
  event_type: string;
  source_ip: string;
  q: string;
  since: string;
  until: string;
}

const NO_FILTERS: Filters = {
  honeypot_id: "",
  event_type: "",
  source_ip: "",
  q: "",
  since: "",
  until: "",
};

export default function EventsPage() {
  const [honeypots, setHoneypots] = useState<Honeypot[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<AttackEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listHoneypots()
      .then((list) => {
        if (!cancelled) setHoneypots(list);
      })
      .catch(() => {
        if (!cancelled) setHoneypots([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listEvents({
      ...filters,
      since: localToIso(filters.since),
      until: localToIso(filters.until),
      limit: PAGE_SIZE,
      offset,
    })
      .then((page) => {
        if (cancelled) return;
        setRows(page.items);
        setTotal(page.total);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load events");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, offset]);

  // Any change to the filter set invalidates the current page position.
  function update(key: keyof Filters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setOffset(0);
  }

  function honeypotName(id: string): string {
    return honeypots.find((h) => h.id === id)?.name ?? id.slice(0, 8);
  }

  return (
    <section className="space-y-6">
      <h2 className="text-sm font-semibold tracking-wide text-cyan-300">Events</h2>

      <Panel className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <div>
          <label htmlFor="f-honeypot" className="block text-xs text-slate-400">
            Honeypot
          </label>
          <select
            id="f-honeypot"
            value={filters.honeypot_id}
            onChange={(e) => update("honeypot_id", e.target.value)}
            className={FIELD}
          >
            <option value="">All honeypots</option>
            {honeypots.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-type" className="block text-xs text-slate-400">
            Event type
          </label>
          <input
            id="f-type"
            value={filters.event_type}
            onChange={(e) => update("event_type", e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="f-ip" className="block text-xs text-slate-400">
            Source IP
          </label>
          <input
            id="f-ip"
            value={filters.source_ip}
            onChange={(e) => update("source_ip", e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="f-q" className="block text-xs text-slate-400">
            Search
          </label>
          <input
            id="f-q"
            value={filters.q}
            onChange={(e) => update("q", e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="f-since" className="block text-xs text-slate-400">
            Since
          </label>
          <input
            id="f-since"
            type="datetime-local"
            value={filters.since}
            onChange={(e) => update("since", e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="f-until" className="block text-xs text-slate-400">
            Until
          </label>
          <input
            id="f-until"
            type="datetime-local"
            value={filters.until}
            onChange={(e) => update("until", e.target.value)}
            className={FIELD}
          />
        </div>
      </Panel>

      {error && <ErrorState>{error}</ErrorState>}

      <div className="overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <Th>Occurred</Th>
              <Th>Type</Th>
              <Th>Protocol</Th>
              <Th>Source</Th>
              <Th>Target</Th>
              <Th>Honeypot</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <Td className="font-mono text-xs text-slate-400">
                  {new Date(e.occurred_at).toISOString()}
                </Td>
                <Td className="font-medium text-slate-200">{e.event_type}</Td>
                <Td className="text-slate-400">{e.protocol.toUpperCase()}</Td>
                <Td className="font-mono text-xs text-slate-300">
                  {e.source_ip ?? "—"}
                  {e.source_port === null ? "" : `:${e.source_port}`}
                </Td>
                <Td className="font-mono text-xs text-slate-400">
                  {e.target_port ?? "—"}
                </Td>
                <Td className="text-slate-400">{honeypotName(e.honeypot_id)}</Td>
                <Td className="text-right">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setSelected(selected === e.id ? null : e.id)}
                  >
                    {selected === e.id ? "Hide" : "Details"}
                  </Button>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  className="border-t border-slate-900 py-2 pr-4 text-slate-500"
                  colSpan={7}
                >
                  {loading ? "Loading…" : "No events match these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>

      {rows
        .filter((e) => e.id === selected)
        .map((e) => (
          <EventDetail
            key={e.id}
            event={e}
            honeypotName={honeypotName(e.honeypot_id)}
          />
        ))}

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {/* `rows`, not `total`: a page past the end (rows were deleted or the
              filters narrowed) is empty even though the total is not, and
              "Showing 51–50 of 120" is nonsense. */}
          {rows.length === 0
            ? "No events"
            : `Showing ${offset + 1}–${offset + rows.length} of ${total}`}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={offset + rows.length >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>

      <EventFeed />
    </section>
  );
}
