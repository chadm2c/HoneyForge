import { useEffect, useState } from "react";
import { listAuditLogs } from "../api/client";
import type { AuditLog } from "../api/types";
import Button from "../components/ui/Button";
import ErrorState from "../components/ui/ErrorState";
import Panel from "../components/ui/Panel";
import Table, { Td, Th } from "../components/ui/Table";
import { localToIso } from "../lib/datetime";

const PAGE_SIZE = 50;
const FIELD =
  "mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-cyan-600 focus:outline-none";

interface Filters {
  action: string;
  resource_type: string;
  since: string;
  until: string;
}

const NO_FILTERS: Filters = {
  action: "",
  resource_type: "",
  since: "",
  until: "",
};

export default function AuditPage() {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAuditLogs({
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
          setError(err instanceof Error ? err.message : "Failed to load audit logs");
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

  return (
    <section className="space-y-6">
      <h2 className="text-sm font-semibold tracking-wide text-cyan-300">
        Audit log
      </h2>

      <Panel className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label htmlFor="a-action" className="block text-xs text-slate-400">
            Action
          </label>
          <input
            id="a-action"
            value={filters.action}
            onChange={(e) => update("action", e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="a-type" className="block text-xs text-slate-400">
            Resource type
          </label>
          <input
            id="a-type"
            value={filters.resource_type}
            onChange={(e) => update("resource_type", e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="a-since" className="block text-xs text-slate-400">
            Since
          </label>
          <input
            id="a-since"
            type="datetime-local"
            value={filters.since}
            onChange={(e) => update("since", e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="a-until" className="block text-xs text-slate-400">
            Until
          </label>
          <input
            id="a-until"
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
              <Th>When</Th>
              <Th>Action</Th>
              <Th>Resource</Th>
              <Th>Resource id</Th>
              <Th>Operator</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <Td className="font-mono text-xs text-slate-400">
                  {new Date(row.created_at).toISOString()}
                </Td>
                <Td className="font-medium text-slate-200">{row.action}</Td>
                <Td className="text-slate-400">{row.resource_type}</Td>
                <Td className="font-mono text-xs text-slate-400">
                  {row.resource_id ?? "—"}
                </Td>
                <Td className="text-slate-400">
                  {/* A failed login has no operator to attribute the row to. */}
                  {row.operator_id ?? "system"}
                </Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  className="border-t border-slate-900 py-2 pr-4 text-slate-500"
                  colSpan={5}
                >
                  {loading ? "Loading…" : "No audit entries match these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {/* `rows`, not `total`: an empty page past the end must not read
              "Showing 51–50 of 120". */}
          {rows.length === 0
            ? "No audit entries"
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
    </section>
  );
}
