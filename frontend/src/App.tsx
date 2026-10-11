import { apiBase } from "./api/client";

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="border-b border-cyan-900/60 px-6 py-4">
        <h1 className="text-xl font-semibold tracking-wide text-cyan-400">
          HoneyForge
        </h1>
        <p className="text-xs text-slate-500">
          Centralized honeypot control plane · UMIRHack 2026
        </p>
      </header>
      <main className="px-6 py-6">
        <p className="text-slate-400">
          Control center API:{" "}
          <code className="font-mono text-cyan-300">{apiBase}</code>
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Live event feed and fleet status land here in S2.
        </p>
      </main>
    </div>
  );
}