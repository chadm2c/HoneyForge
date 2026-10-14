import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// React Testing Library only registers its own auto-cleanup when `afterEach` is
// a global, and this project imports test APIs from `vitest` explicitly. Without
// this, every render in a file accumulates in document.body and any query that
// should match one element starts matching one per test instead.
afterEach(() => {
  cleanup();
});
