import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import EventsPage from "./EventsPage";
import { jsonResponse, renderWithProviders } from "../test/utils";

afterEach(() => vi.unstubAllGlobals());

// The page renders <EventFeed/>, which opens a WebSocket. jsdom's WebSocket
// would attempt a real connection, so stub it out.
class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(): void {}
  close(): void {}
}

const EVENT = {
  id: "e1",
  honeypot_id: "h",
  event_type: "auth_attempt",
  source_ip: "203.0.113.5",
  source_port: 51000,
  target_port: 8080,
  protocol: "http",
  details: { username: "admin" },
  occurred_at: "2026-01-01T12:00:00Z",
  received_at: "2026-01-01T12:00:01Z",
};

it("renders a filtered page of events with the total", async () => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  renderWithProviders(<EventsPage />, {
    route: "/events",
    fetchImpl: async (url) => {
      if (String(url).includes("/api/events?")) {
        return jsonResponse({ items: [EVENT], total: 1 });
      }
      if (String(url).includes("/api/honeypots")) return jsonResponse([]);
      return jsonResponse({ items: [], total: 0 });
    },
  });

  expect(await screen.findByText("auth_attempt")).toBeTruthy();
  expect(screen.getByText(/203\.0\.113\.5/)).toBeTruthy();
});

it("sends a typed filter to the API", async () => {
  const urls: string[] = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  renderWithProviders(<EventsPage />, {
    route: "/events",
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes("/api/honeypots")) return jsonResponse([]);
      return jsonResponse({ items: [], total: 0 });
    },
  });

  const typeInput = await screen.findByLabelText(/event type/i);
  fireEvent.change(typeInput, { target: { value: "scan" } });

  await vi.waitFor(() => {
    expect(urls.some((u) => u.includes("event_type=scan"))).toBe(true);
  });
});

it("converts a local date filter to UTC before sending it", async () => {
  const urls: string[] = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  renderWithProviders(<EventsPage />, {
    route: "/events",
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes("/api/honeypots")) return jsonResponse([]);
      return jsonResponse({ items: [], total: 0 });
    },
  });

  const since = await screen.findByLabelText(/since/i);
  fireEvent.change(since, { target: { value: "2026-01-01T12:00" } });

  await vi.waitFor(() => {
    // The exact instant depends on the host timezone; the zone must not.
    expect(
      urls.some((u) => /since=\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}%3A\d{2}\.\d{3}Z/.test(u)),
    ).toBe(true);
  });
});

it("pages forward by the page size and records the total", async () => {
  const urls: string[] = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  renderWithProviders(<EventsPage />, {
    route: "/events",
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes("/api/honeypots")) return jsonResponse([]);
      return jsonResponse({ items: [EVENT], total: 120 });
    },
  });

  expect(await screen.findByText(/120/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /next/i }));

  await vi.waitFor(() => {
    expect(urls.some((u) => u.includes("offset=50"))).toBe(true);
  });
});

it("does not print an impossible range when the page is empty", async () => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  renderWithProviders(<EventsPage />, {
    route: "/events",
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes("/api/honeypots")) return jsonResponse([]);
      // The second page comes back empty while the total still claims rows, so
      // the label must not read "51-50 of 120".
      return u.includes("offset=50")
        ? jsonResponse({ items: [], total: 120 })
        : jsonResponse({ items: [EVENT], total: 120 });
    },
  });

  await screen.findByText(/of 120/);
  fireEvent.click(screen.getByRole("button", { name: /next/i }));

  expect(await screen.findByText("No events")).toBeTruthy();
});

it("reveals a row's details only when asked", async () => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  renderWithProviders(<EventsPage />, {
    route: "/events",
    fetchImpl: async (url) => {
      if (String(url).includes("/api/events?")) {
        return jsonResponse({ items: [EVENT], total: 1 });
      }
      if (String(url).includes("/api/honeypots")) return jsonResponse([]);
      return jsonResponse({ items: [], total: 0 });
    },
  });

  fireEvent.click(await screen.findByRole("button", { name: /details/i }));

  expect(await screen.findByText(/"username"/)).toBeTruthy();
});
