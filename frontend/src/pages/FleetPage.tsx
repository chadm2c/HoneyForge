import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { listHoneypots, listProfiles, registerHoneypot } from "../api/client";
import type { Honeypot, HoneypotRegistered, ProfileSummary } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import FleetStatusBadge from "../components/FleetStatusBadge";

const FIELD =
  "mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-cyan-600 focus:outline-none";
const TH = "py-2 pr-4 text-xs font-medium uppercase tracking-wide text-slate-500";
const TD = "border-t border-slate-900 py-2 pr-4";

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

      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}

      {honeypots.length === 0 ? (
        <p className="text-sm text-slate-500">
          {loading ? "Loading…" : "No honeypots registered yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                <th className={TH}>Name</th>
                <th className={TH}>Level</th>
                <th className={TH}>Status</th>
                <th className={TH}>Last seen</th>
                <th className={TH}>Profile</th>
                <th className={TH}>Config</th>
              </tr>
            </thead>
            <tbody>
              {honeypots.map((hp) => (
                <tr key={hp.id}>
                  <td className={`${TD} font-medium text-slate-200`}>{hp.name}</td>
                  <td className={`${TD} text-slate-400`}>
                    {hp.profile.interaction_level}
                  </td>
                  <td className={TD}>
                    <FleetStatusBadge status={hp.status} />
                  </td>
                  <td className={`${TD} font-mono text-xs text-slate-400`}>
                    {lastSeen(hp.last_seen_at)}
                  </td>
                  <td className={`${TD} text-slate-400`}>
                    {hp.profile.name} v{hp.profile.version}
                  </td>
                  <td className={`${TD} font-mono text-xs text-slate-400`}>
                    {hp.config_version}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin && (
        <div className="rounded border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-xs font-semibold tracking-wide text-cyan-300">
            Register honeypot
          </h3>
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
            <button
              type="submit"
              disabled={busy || !name || !profileId}
              className="rounded bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-60"
            >
              {busy ? "Registering…" : "Register"}
            </button>
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
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(registered.agent_token);
                  }}
                  className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/40"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
