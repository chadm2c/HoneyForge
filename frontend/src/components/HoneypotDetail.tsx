import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getHoneypot } from "../api/client";
import type { Honeypot } from "../api/types";
import FleetStatusBadge from "./FleetStatusBadge";
import ErrorState from "./ui/ErrorState";
import LoadingText from "./ui/LoadingText";
import Panel from "./ui/Panel";

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
      <dd className="break-all font-mono text-slate-200">{value}</dd>
    </div>
  );
}

/**
 * The expanded detail panel for a single honeypot. The list row is a summary,
 * so this fetches the honeypot's own record on mount and renders the fields the
 * table cannot show — including the config-version drift indicator, which warns
 * when the agent's reported version is behind the profile's current version.
 */
export default function HoneypotDetail({ honeypotId }: { honeypotId: string }) {
  const [honeypot, setHoneypot] = useState<Honeypot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHoneypot(honeypotId)
      .then((hp) => {
        if (!cancelled) setHoneypot(hp);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load honeypot");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [honeypotId]);

  if (error) return <ErrorState>{error}</ErrorState>;
  if (!honeypot) return <LoadingText />;

  // Only a strictly older agent build is drift; an equal or newer version is not.
  const drifted = honeypot.config_version < honeypot.profile.version;

  return (
    <Panel>
      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        <Row label="Name" value={honeypot.name} />
        <Row
          label="Status"
          value={<FleetStatusBadge status={honeypot.status} />}
        />
        <Row
          label="Profile"
          value={`${honeypot.profile.name} v${honeypot.profile.version}`}
        />
        <Row label="Config version" value={`v${honeypot.config_version}`} />
        <Row
          label="Last seen"
          value={
            honeypot.last_seen_at
              ? new Date(honeypot.last_seen_at).toISOString()
              : "—"
          }
        />
        <Row label="Created" value={new Date(honeypot.created_at).toISOString()} />
      </dl>

      {drifted && (
        <p className="mt-3 text-xs text-amber-400">
          {`Config outdated (agent v${honeypot.config_version} of v${honeypot.profile.version})`}
        </p>
      )}
    </Panel>
  );
}
