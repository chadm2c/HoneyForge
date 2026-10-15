import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import EventDetail from "./EventDetail";
import type { AttackEvent } from "../api/types";

function makeEvent(overrides: Partial<AttackEvent> = {}): AttackEvent {
  return {
    id: "e1",
    honeypot_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    event_type: "auth_attempt",
    source_ip: "203.0.113.5",
    source_port: 51000,
    target_port: 8080,
    protocol: "http",
    details: { username: "admin" },
    occurred_at: "2026-01-01T12:00:00Z",
    received_at: "2026-01-01T12:00:01Z",
    ...overrides,
  };
}

it("renders occurred and received as distinct, labelled, valued rows", () => {
  render(<EventDetail event={makeEvent()} honeypotName="low-1" />);

  expect(screen.getByText("Occurred at")).toBeTruthy();
  expect(screen.getByText("2026-01-01T12:00:00.000Z")).toBeTruthy();
  expect(screen.getByText("Received at")).toBeTruthy();
  expect(screen.getByText("2026-01-01T12:00:01.000Z")).toBeTruthy();
});

it("renders the summary rows including the resolved honeypot name", () => {
  render(<EventDetail event={makeEvent()} honeypotName="low-1" />);

  expect(screen.getByText("Type")).toBeTruthy();
  expect(screen.getByText("auth_attempt")).toBeTruthy();
  expect(screen.getByText("Protocol")).toBeTruthy();
  expect(screen.getByText("HTTP")).toBeTruthy();
  expect(screen.getByText("Honeypot")).toBeTruthy();
  expect(screen.getByText("low-1")).toBeTruthy();
  expect(screen.getByText("203.0.113.5:51000")).toBeTruthy();
  expect(screen.getByText("8080")).toBeTruthy();
});

it("falls back to the raw honeypot id when no name is supplied", () => {
  render(<EventDetail event={makeEvent()} />);

  expect(screen.getByText("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBeTruthy();
});

it("renders an em dash for a null source ip and target port", () => {
  render(
    <EventDetail
      event={makeEvent({ source_ip: null, source_port: null, target_port: null })}
    />,
  );

  // Source and Target port both degrade to the em dash.
  expect(screen.getAllByText("—")).toHaveLength(2);
});

it("renders details as labelled rows", () => {
  render(<EventDetail event={makeEvent({ details: { username: "admin" } })} />);

  expect(screen.getByText("Details")).toBeTruthy();
  expect(screen.getByText("username")).toBeTruthy();
  expect(screen.getByText("admin")).toBeTruthy();
});

it("renders object, array and null detail values without throwing", () => {
  render(
    <EventDetail
      event={makeEvent({
        details: { meta: { a: 1 }, tags: ["x", "y"], notes: null },
      })}
    />,
  );

  expect(screen.getByText("meta")).toBeTruthy();
  expect(screen.getByText('{"a":1}')).toBeTruthy();
  expect(screen.getByText("tags")).toBeTruthy();
  expect(screen.getByText('["x","y"]')).toBeTruthy();
  expect(screen.getByText("notes")).toBeTruthy();
  expect(screen.getByText("null")).toBeTruthy();
});

it("adds no details block when the details map is empty", () => {
  render(<EventDetail event={makeEvent({ details: {} })} />);

  expect(screen.queryByText("Details")).toBeNull();
});
