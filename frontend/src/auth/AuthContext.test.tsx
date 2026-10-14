import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext";
import { tokenStore } from "../api/client";
import { jsonResponse } from "../test/utils";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Answers /api/auth/me with `response`; every other call is not expected. */
function stubMe(response: Response | (() => Promise<Response>)) {
  vi.stubGlobal(
    "fetch",
    vi.fn(typeof response === "function" ? response : async () => response),
  );
  tokenStore.set("test-jwt");
}

function Probe() {
  const { operator, loading } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>{operator ? `signed in as ${operator.username}` : "no session"}</div>;
}

it("keeps the token when /api/auth/me fails for a non-auth reason", async () => {
  // A restarting backend or a dropped connection answers 5xx/throws; that is a
  // blip, not a logout, so the stored session must survive it.
  stubMe(jsonResponse({ detail: "boom" }, 500));
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

  expect(await screen.findByText("no session")).toBeTruthy();
  expect(tokenStore.get()).toBe("test-jwt");
});

it("clears the token when the session is actually rejected", async () => {
  stubMe(jsonResponse({ detail: "nope" }, 401));
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

  expect(await screen.findByText("no session")).toBeTruthy();
  await waitFor(() => expect(tokenStore.get()).toBeNull());
});
