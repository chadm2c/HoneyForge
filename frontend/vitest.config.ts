import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Standalone vitest config. Kept separate because vitest 2.x bundles its own
// vite copy, which breaks plugin typings when mixed into vite.config.ts.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});