import { afterEach, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import App from "./App";
import { renderWithProviders } from "./test/utils";

afterEach(() => vi.unstubAllGlobals());

// Exercises the whole route tree, which no page-level test does. React Router
// resolves nested route config at render time, so a bad path here would only
// ever surface in the browser.
it("sends an anonymous visitor to the login page", async () => {
  localStorage.clear();

  renderWithProviders(<App />, { route: "/fleet" });

  expect(await screen.findByLabelText(/username/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
});

it("renders the shell nav for a signed-in operator", async () => {
  localStorage.setItem("hf_token", "jwt");

  renderWithProviders(<App />, { route: "/fleet" });

  // The nav is part of AppShell; its presence proves the protected group and
  // the <Outlet /> mounted, and that the placeholder route matched.
  expect(await screen.findByRole("link", { name: "Profiles" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Audit" })).toBeTruthy();
});
