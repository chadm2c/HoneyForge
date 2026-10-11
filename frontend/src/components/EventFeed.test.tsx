import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import EventFeed from "./EventFeed";
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

  // Server greets the client: auth-first handshake fires, then history loads.
  ws.onopen?.();
  expect(JSON.parse(ws.sent[0])).toMatchObject({ type: "auth" });

  await screen.findByText("192.0.2.1");
  expect(screen.getByText("192.0.2.2")).toBeTruthy();

  // A new event arrives over the socket, then a duplicate of #h1.
  ws.onmessage?.({ data: JSON.stringify(makeEvent("h3", "198.51.100.5", "scan")) });
  ws.onmessage?.({ data: JSON.stringify(makeEvent("h1", "192.0.2.1")) });

  await waitFor(() => expect(screen.getByText("198.51.100.5")).toBeTruthy());

  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(3); // h1, h2 from history + h3, duplicate ignored
});