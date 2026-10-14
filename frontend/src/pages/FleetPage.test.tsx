import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import FleetPage from "./FleetPage";
import { jsonResponse, renderWithProviders } from "../test/utils";

afterEach(() => vi.unstubAllGlobals());

const PROFILE = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "low",
  interaction_level: "low",
  version: 2,
  updated_at: "2026-01-02T00:00:00Z",
};

// The honeypot is named "low-1" rather than "low" on purpose: the row also
// renders the interaction level, so a honeypot called "low" would put the exact
// text "low" in two cells and make the name assertion ambiguous.
const HP = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "low-1",
  profile_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  profile: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "low",
    interaction_level: "low",
    version: 2,
  },
  config_version: 2,
  status: "online",
  last_seen_at: "2026-01-01T12:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
};

// /api/profiles must answer with a bare list, not the {items,total} page shape:
// FleetPage renders the profiles as <option>s, so a page object would throw.
function fleetFetch(url: string): Promise<Response> {
  const target = String(url);
  if (target.includes("/api/honeypots")) return Promise.resolve(jsonResponse([HP]));
  if (target.includes("/api/profiles")) return Promise.resolve(jsonResponse([PROFILE]));
  return Promise.resolve(jsonResponse({ items: [], total: 0 }));
}

it("lists honeypots with derived status and profile version", async () => {
  renderWithProviders(<FleetPage />, { route: "/fleet", fetchImpl: fleetFetch });

  expect(await screen.findByText("low-1")).toBeTruthy();
  expect(screen.getByText("online")).toBeTruthy();
  expect(screen.getByText(/v2/)).toBeTruthy();
});

it("shows a never-seen agent as never rather than offline", async () => {
  const fresh = { ...HP, id: "cc", name: "medium-1", status: "never", last_seen_at: null };
  renderWithProviders(<FleetPage />, {
    route: "/fleet",
    fetchImpl: async () => jsonResponse([fresh]),
  });

  expect(await screen.findByText("never")).toBeTruthy();
});

it("hides the register form from analysts", async () => {
  renderWithProviders(<FleetPage />, {
    route: "/fleet",
    operator: { id: "2", username: "an", role: "analyst" },
    fetchImpl: fleetFetch,
  });

  expect(await screen.findByText("low-1")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /register/i })).toBeNull();
});

it("reveals the agent token exactly once after an admin registers", async () => {
  renderWithProviders(<FleetPage />, {
    route: "/fleet",
    fetchImpl: async (url, init) => {
      const target = String(url);
      if (target.includes("/api/honeypots/register") && init?.method === "POST") {
        return jsonResponse({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          name: "hp2",
          profile_id: PROFILE.id,
          agent_token: "tok-123",
        });
      }
      if (target.includes("/api/honeypots")) return jsonResponse([HP]);
      if (target.includes("/api/profiles")) return jsonResponse([PROFILE]);
      return jsonResponse({ items: [], total: 0 });
    },
  });

  fireEvent.change(await screen.findByLabelText(/name/i), {
    target: { value: "hp2" },
  });
  fireEvent.change(screen.getByLabelText(/profile/i), {
    target: { value: PROFILE.id },
  });
  fireEvent.click(screen.getByRole("button", { name: /register/i }));

  expect(await screen.findByText("tok-123")).toBeTruthy();
  expect(screen.getByText(/will not be shown again/i)).toBeTruthy();
});
