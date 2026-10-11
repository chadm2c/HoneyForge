import { apiBase } from "./api/client";
import EventFeed from "./components/EventFeed";

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
      <main className="mx-auto max-w-4xl px-6 py-6">
        <p className="text-slate-400">
          Control center API:{" "}
          <code className="font-mono text-cyan-300">{apiBase}</code>
        </p>
        <div className="mt-4">
          <EventFeed />
        </div>
      </main>
    </div>
  );
}