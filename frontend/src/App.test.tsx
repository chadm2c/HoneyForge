import { afterEach, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import App from "./App";
import { renderWithProviders, jsonResponse } from "./test/utils";

afterEach(() => vi.unstubAllGlobals());

/** Answers every collection the mounted pages ask for. */
function appFetch(url: string): Promise<Response> {
  const target = String(url);
  if (target.includes("/api/honeypots") || target.includes("/api/profiles")) {
    return Promise.resolve(jsonResponse([]));
  }
  return Promise.resolve(jsonResponse({ items: [], total: 0 }));
}

// Exercises the whole route tree, which no page-level test does. React Router
// resolves nested route config at render time, so a bad path here would only
// ever surface in the browser.
it("sends an anonymous visitor to the login page", async () => {
  renderWithProviders(<App />, { route: "/fleet", operator: null });

  expect(await screen.findByLabelText(/username/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
});

it("renders the shell nav for a signed-in operator", async () => {
  renderWithProviders(<App />, { route: "/fleet", fetchImpl: appFetch });
  expect(await screen.findByRole("link", { name: "Profiles" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Audit" })).toBeTruthy();
});
