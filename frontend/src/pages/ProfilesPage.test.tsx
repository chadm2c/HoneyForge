import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import ProfilesPage from "./ProfilesPage";
import { jsonResponse, renderWithProviders } from "../test/utils";

afterEach(() => vi.unstubAllGlobals());

// Named "ssh-low" rather than "low": the row also shows the interaction level,
// so a profile called "low" would put the exact text "low" in two cells.
const PROFILE = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "ssh-low",
  interaction_level: "low",
  config: { ports: [2222], banner: "SSH-2.0-x" },
  version: 3,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

type Call = { url: string; init?: RequestInit };

it("shows profiles with their version and hides write controls for analysts", async () => {
  renderWithProviders(<ProfilesPage />, {
    route: "/profiles",
    operator: { id: "2", username: "an", role: "analyst" },
    fetchImpl: async () => jsonResponse([PROFILE]),
  });

  expect(await screen.findByText("ssh-low")).toBeTruthy();
  expect(screen.getByText(/v3/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /new profile/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
});

it("assembles a low-interaction config from the admin form", async () => {
  const calls: Call[] = [];
  renderWithProviders(<ProfilesPage />, {
    route: "/profiles",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse([PROFILE]);
    },
  });

  fireEvent.click(await screen.findByRole("button", { name: /new profile/i }));
  fireEvent.change(screen.getByLabelText(/^name$/i), {
    target: { value: "ssh-low" },
  });
  fireEvent.change(screen.getByLabelText(/ports/i), {
    target: { value: "2222, 2223" },
  });
  fireEvent.change(screen.getByLabelText(/banner/i), {
    target: { value: "SSH-2.0-x" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => {
    const post = calls.find((c) => c.init?.method === "POST");
    expect(post?.url).toContain("/api/profiles");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      name: "ssh-low",
      interaction_level: "low",
      config: { ports: [2222, 2223], banner: "SSH-2.0-x" },
    });
  });
});

it("loads a profile's config before editing and PATCHes the change", async () => {
  const calls: Call[] = [];
  renderWithProviders(<ProfilesPage />, {
    route: "/profiles",
    fetchImpl: async (url, init) => {
      const target = String(url);
      calls.push({ url: target, init });
      if (init?.method === "PATCH") return jsonResponse({ ...PROFILE, version: 4 });
      // The detail endpoint the edit form reads to get the config back.
      if (/\/api\/profiles\/[0-9a-f-]{36}$/.test(target)) {
        return jsonResponse(PROFILE);
      }
      return jsonResponse([PROFILE]);
    },
  });

  fireEvent.click(await screen.findByRole("button", { name: /^edit$/i }));

  const banner = (await screen.findByLabelText(/banner/i)) as HTMLInputElement;
  expect(banner.value).toBe("SSH-2.0-x");
  fireEvent.change(banner, { target: { value: "SSH-2.0-y" } });
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => {
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(patch?.url).toContain(PROFILE.id);
    expect(JSON.parse(String(patch?.init?.body))).toMatchObject({
      config: { banner: "SSH-2.0-y" },
    });
  });
});

it("reports an in-use profile on delete instead of failing silently", async () => {
  renderWithProviders(<ProfilesPage />, {
    route: "/profiles",
    fetchImpl: async (url, init) => {
      if (init?.method === "DELETE") return jsonResponse({ detail: "in use" }, 409);
      return jsonResponse([PROFILE]);
    },
  });

  fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
  fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));

  expect(await screen.findByText(/in use by a honeypot/i)).toBeTruthy();
});
