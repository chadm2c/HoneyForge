import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ConnectionBadge from "./ConnectionBadge";

afterEach(cleanup);

it("renders the connecting label for the initial state", () => {
  const { container } = render(<ConnectionBadge status="connecting" />);

  expect(screen.getByText("connecting")).toBeTruthy();
  // The honest initial state must not claim the socket is live or recovering.
  expect(screen.queryByText("live")).toBeNull();
  expect(screen.queryByText("reconnecting")).toBeNull();
  // Exactly the label, no extra text.
  expect(container.textContent).toBe("connecting");
});

it("renders the live label when the socket is open", () => {
  const { container } = render(<ConnectionBadge status="live" />);

  expect(screen.getByText("live")).toBeTruthy();
  expect(screen.queryByText("connecting")).toBeNull();
  expect(screen.queryByText("reconnecting")).toBeNull();
  expect(container.textContent).toBe("live");
});

it("renders the reconnecting label after the socket closes", () => {
  const { container } = render(<ConnectionBadge status="reconnecting" />);

  expect(screen.getByText("reconnecting")).toBeTruthy();
  expect(screen.queryByText("connecting")).toBeNull();
  expect(screen.queryByText("live")).toBeNull();
  expect(container.textContent).toBe("reconnecting");
});

it("is not an alert: a connection status is not an error state", () => {
  render(<ConnectionBadge status="reconnecting" />);

  expect(screen.queryByRole("alert")).toBeNull();
});
