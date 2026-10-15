import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Button from "./Button";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import LoadingText from "./LoadingText";
import Panel from "./Panel";
import Table, { Td, Th } from "./Table";

it("ErrorState announces itself with role=alert and renders its message", () => {
  render(<ErrorState>Could not load events</ErrorState>);

  const alert = screen.getByRole("alert");
  expect(alert.tagName).toBe("P");
  expect(alert.textContent).toBe("Could not load events");
});

it("ErrorState keeps page-specific spacing via className", () => {
  render(<ErrorState className="mt-4">no</ErrorState>);

  expect(screen.getByRole("alert").className).toContain("mt-4");
});

it("Button renders a button and forwards disabled", () => {
  render(
    <Button variant="primary" disabled>
      Register
    </Button>,
  );

  const button = screen.getByRole("button", { name: "Register" });
  expect(button.tagName).toBe("BUTTON");
  expect((button as HTMLButtonElement).disabled).toBe(true);
});

it("LoadingText without children renders exactly the default text", () => {
  render(<LoadingText />);

  expect(screen.getByText("Loading…").textContent).toBe("Loading…");
});

it("Panel renders a heading only when given a title", () => {
  const { rerender } = render(<Panel>body</Panel>);
  expect(screen.queryByRole("heading")).toBeNull();

  rerender(<Panel title="Register honeypot">body</Panel>);
  expect(screen.getByRole("heading").textContent).toBe("Register honeypot");
});

it("EmptyState renders a paragraph carrying its children", () => {
  render(<EmptyState>No profiles defined yet.</EmptyState>);

  const empty = screen.getByText("No profiles defined yet.");
  expect(empty.tagName).toBe("P");
});

it("Table, Th and Td render the table, columnheader and cell roles", () => {
  render(
    <Table>
      <thead>
        <tr>
          <Th>Name</Th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <Td>low-1</Td>
        </tr>
      </tbody>
    </Table>,
  );

  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getByRole("columnheader").textContent).toBe("Name");
  expect(screen.getByRole("cell").textContent).toBe("low-1");
});
