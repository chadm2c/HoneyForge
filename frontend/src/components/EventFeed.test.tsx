import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import EventFeed from "./EventFeed";
import { BUFFER_LIMIT } from "../hooks/useEventStream";
import type { AttackEvent } from "../api/types";

/**
 * Fake WebSocket usable in jsdom: the app under test talks to it, and the test
 * drives onopen/onmessage/onclose exactly like a real server would.
 */
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

function makeEvent(id: string, ip: string, eventType = "connection"): AttackEvent {
  return {
    id,
    honeypot_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    event_type: eventType,
    source_ip: ip,
    source_port: 50000,
    target_port: 2222,
    protocol: "tcp",
    details: {},
    occurred_at: "2026-01-01T12:00:00Z",
    received_at: "2026-01-01T12:00:01Z",
  };
}

/**
 * Drop the current socket and drive the hook's own jittered reconnect (at
 * attempt 1 the delay is at most 1s, so a real-timer `waitFor` covers it).
 */
async function dropAndReopen(): Promise<void> {
  FakeWebSocket.instances[FakeWebSocket.instances.length - 1].onclose?.();
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2), {
    timeout: 3000,
  });
  FakeWebSocket.instances[1].onopen?.();
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

it("renders history, appends ws events, and dedupes by id", async () => {
  const history = [makeEvent("h1", "192.0.2.1"), makeEvent("h2", "192.0.2.2")];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: history, total: 2 }),
    } as Response)
  );

  render(<EventFeed />);

  const ws = FakeWebSocket.instances[0];
  expect(ws).toBeTruthy();
  expect(ws.url).toContain("/api/ws/events");

  // The badge reports the socket's own state: no open yet means "connecting".
  expect(screen.getByText("connecting")).toBeTruthy();

  // Server greets the client: auth-first handshake fires, then history loads.
  ws.onopen?.();
  expect(JSON.parse(ws.sent[0])).toMatchObject({ type: "auth" });
  // The socket is now open, so the badge reads "live".
  expect(await screen.findByText("live")).toBeTruthy();

  await screen.findByText("192.0.2.1");
  expect(screen.getByText("192.0.2.2")).toBeTruthy();

  // A new event arrives over the socket, then a duplicate of #h1.
  ws.onmessage?.({ data: JSON.stringify(makeEvent("h3", "198.51.100.5", "scan")) });
  ws.onmessage?.({ data: JSON.stringify(makeEvent("h1", "192.0.2.1")) });

  await waitFor(() => expect(screen.getByText("198.51.100.5")).toBeTruthy());

  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(3); // h1, h2 from history + h3, duplicate ignored
});

it("renders the capped gap-fill note beside a still-live badge", async () => {
  const history = [makeEvent("h1", "192.0.2.1")];
  // A full page (exactly BUFFER_LIMIT) whose total exceeds the cap is the
  // precise §11.3 condition that yields "capped".
  const fullPage = Array.from({ length: BUFFER_LIMIT }, (_, i) =>
    makeEvent(`m${i}`, "192.0.2.1", "scan")
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: history, total: 1 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: fullPage, total: BUFFER_LIMIT + 50 }),
      } as Response)
  );

  render(<EventFeed />);
  const first = FakeWebSocket.instances[0];
  first.onopen?.();
  expect(await screen.findByText("live")).toBeTruthy();
  await screen.findByText("192.0.2.1");

  await dropAndReopen();

  expect(
    await screen.findByText(
      `history is partial — recovered the most recent ${BUFFER_LIMIT} events`
    )
  ).toBeTruthy();
  // Recovery completeness is a separate axis: the socket is still live.
  expect(screen.getByText("live")).toBeTruthy();
});

it("renders the failed gap-fill note beside a still-live badge, with no alert", async () => {
  const history = [makeEvent("h1", "192.0.2.1")];
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: history, total: 1 }),
      } as Response)
      .mockRejectedValueOnce(new Error("network down"))
  );

  render(<EventFeed />);
  const first = FakeWebSocket.instances[0];
  first.onopen?.();
  expect(await screen.findByText("live")).toBeTruthy();
  await screen.findByText("192.0.2.1");

  await dropAndReopen();

  expect(await screen.findByText("history could not be recovered")).toBeTruthy();
  expect(screen.getByText("live")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});