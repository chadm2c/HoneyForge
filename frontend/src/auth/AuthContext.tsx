import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  AUTH_EXPIRED_EVENT,
  getMe,
  login as apiLogin,
  tokenStore,
} from "../api/client";
import type { Operator } from "../api/types";

export interface AuthValue {
  operator: Operator | null;
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<Operator | null>(null);
  // Only a stored token can produce a session, so that is the only case worth
  // showing a loading state for. Without one RequireAuth can redirect at once.
  const [loading, setLoading] = useState<boolean>(() => tokenStore.get() !== null);

  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    getMe()
      .then((me) => {
        if (!cancelled) setOperator(me);
      })
      .catch(() => {
        // A rejected /api/auth/me means the token is gone or no longer valid.
        if (!cancelled) {
          tokenStore.clear();
          setOperator(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setOperator(null);
  }, []);

  // The API client clears the token itself on a 401 and dispatches this; the
  // provider only has to drop the operator so routing redirects to /login.
  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, logout);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, logout);
  }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiLogin(username, password);
    tokenStore.set(res.access_token);
    setOperator(res.operator);
  }, []);

  const value = useMemo(
    () => ({ operator, loading, login, logout }),
    [operator, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
