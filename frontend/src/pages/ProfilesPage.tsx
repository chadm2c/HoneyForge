import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  updateProfile,
} from "../api/client";
import type { Profile, ProfileSummary } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import LoadingText from "../components/ui/LoadingText";
import Panel from "../components/ui/Panel";
import Table, { Td, Th } from "../components/ui/Table";

const FIELD =
  "mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-cyan-600 focus:outline-none";

interface FormState {
  name: string;
  level: string;
  ports: string;
  banner: string;
  title: string;
  loginEnabled: boolean;
}

const EMPTY: FormState = {
  name: "",
  level: "low",
  ports: "2222",
  banner: "SSH-2.0-OpenSSH_9.6",
  title: "Admin console",
  loginEnabled: true,
};

/**
 * Ports are free text and normalised to valid port numbers, matching what the
 * backend validator accepts. Anything that is not a usable port is dropped
 * locally rather than sent, so an API 422 still means something.
 */
function parsePorts(raw: string): number[] {
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map(Number)
    .filter((p) => Number.isInteger(p) && p > 0 && p <= 65535);
}

function buildConfig(form: FormState): Record<string, unknown> {
  const ports = parsePorts(form.ports);
  if (form.level === "medium") {
    return { ports, title: form.title, login_enabled: form.loginEnabled };
  }
  return { ports, banner: form.banner };
}

function configToForm(profile: Profile): FormState {
  const { config } = profile;
  return {
    name: profile.name,
    level: profile.interaction_level,
    ports: Array.isArray(config.ports) ? config.ports.join(", ") : "",
    banner: typeof config.banner === "string" ? config.banner : "",
    title: typeof config.title === "string" ? config.title : "",
    loginEnabled: config.login_enabled !== false,
  };
}

export default function ProfilesPage() {
  const { operator } = useAuth();
  const isAdmin = operator?.role === "admin";

  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProfiles(await listProfiles());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setForm(EMPTY);
    setEditingId(null);
    setShowForm(true);
    setError(null);
    setConfirmId(null);
  }

  async function openEdit(id: string) {
    setError(null);
    setConfirmId(null);
    try {
      // The index omits `config`, so the edit form reads the full profile.
      const full = await getProfile(id);
      setForm(configToForm(full));
      setEditingId(id);
      setShowForm(true);
    } catch {
      setError("Could not load that profile");
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const payload = {
      name: form.name,
      interaction_level: form.level,
      config: buildConfig(form),
    };
    try {
      if (editingId) await updateProfile(editingId, payload);
      else await createProfile(payload);
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "A profile with that name already exists"
          : "Could not save the profile",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setConfirmId(null);
    setError(null);
    try {
      await deleteProfile(id);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "Profile is in use by a honeypot"
          : "Could not delete the profile",
      );
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-cyan-300">
          Profiles
        </h2>
        {isAdmin && (
          <Button type="button" variant="primary" onClick={openCreate}>
            New profile
          </Button>
        )}
      </div>

      {error && <ErrorState>{error}</ErrorState>}

      {showForm && isAdmin && (
        <Panel title={editingId ? "Edit profile" : "New profile"}>
          <form onSubmit={onSubmit}>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="pf-name" className="block text-xs text-slate-400">
                  Name
                </label>
                <input
                  id="pf-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={FIELD}
                />
              </div>
              <div>
                <label htmlFor="pf-level" className="block text-xs text-slate-400">
                  Interaction level
                </label>
                <select
                  id="pf-level"
                  value={form.level}
                  onChange={(e) => setForm({ ...form, level: e.target.value })}
                  className={FIELD}
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                </select>
              </div>
              <div>
                <label htmlFor="pf-ports" className="block text-xs text-slate-400">
                  Ports (comma separated)
                </label>
                <input
                  id="pf-ports"
                  value={form.ports}
                  onChange={(e) => setForm({ ...form, ports: e.target.value })}
                  className={FIELD}
                />
              </div>

              {form.level === "medium" ? (
                <>
                  <div>
                    <label
                      htmlFor="pf-title"
                      className="block text-xs text-slate-400"
                    >
                      Page title
                    </label>
                    <input
                      id="pf-title"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      className={FIELD}
                    />
                  </div>
                  <label className="flex items-center gap-2 py-1 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={form.loginEnabled}
                      onChange={(e) =>
                        setForm({ ...form, loginEnabled: e.target.checked })
                      }
                    />
                    Login page enabled
                  </label>
                </>
              ) : (
                <div>
                  <label
                    htmlFor="pf-banner"
                    className="block text-xs text-slate-400"
                  >
                    Banner
                  </label>
                  <input
                    id="pf-banner"
                    value={form.banner}
                    onChange={(e) => setForm({ ...form, banner: e.target.value })}
                    className={FIELD}
                  />
                </div>
              )}

              <Button type="submit" variant="primary" disabled={busy || !form.name}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Panel>
      )}

      {profiles.length === 0 ? (
        loading ? (
          <LoadingText />
        ) : (
          <EmptyState>No profiles defined yet.</EmptyState>
        )
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Level</Th>
                <Th>Version</Th>
                <Th>Updated</Th>
                {isAdmin && <Th>Actions</Th>}
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium text-slate-200">{p.name}</Td>
                  <Td className="text-slate-400">{p.interaction_level}</Td>
                  <Td className="font-mono text-xs text-slate-400">
                    v{p.version}
                  </Td>
                  <Td className="font-mono text-xs text-slate-400">
                    {new Date(p.updated_at).toISOString()}
                  </Td>
                  {isAdmin && (
                    <Td className="whitespace-nowrap">
                      <Button
                        type="button"
                        variant="secondary"
                        className="mr-2"
                        onClick={() => void openEdit(p.id)}
                      >
                        Edit
                      </Button>
                      {confirmId === p.id ? (
                        <>
                          <Button
                            type="button"
                            variant="danger"
                            className="mr-2"
                            onClick={() => void onDelete(p.id)}
                          >
                            Confirm delete
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setConfirmId(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setConfirmId(p.id)}
                        >
                          Delete
                        </Button>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </section>
  );
}
