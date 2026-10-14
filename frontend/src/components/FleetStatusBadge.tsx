import type { FleetStatus } from "../api/types";

const STYLES: Record<FleetStatus, string> = {
  online: "bg-emerald-950 text-emerald-300",
  offline: "bg-red-950 text-red-300",
  never: "bg-slate-800 text-slate-400",
};

/**
 * Fleet status is derived by the API from `last_seen_at` (`online` / `offline`)
 * or is `never` for an agent that has not reported since registration. This is
 * a different axis from `StatusBadge`, which reports the WebSocket connection.
 */
export default function FleetStatusBadge({ status }: { status: FleetStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        STYLES[status] ?? STYLES.never
      }`}
    >
      {status}
    </span>
  );
}
