import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import OverviewPage from "./OverviewPage";
import { jsonResponse, renderWithProviders } from "../test/utils";
import type { AttackEvent, Honeypot } from "../api/types";

// The page mounts `useOverviewData` -> `useEventStream`, which opens a
// WebSocket. jsdom has no usable WebSocket, so install a drivable fake; tests
// push frames through `FakeWebSocket.instances[0]`.
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

// Captured before any test mounts, so every generated event is *before* the
// window end the hook anchors at mount. An event stamped after mount would be
// "newer" than the window and excluded from the in-window count.
const NOW_MS = Date.now();

function makeEvent(
  id: string,
  msAgo = 60_000,
  overrides: Partial<AttackEvent> = {},
): AttackEvent {
  const at = new Date(NOW_MS - msAgo).toISOString();
  return {
    id,
    honeypot_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    event_type: "connection",
    source_ip: "192.0.2.1",
    source_port: 50000,
    target_port: 22,
    protocol: "tcp",
    details: {},
    occurred_at: at,
    received_at: at,
    ...overrides,
  };
}

function makeHoneypot(id: string, status: Honeypot["status"]): Honeypot {
  return {
    id,
    name: id,
    profile_id: "p1",
    profile: { id: "p1", name: "low", interaction_level: "low", version: 1 },
    config_version: 1,
    status,
    last_seen_at: null,
    created_at: new Date(NOW_MS).toISOString(),
  };
}

/** Locate a `Panel` by its title and return the panel root element. */
function panel(title: string): HTMLElement {
  return screen.getByText(title).parentElement as HTMLElement;
}

async function openSocket(index = 0): Promise<void> {
  await act(async () => {
    FakeWebSocket.instances[index].onopen?.();
  });
}

async function pushFrame(index: number, event: AttackEvent): Promise<void> {
  await act(async () => {
    FakeWebSocket.instances[index].onmessage?.({ data: JSON.stringify(event) });
  });
}

describe("OverviewPage golden path", () => {
  it("renders the fleet and event KPIs, the disclosure and the 24-bar chart", async () => {
    const { container } = renderWithProviders(<OverviewPage />, {
      route: "/",
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("/api/honeypots")) {
          return jsonResponse([
            makeHoneypot("h1", "online"),
            makeHoneypot("h2", "offline"),
            makeHoneypot("h3", "never"),
          ]);
        }
        return jsonResponse({
          items: [
            makeEvent("e1", 60_000, { source_ip: "192.0.2.1" }),
            makeEvent("e2", 120_000, { source_ip: "198.51.100.9" }),
          ],
          total: 2,
        });
      },
    });

    // The untruncated disclosure for a complete sample.
    await screen.findByText("All 2 events in the last 24h");

    expect(within(panel("Fleet")).getByText("3")).toBeTruthy();
    expect(
      within(panel("Fleet")).getByText("1 online · 1 offline · 1 never"),
    ).toBeTruthy();
    expect(within(panel("Events in window")).getByText("2")).toBeTruthy();
    expect(within(panel("Distinct sources")).getByText("2")).toBeTruthy();

    // The chart announces the disclosure verbatim and draws one bar per bucket.
    expect(
      screen.getByRole("img", {
        name: "Events per hour over the last 24h. All 2 events in the last 24h",
      }),
    ).toBeTruthy();
    expect(container.querySelectorAll("rect")).toHaveLength(24);
  });

  it("notes unattributed events beside the distinct-source count", async () => {
    renderWithProviders(<OverviewPage />, {
      route: "/",
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("/api/honeypots")) return jsonResponse([]);
        return jsonResponse({
          items: [
            makeEvent("e1", 60_000, { source_ip: "192.0.2.1" }),
            makeEvent("e2", 120_000, { source_ip: null }),
          ],
          total: 2,
        });
      },
    });

    const kpi = panel("Distinct sources");
    await waitFor(() => expect(within(kpi).getByText("1")).toBeTruthy());
    expect(within(kpi).getByText("(1 unattributed)")).toBeTruthy();
  });

  it("renders the truncated disclosure and the recovery note when capped", async () => {
    const { container } = renderWithProviders(<OverviewPage />, {
      route: "/",
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("/api/honeypots")) return jsonResponse([]);
        const offset = Number(new URL(u).searchParams.get("offset") ?? "0");
        const items = Array.from({ length: 200 }, (_, i) =>
          makeEvent(`e-${offset}-${i}`, 60_000 + (offset + i) * 1000),
        );
        return jsonResponse({ items, total: 700 });
      },
    });

    expect(
      await screen.findByText("Most recent 600 of 700 events in the last 24h"),
    ).toBeTruthy();
    // The window walk exhausted its three pages, so reconciliation is partial.
    expect(
      screen.getByText("history is partial — recovered the most recent 600 events"),
    ).toBeTruthy();
    expect(within(panel("Events in window")).getByText("600")).toBeTruthy();
    expect(container.querySelectorAll("rect")).toHaveLength(24);
  });

  it("shows the empty events state when the window has no events", async () => {
    renderWithProviders(<OverviewPage />, {
      route: "/",
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("/api/honeypots")) return jsonResponse([]);
        return jsonResponse({ items: [], total: 0 });
      },
    });

    // Five events-governed panels each report the genuine-empty state.
    expect((await screen.findAllByText("no events in the last 24h")).length).toBe(5);
    // A successful-but-empty fleet response may legitimately render zeros.
    expect(
      within(panel("Fleet")).getByText("0 online · 0 offline · 0 never"),
    ).toBeTruthy();
    expect(screen.getByText("All 0 events in the last 24h")).toBeTruthy();
  });
});

