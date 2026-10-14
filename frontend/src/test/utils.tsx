import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { AuthProvider } from "../auth/AuthContext";
import type { Operator } from "../api/types";

export const DEFAULT_ADMIN: Operator = {
  id: "1",
  username: "admin",
  role: "admin",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

/**
 * Render a routed page with the auth provider and a stubbed `fetch`.
 *
 * `/api/auth/me` is always answered here, so a page's own `fetchImpl` never has
 * to know about the AuthProvider handshake. `operator` defaults to an admin;
 * pass `operator: null` for a session the provider should fail to load.
 */
export function renderWithProviders(
  ui: ReactNode,
  opts: {
    route?: string;
    operator?: Operator | null;
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  } = {},
) {
  const operator = opts.operator === undefined ? DEFAULT_ADMIN : opts.operator;

  // AuthProvider only calls /api/auth/me when a token is present, so the helper
  // owns the token as well as the response: a session needs both. Passing
  // `operator: null` therefore means "no session" and clears any token.
  if (operator) {
    localStorage.setItem("hf_token", "test-jwt");
  } else {
    localStorage.removeItem("hf_token");
  }

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/auth/me")) return jsonResponse(operator);
      return opts.fetchImpl
        ? opts.fetchImpl(url, init)
        : jsonResponse({ items: [], total: 0 });
    }),
  );

  return render(
    <MemoryRouter initialEntries={[opts.route ?? "/"]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}
