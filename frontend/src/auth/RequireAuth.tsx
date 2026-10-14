import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

/** Gate a route on a loaded operator. Renders nothing while the session loads. */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { operator, loading } = useAuth();

  if (loading) return null;
  if (!operator) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
