import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import LoginPage from "./LoginPage";
import { jsonResponse, renderWithProviders } from "../test/utils";

afterEach(() => vi.unstubAllGlobals());

it("posts credentials and stores the returned token", async () => {
  localStorage.clear();
  // The login handler goes through renderWithProviders' fetchImpl rather than a
  // separate vi.stubGlobal: renderWithProviders installs the fetch stub itself,
  // so a stub taken before the render would simply be replaced.
  renderWithProviders(<LoginPage />, {
    route: "/login",
    fetchImpl: async (url) =>
      String(url).endsWith("/api/auth/login")
        ? jsonResponse({
            access_token: "new-jwt",
            token_type: "bearer",
            expires_in: 3600,
            operator: { id: "1", username: "admin", role: "admin" },
          })
        : jsonResponse({ items: [], total: 0 }),
  });

  fireEvent.change(screen.getByLabelText(/username/i), {
    target: { value: "admin" },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: "secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

  await vi.waitFor(() =>
    expect(localStorage.getItem("hf_token")).toBe("new-jwt"),
  );
});
