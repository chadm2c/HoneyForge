import { useEventStream } from "../hooks/useEventStream";
import ConnectionBadge from "./ConnectionBadge";

export default function EventFeed() {
  const { events, status, gapFill } = useEventStream();

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-cyan-300">
          Live event feed
        </h2>
        <div className="flex items-center gap-3">
          {/* Recovery completeness is a separate axis from the socket status:
              the badge stays "live", and this muted note carries the gap. */}
          {gapFill === "capped" && (
            <span className="text-xs text-slate-500">
              history is partial — recovered the most recent {events.length} events
            </span>
          )}
          {gapFill === "failed" && (
            <span className="text-xs text-slate-500">
              history could not be recovered
            </span>
          )}
          <ConnectionBadge status={status} />
        </div>
      </div>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No events yet…</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {events.map((e) => (
            <li
              key={e.id}
              className="rounded border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-cyan-300">{e.event_type}</span>
                <span className="text-slate-500">{e.protocol.toUpperCase()}</span>
                <span className="text-slate-300">{e.source_ip ?? "—"}</span>
                <span className="text-slate-600">:{e.source_port ?? "?"}</span>
                <span className="text-slate-500">→</span>
                <span className="text-slate-600">:{e.target_port ?? "?"}</span>
                <time className="ml-auto text-slate-500">
                  {new Date(e.occurred_at).toISOString()}
                </time>
              </div>
              {Object.keys(e.details).length > 0 && (
                <pre className="mt-1 whitespace-pre-wrap text-slate-400">
                  {JSON.stringify(e.details, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
