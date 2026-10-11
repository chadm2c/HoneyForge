import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // Required for reliable HMR over Docker bind mounts on Windows.
    watch: { usePolling: true, interval: 300 },
  },
});