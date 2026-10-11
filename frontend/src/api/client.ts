export const apiBase: string =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

// S2 stand-in for operator auth. Ships in the bundle — perimeter-only until S4
// replaces it with a JWT login. Documented, not hidden.
export const operatorToken: string =
  import.meta.env.VITE_OPERATOR_TOKEN ?? "";

export function authHeaders(): Record<string, string> {
  return operatorToken
    ? { Authorization: `Bearer ${operatorToken}` }
    : {};
}

/** Fetch a control-center REST path with the operator token attached. */
export async function apiFetch(path: string): Promise<Response> {
  return fetch(`${apiBase}${path}`, { headers: authHeaders() });
}