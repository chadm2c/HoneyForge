import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// React Testing Library only registers its own auto-cleanup when `afterEach` is
// a global, and this project imports test APIs from `vitest` explicitly. Without
// this, every render in a file accumulates in document.body and any query that
// should match one element starts matching one per test instead.
afterEach(() => {
  cleanup();
});

// The default 1s budget for async queries is too tight here: vitest runs many
// jsdom environments at once on a Windows host, and a loaded full-suite run has
// been observed letting a findBy* miss its window while passing in isolation.
configure({ asyncUtilTimeout: 5000 });
