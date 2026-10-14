import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_EXPIRED_EVENT,
  ApiError,
  apiBase,
  apiFetch,
  apiJson,
  tokenStore,
} from "./client";

/** The headers apiFetch actually handed to fetch. */
function sentHeaders(fetchMock: ReturnType<typeof vi.fn>): Headers {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return new Headers(init.headers);
}

function okResponse(status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => ({}),
  } as unknown as Response;
}

beforeEach(() => {
  localStorage.clear();
  tokenStore.set("test-jwt");
});

afterEach(() => vi.unstubAllGlobals());

describe("tokenStore", () => {
  it("round-trips through localStorage under hf_token", () => {
    tokenStore.set("abc");
    expect(tokenStore.get()).toBe("abc");
    expect(localStorage.getItem("hf_token")).toBe("abc");
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });
});

describe("apiFetch", () => {
  it("attaches the stored bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/auth/me");

    expect(fetchMock.mock.calls[0][0]).toBe(`${apiBase}/api/auth/me`);
    // apiFetch passes a Headers instance (idiomatic fetch), so read it rather
    // than matching an own-property shape it does not have.
    expect(sentHeaders(fetchMock).get("Authorization")).toBe("Bearer test-jwt");
  });

  it("sets Content-Type for a JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ name: "p" }),
    });

    expect(sentHeaders(fetchMock).get("Content-Type")).toBe("application/json");
  });

  it("clears the token and signals expiry on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: "no" }),
      } as unknown as Response),
    );
    const onExpired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);

    // apiFetch is the raw layer and returns the 401 rather than throwing (only
    // apiJson throws), so the session side effect is what is asserted here.
    const res = await apiFetch("/api/events");

    expect(res.status).toBe(401);
    expect(tokenStore.get()).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  });

  it("apiJson surfaces a 401 as an ApiError carrying the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: "no" }),
      } as unknown as Response),
    );

    const error = await apiJson("/api/events").then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(tokenStore.get()).toBeNull();
  });
});

describe("apiJson", () => {
  it("returns undefined for 204 No Content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => {
          throw new Error("204 has no body");
        },
      } as unknown as Response),
    );

    await expect(apiJson("/api/profiles/x")).resolves.toBeUndefined();
  });

  it("throws ApiError carrying the status on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ detail: "nope" }),
      } as unknown as Response),
    );

    await expect(apiJson("/api/profiles")).rejects.toMatchObject({ status: 409 });
  });
});
