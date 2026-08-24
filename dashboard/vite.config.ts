import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    preserveSymlinks: true,
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  server: {
    proxy: {
      "/api": "http://localhost:3030",
      "/ws": {
        target: "ws://localhost:3030",
        ws: true,
      },
    },
  },
});
