import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import App from "./App";
import { renderWithProviders, jsonResponse } from "./test/utils";

// The authenticated route tree now mounts the Overview at "/", which opens a
// WebSocket. jsdom has no usable WebSocket, so install a drivable fake; the
// unknown-path test lands on the Overview, so its route needs this too.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

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
  expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy();

  // The root link is not current on a sibling route. `end` is redundant for "/"
  // in this router version but makes the exact-root match explicit; this pins
  // the invariant regardless.
  expect(screen.getByRole("link", { name: "Fleet" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(
    screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current"),
  ).toBeNull();
});

it("lands an unknown path on the Overview, not the Fleet page", async () => {
  const { container } = renderWithProviders(<App />, {
    route: "/nope",
    fetchImpl: appFetch,
  });

  // A string unique to the Overview's successful-but-empty state. The Overview
  // nav link renders on every page, so it would prove nothing here.
  expect(await screen.findByText("All 0 events in the last 24h")).toBeTruthy();
  expect(container.textContent).not.toContain("No honeypots registered yet.");
});
