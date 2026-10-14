import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import RequireAuth from "./auth/RequireAuth";
import AppShell from "./components/AppShell";
import LoginPage from "./pages/LoginPage";
import FleetPage from "./pages/FleetPage";
import ProfilesPage from "./pages/ProfilesPage";
import EventsPage from "./pages/EventsPage";

/** Stand-in for the page still being built in S4 (Task 12). */
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
          <Route path="profiles" element={<ProfilesPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="audit" element={<Placeholder label="Audit" />} />
        </Route>
        <Route path="*" element={<Navigate to="/fleet" replace />} />
      </Routes>
    </AuthProvider>
  );
}
