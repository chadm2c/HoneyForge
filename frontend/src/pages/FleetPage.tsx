import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { listHoneypots, listProfiles, registerHoneypot } from "../api/client";
import type { Honeypot, HoneypotRegistered, ProfileSummary } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import FleetStatusBadge from "../components/FleetStatusBadge";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import LoadingText from "../components/ui/LoadingText";
import Panel from "../components/ui/Panel";
import Table, { Td, Th } from "../components/ui/Table";

const FIELD =
  "mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-cyan-600 focus:outline-none";

function lastSeen(value: string | null): string {
  return value ? new Date(value).toISOString() : "—";
}

export default function FleetPage() {
  const { operator } = useAuth();
  const isAdmin = operator?.role === "admin";

  const [honeypots, setHoneypots] = useState<Honeypot[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [profileId, setProfileId] = useState("");
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState<HoneypotRegistered | null>(null);

  const load = useCallback(async () => {
    try {
      setHoneypots(await listHoneypots());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the fleet");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only an admin can register, so only an admin needs the profile list.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    listProfiles()
      .then((list) => {
        if (!cancelled) setProfiles(list);
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  async function onRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await registerHoneypot({ name, profile_id: profileId });
      setRegistered(res);
      setName("");
      setProfileId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-cyan-300">Fleet</h2>
        <p className="text-xs text-slate-500">
          {honeypots.length} registered
        </p>
      </div>

      {error && <ErrorState>{error}</ErrorState>}

      {honeypots.length === 0 ? (
        loading ? (
          <LoadingText />
        ) : (
          <EmptyState>No honeypots registered yet.</EmptyState>
        )
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Level</Th>
                <Th>Status</Th>
                <Th>Last seen</Th>
                <Th>Profile</Th>
                <Th>Config</Th>
              </tr>
            </thead>
            <tbody>
              {honeypots.map((hp) => (
                <tr key={hp.id}>
                  <Td className="font-medium text-slate-200">{hp.name}</Td>
                  <Td className="text-slate-400">
                    {hp.profile.interaction_level}
                  </Td>
                  <Td>
                    <FleetStatusBadge status={hp.status} />
                  </Td>
                  <Td className="font-mono text-xs text-slate-400">
                    {lastSeen(hp.last_seen_at)}
                  </Td>
                  <Td className="text-slate-400">
                    {hp.profile.name} v{hp.profile.version}
                  </Td>
                  <Td className="font-mono text-xs text-slate-400">
                    {hp.config_version}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {isAdmin && (
        <Panel title="Register honeypot">
          <form onSubmit={onRegister} className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="hp-name" className="block text-xs text-slate-400">
                Name
              </label>
              <input
                id="hp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor="hp-profile" className="block text-xs text-slate-400">
                Profile
              </label>
              <select
                id="hp-profile"
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                className={FIELD}
              >
                <option value="">Select a profile…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} v{p.version}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !name || !profileId}
            >
              {busy ? "Registering…" : "Register"}
            </Button>
          </form>

          {registered && (
            <div className="mt-4 rounded border border-amber-800 bg-amber-950/40 p-3">
              <p className="text-xs font-medium text-amber-300">
                Agent token for {registered.name} — copy it now, it will not be
                shown again.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-slate-950 px-2 py-1 font-mono text-xs text-amber-200">
                  {registered.agent_token}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(registered.agent_token);
                  }}
                >
                  Copy
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}
    </section>
  );
}
