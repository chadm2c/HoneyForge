import { afterEach, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import RequireAuth from "./RequireAuth";
import { renderWithProviders } from "../test/utils";

afterEach(() => vi.unstubAllGlobals());

it("redirects to /login when there is no token", async () => {
  localStorage.clear();
  renderWithProviders(
    <Routes>
      <Route
        path="/fleet"
        element={
          <RequireAuth>
            <div>fleet page</div>
          </RequireAuth>
        }
      />
      <Route path="/login" element={<div>login page</div>} />
    </Routes>,
    { route: "/fleet" },
  );

  expect(await screen.findByText("login page")).toBeTruthy();
});

it("renders children once the operator is loaded", async () => {
  localStorage.setItem("hf_token", "jwt");
  renderWithProviders(
    <Routes>
      <Route
        path="/fleet"
        element={
          <RequireAuth>
            <div>fleet page</div>
          </RequireAuth>
        }
      />
    </Routes>,
    {
      route: "/fleet",
      operator: { id: "1", username: "admin", role: "admin" },
    },
  );

  expect(await screen.findByText("fleet page")).toBeTruthy();
});
