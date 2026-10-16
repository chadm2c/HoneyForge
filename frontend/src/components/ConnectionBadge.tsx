import type { ConnectionStatus } from "../api/types";

const STYLES: Record<ConnectionStatus, string> = {
  connecting: "bg-slate-800 text-slate-400",
  live: "bg-emerald-950 text-emerald-300",
  reconnecting: "bg-red-950 text-red-300",
};

const DOTS: Record<ConnectionStatus, string> = {
  connecting: "bg-slate-400",
  live: "bg-emerald-400",
  reconnecting: "bg-red-400",
};

/**
 * Reports the dashboard's realtime WebSocket connection. `connecting` is the
 * initial state before any socket opens, so it is not an error and carries no
 * `role="alert"`. This is a different axis from `FleetStatusBadge`.
 */
export default function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOTS[status]}`} />
      {status}
    </span>
  );
}
