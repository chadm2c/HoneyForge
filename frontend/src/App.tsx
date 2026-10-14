import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import RequireAuth from "./auth/RequireAuth";
import AppShell from "./components/AppShell";
import LoginPage from "./pages/LoginPage";
import FleetPage from "./pages/FleetPage";

/** Stand-in for the pages still being built in S4 (Tasks 9–12). */
function Placeholder({ label }: { label: string }) {
  return <p className="text-sm text-slate-500">{label} — coming next in S4.</p>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="fleet" element={<FleetPage />} />
          <Route path="profiles" element={<Placeholder label="Profiles" />} />
          <Route path="events" element={<Placeholder label="Events" />} />
          <Route path="audit" element={<Placeholder label="Audit" />} />
        </Route>
        <Route path="*" element={<Navigate to="/fleet" replace />} />
      </Routes>
    </AuthProvider>
  );
}
