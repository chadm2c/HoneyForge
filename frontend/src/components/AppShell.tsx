import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const NAV = [
  { to: "/fleet", label: "Fleet" },
  { to: "/profiles", label: "Profiles" },
  { to: "/events", label: "Events" },
  { to: "/audit", label: "Audit" },
];

export default function AppShell() {
  const { operator, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="border-b border-cyan-900/60 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-wide text-cyan-400">
              HoneyForge
            </h1>
            <p className="text-xs text-slate-500">
              Centralized honeypot control plane · UMIRHack 2026
            </p>
          </div>
          {operator && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-slate-300">{operator.username}</span>
              <span className="rounded-full bg-cyan-950 px-2 py-0.5 font-medium text-cyan-300">
                {operator.role}
              </span>
              <button
                type="button"
                onClick={logout}
                className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-cyan-700 hover:text-cyan-300"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
        <nav className="mt-4 flex gap-5 text-sm">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive
                  ? "font-medium text-cyan-300"
                  : "text-slate-400 hover:text-slate-200"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
