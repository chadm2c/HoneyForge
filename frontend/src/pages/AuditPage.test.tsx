import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import AuditPage from "./AuditPage";
import { jsonResponse, renderWithProviders } from "../test/utils";

afterEach(() => vi.unstubAllGlobals());

const ROWS = [
  {
    id: 2,
    operator_id: "1",
    action: "profile_updated",
    resource_type: "profile",
    resource_id: "p1",
    created_at: "2026-01-02T00:00:00Z",
  },
  {
    id: 1,
    operator_id: "1",
    action: "login",
    resource_type: "operator",
    resource_id: "1",
    created_at: "2026-01-01T00:00:00Z",
  },
];

function auditFetch(url: string): Promise<Response> {
  if (String(url).includes("/api/audit-logs")) {
    return Promise.resolve(jsonResponse({ items: ROWS, total: 2 }));
  }
  return Promise.resolve(jsonResponse({ items: [], total: 0 }));
}

it("lists audit rows newest first with their action", async () => {
  renderWithProviders(<AuditPage />, { route: "/audit", fetchImpl: auditFetch });

  expect(await screen.findByText("profile_updated")).toBeTruthy();
  expect(screen.getByText("login")).toBeTruthy();
});

it("attributes a row with no operator to the system", async () => {
  renderWithProviders(<AuditPage />, {
    route: "/audit",
    fetchImpl: async () =>
      jsonResponse({
        items: [{ ...ROWS[1], id: 3, operator_id: null, action: "login_failed" }],
        total: 1,
      }),
  });

  expect(await screen.findByText("system")).toBeTruthy();
});

it("sends a typed action filter to the API", async () => {
  const urls: string[] = [];
  renderWithProviders(<AuditPage />, {
    route: "/audit",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse({ items: ROWS, total: 2 });
    },
  });

  const action = await screen.findByLabelText(/action/i);
  fireEvent.change(action, { target: { value: "login_failed" } });

  await vi.waitFor(() => {
    expect(urls.some((u) => u.includes("action=login_failed"))).toBe(true);
  });
});

it("pages forward by the page size", async () => {
  const urls: string[] = [];
  renderWithProviders(<AuditPage />, {
    route: "/audit",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse({ items: ROWS, total: 120 });
    },
  });

  expect(await screen.findByText(/120/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /next/i }));

  await vi.waitFor(() => {
    expect(urls.some((u) => u.includes("offset=50"))).toBe(true);
  });
});
