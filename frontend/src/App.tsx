import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import RequireAuth from "./auth/RequireAuth";
import AppShell from "./components/AppShell";
import AuditPage from "./pages/AuditPage";
import EventsPage from "./pages/EventsPage";
import FleetPage from "./pages/FleetPage";
import LoginPage from "./pages/LoginPage";
import ProfilesPage from "./pages/ProfilesPage";

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
          <Route path="audit" element={<AuditPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/fleet" replace />} />
      </Routes>
    </AuthProvider>
  );
}
