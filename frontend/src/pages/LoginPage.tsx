import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const INPUT_CLASS =
  "mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-cyan-600 focus:outline-none";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      // Success hands off to the shell; busy stays set until unmount.
      navigate("/fleet", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Invalid username or password"
          : "Sign-in failed. Is the control center reachable?",
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-200">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded border border-slate-800 bg-slate-900 p-6"
      >
        <h1 className="text-xl font-semibold tracking-wide text-cyan-400">
          HoneyForge
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Centralized honeypot control plane
        </p>

        <label
          htmlFor="username"
          className="mt-6 block text-xs font-medium text-slate-400"
        >
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={INPUT_CLASS}
        />

        <label
          htmlFor="password"
          className="mt-4 block text-xs font-medium text-slate-400"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT_CLASS}
        />

        {error && (
          <p role="alert" className="mt-4 text-xs text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded bg-cyan-700 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