describe("OverviewPage live updates", () => {
  it("increments the count for a pushed live event without refetching", async () => {
    const events: string[] = [];
    renderWithProviders(<OverviewPage />, {
      route: "/",
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("/api/honeypots")) return jsonResponse([]);
        events.push(u);
        return jsonResponse({ items: [makeEvent("S1", 60_000)], total: 1 });
      },
    });

    await screen.findByText("All 1 events in the last 24h");
    const before = events.length;

    await openSocket(0);
    await pushFrame(0, makeEvent("L", 1_000));

    expect(within(panel("Events in window")).getByText("2")).toBeTruthy();
    expect(screen.getByText("All 2 events in the last 24h")).toBeTruthy();
    // A live frame moves the count with no REST: the socket is the update path.
    expect(events.length).toBe(before);
  });

  it("counts a live event that arrives during the in-flight initial request once", async () => {
    let resolveEvents!: (res: Response) => void;
    const inflight = new Promise<Response>((resolve) => {
      resolveEvents = resolve;
    });

    renderWithProviders(<OverviewPage />, {
      route: "/",
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("/api/honeypots")) return jsonResponse([]);
        return inflight;
      },
    });

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    await openSocket(0);
    // The shared event lands live while the REST response is still unresolved.
    await pushFrame(0, makeEvent("shared", 1_000));

    // The response also carries the shared id; the merge must count it once.
    await act(async () => {
      resolveEvents(
        jsonResponse({
          items: [makeEvent("S1", 60_000), makeEvent("shared", 1_000)],
          total: 2,
        }),
      );
    });

    await screen.findByText("All 2 events in the last 24h");
    expect(within(panel("Events in window")).getByText("2")).toBeTruthy();
  });
});

describe("OverviewPage partial failure", () => {
  it("shows the fleet error while the event panels still render", async () => {
    renderWithProviders(<OverviewPage />, {
      route: "/",
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("/api/honeypots")) throw new Error("network down");
        return jsonResponse({ items: [makeEvent("e1", 60_000)], total: 1 });
      },
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not load the fleet.");
    // The events half is independent and still renders its KPI and chart.
    expect(within(panel("Events in window")).getByText("1")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /Events per hour over the last 24h/ }),
    ).toBeTruthy();
    // A failed fleet request never renders as a zero.
    expect(screen.queryByText("0")).toBeNull();
  });

  it("keeps the fleet KPI while the event panels show errors, never a zero", async () => {
    renderWithProviders(<OverviewPage />, {
      route: "/",
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("/api/honeypots")) {
          return jsonResponse([
            makeHoneypot("h1", "online"),
            makeHoneypot("h2", "offline"),
            makeHoneypot("h3", "never"),
          ]);
        }
        throw new Error("network down");
      },
    });

    await waitFor(() =>
      expect(
        within(panel("Fleet")).getByText("1 online · 1 offline · 1 never"),
      ).toBeTruthy(),
    );
    expect(within(panel("Fleet")).getByText("3")).toBeTruthy();
    // Each of the five events-governed blocks carries the error independently.
    expect(screen.getAllByText("Could not load events.")).toHaveLength(5);
    // No block turned a failed request into a misleading zero.
    expect(screen.queryByText("0")).toBeNull();
  });

  it("shows two independent error states when both requests fail", async () => {
    renderWithProviders(<OverviewPage />, {
      route: "/",
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });

    expect(await screen.findByText("Could not load the fleet.")).toBeTruthy();
    expect(screen.getAllByText("Could not load events.").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("renders loading placeholders that are neither zero nor an error", async () => {
    // Neither request ever settles.
    renderWithProviders(<OverviewPage />, {
      route: "/",
      fetchImpl: () => new Promise<Response>(() => {}),
    });

    expect((await screen.findAllByText("Loading…")).length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("OverviewPage recovery", () => {
  it("shows the recovery note when a reconnect refetch fails", async () => {
    let eventCalls = 0;
    renderWithProviders(<OverviewPage />, {
      route: "/",
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("/api/honeypots")) return jsonResponse([]);
        eventCalls += 1;
        if (eventCalls === 1) {
          return jsonResponse({ items: [makeEvent("S1", 60_000)], total: 1 });
        }
        throw new Error("network down");
      },
    });

    await screen.findByText("All 1 events in the last 24h");

    // Drop the socket; after the jittered delay the hook reconnects and the
    // overview's reconciliation refetch fails.
    await act(async () => {
      FakeWebSocket.instances[0].onclose?.();
    });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2), {
      timeout: 5000,
    });
    await openSocket(1);

    expect(await screen.findByText("history could not be recovered")).toBeTruthy();
    // The stale sample survives and the badge still reads live.
    expect(screen.getByText("All 1 events in the last 24h")).toBeTruthy();
    expect(screen.getByText("live")).toBeTruthy();
  });
});
