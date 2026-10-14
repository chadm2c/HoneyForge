import { useEffect, useState } from "react";
import { listAuditLogs } from "../api/client";
import type { AuditLog } from "../api/types";
import { localToIso } from "../lib/datetime";

const PAGE_SIZE = 50;
const FIELD =
  "mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-cyan-600 focus:outline-none";
const TH = "py-2 pr-4 text-xs font-medium uppercase tracking-wide text-slate-500";
const TD = "border-t border-slate-900 py-2 pr-4";

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

      <div className="grid grid-cols-2 gap-3 rounded border border-slate-800 bg-slate-900 p-4 md:grid-cols-4">
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
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              <th className={TH}>When</th>
              <th className={TH}>Action</th>
              <th className={TH}>Resource</th>
              <th className={TH}>Resource id</th>
              <th className={TH}>Operator</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className={`${TD} font-mono text-xs text-slate-400`}>
                  {new Date(row.created_at).toISOString()}
                </td>
                <td className={`${TD} font-medium text-slate-200`}>{row.action}</td>
                <td className={`${TD} text-slate-400`}>{row.resource_type}</td>
                <td className={`${TD} font-mono text-xs text-slate-400`}>
                  {row.resource_id ?? "—"}
                </td>
                <td className={`${TD} text-slate-400`}>
                  {/* A failed login has no operator to attribute the row to. */}
                  {row.operator_id ?? "system"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className={`${TD} text-slate-500`} colSpan={5}>
                  {loading ? "Loading…" : "No audit entries match these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {total === 0
            ? "No audit entries"
            : `Showing ${offset + 1}–${offset + rows.length} of ${total}`}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-cyan-700 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={offset + rows.length >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-cyan-700 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
