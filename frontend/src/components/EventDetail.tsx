import type { ReactNode } from "react";
import type { AttackEvent } from "../api/types";
import Panel from "./ui/Panel";

/**
 * Render a `details` value as text. Primitives read directly; an object, array
 * or `null` is shown as compact JSON so a nested map never crashes the panel.
 */
function renderValue(value: unknown): string {
  if (value === null || typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
      <dd className="break-all font-mono text-slate-200">{value}</dd>
    </div>
  );
}

/**
 * The expanded detail panel for a single event: the fixed summary rows the
 * table cannot show, then the free-form `details` map as labelled rows.
 */
export default function EventDetail({
  event,
  honeypotName,
}: {
  event: AttackEvent;
  honeypotName?: string;
}) {
  const source =
    event.source_ip === null
      ? "—"
      : event.source_port === null
        ? event.source_ip
        : `${event.source_ip}:${event.source_port}`;
  const entries = Object.entries(event.details);

  return (
    <Panel>
      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        <Row label="Type" value={event.event_type} />
        <Row label="Protocol" value={event.protocol.toUpperCase()} />
        <Row label="Honeypot" value={honeypotName ?? event.honeypot_id} />
        <Row label="Source" value={source} />
        <Row label="Target port" value={event.target_port ?? "—"} />
        <Row
          label="Occurred at"
          value={new Date(event.occurred_at).toISOString()}
        />
        <Row
          label="Received at"
          value={new Date(event.received_at).toISOString()}
        />
      </dl>

      {entries.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold tracking-wide text-cyan-300">
            Details
          </h4>
          <dl className="mt-1 grid gap-1 text-xs sm:grid-cols-2">
            {entries.map(([key, value]) => (
              <Row key={key} label={key} value={renderValue(value)} />
            ))}
          </dl>
        </div>
      )}
    </Panel>
  );
}
