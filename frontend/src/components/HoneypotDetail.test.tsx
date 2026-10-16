import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import HoneypotDetail from "./HoneypotDetail";
import { jsonResponse } from "../test/utils";

afterEach(() => vi.unstubAllGlobals());

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

it("fetches the honeypot once on mount and renders its fields", async () => {
  const fetchMock = vi.fn(async (_url: string) => jsonResponse(HP));
  vi.stubGlobal("fetch", fetchMock);

  render(<HoneypotDetail honeypotId={HP.id} />);

  expect(await screen.findByText("low-1")).toBeTruthy();
  expect(screen.getByText("Name")).toBeTruthy();
  expect(screen.getByText("Status")).toBeTruthy();
  expect(screen.getByText("online")).toBeTruthy();
  expect(screen.getByText("Profile")).toBeTruthy();
  expect(screen.getByText("low v2")).toBeTruthy();
  expect(screen.getByText("Config version")).toBeTruthy();
  expect(screen.getByText("v2")).toBeTruthy();
  expect(screen.getByText("Last seen")).toBeTruthy();
  expect(screen.getByText("2026-01-01T12:00:00.000Z")).toBeTruthy();
  expect(screen.getByText("Created")).toBeTruthy();
  expect(screen.getByText("2026-01-01T00:00:00.000Z")).toBeTruthy();

  // One request, to this honeypot's own URL: no polling, no list refetch.
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toContain(
    `/api/honeypots/${HP.id}`,
  );
});

it("flags drift when the agent's config is behind the profile", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...HP, config_version: 1 })));

  render(<HoneypotDetail honeypotId={HP.id} />);

  expect(
    await screen.findByText("Config outdated (agent v1 of v2)"),
  ).toBeTruthy();
});

it("does not flag drift when the agent matches the profile version", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(HP)));

  render(<HoneypotDetail honeypotId={HP.id} />);

  expect(await screen.findByText("low-1")).toBeTruthy();
  expect(screen.queryByText(/Config outdated/)).toBeNull();
});

it("does not flag drift when the agent reports a newer config", async () => {
  // Only `<` is drift: a numerically newer version is not an outdated agent.
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...HP, config_version: 3 })));

  render(<HoneypotDetail honeypotId={HP.id} />);

  expect(await screen.findByText("low-1")).toBeTruthy();
  expect(screen.queryByText(/Config outdated/)).toBeNull();
});

it("shows a loading state until the fetch resolves", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

  render(<HoneypotDetail honeypotId={HP.id} />);

  expect(screen.getByText(/loading/i)).toBeTruthy();
});

it("renders an error and no fields when the fetch fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));

  render(<HoneypotDetail honeypotId={HP.id} />);

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("low-1")).toBeNull();
  expect(screen.queryByText("Status")).toBeNull();
  expect(screen.queryByText("Config version")).toBeNull();
});
