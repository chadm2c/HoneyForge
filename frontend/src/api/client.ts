import type {
  AuditLog,
  AuditQuery,
  EventPage,
  EventQuery,
  Honeypot,
  HoneypotRegistered,
  Operator,
  Page,
  Profile,
  ProfileSummary,
  TokenResponse,
} from "./types";

export const apiBase: string =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

// The access token lives in localStorage. That is a deliberate S4 trade-off:
// readable by any script on the page, so it is a perimeter control for the
// demo, not an XSS-resistant session. Documented in the threat model.
const TOKEN_KEY = "hf_token";

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      // Storage can be unavailable (private mode / disabled cookies).
      return null;
    }
  },
  set(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
  },
};

/**
 * Dispatched on `window` whenever a request comes back 401. AuthContext listens
 * for it, so the client never has to know React exists.
 */
export const AUTH_EXPIRED_EVENT = "hf:auth-expired";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Fetch a control-center path with the stored bearer token attached. */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = tokenStore.get();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${apiBase}${path}`, { ...init, headers });
  if (res.status === 401) {
    tokenStore.clear();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  return res;
}

export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new ApiError(res.status, `request failed: ${res.status}`);
  // 204 has no body, and res.json() would reject on the empty stream.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Build a query string from the params that are actually set. */
function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function login(
  username: string,
  password: string,
): Promise<TokenResponse> {
  return apiJson<TokenResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function getMe(): Promise<Operator> {
  return apiJson<Operator>("/api/auth/me");
}

export function listProfiles(): Promise<ProfileSummary[]> {
  return apiJson<ProfileSummary[]>("/api/profiles");
}

export function getProfile(id: string): Promise<Profile> {
  return apiJson<Profile>(`/api/profiles/${id}`);
}

export function createProfile(input: {
  name: string;
  interaction_level: string;
  config: Record<string, unknown>;
}): Promise<Profile> {
  return apiJson<Profile>("/api/profiles", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProfile(
  id: string,
  patch: Partial<{
    name: string;
    interaction_level: string;
    config: Record<string, unknown>;
  }>,
): Promise<Profile> {
  return apiJson<Profile>(`/api/profiles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** DELETE returns 204, so it goes through apiFetch rather than apiJson. */
export async function deleteProfile(id: string): Promise<void> {
  const res = await apiFetch(`/api/profiles/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, `request failed: ${res.status}`);
}

export function listHoneypots(): Promise<Honeypot[]> {
  return apiJson<Honeypot[]>("/api/honeypots");
}

export function registerHoneypot(input: {
  name: string;
  profile_id: string;
}): Promise<HoneypotRegistered> {
  return apiJson<HoneypotRegistered>("/api/honeypots/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listEvents(params: EventQuery = {}): Promise<EventPage> {
  return apiJson<EventPage>(`/api/events${queryString(params)}`);
}

export function listAuditLogs(
  params: AuditQuery = {},
): Promise<Page<AuditLog>> {
  return apiJson<Page<AuditLog>>(`/api/audit-logs${queryString(params)}`);
}
