import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "~": resolve(__dirname, "./app"),
    },
  },
  plugins: [
    tanstackStart({ srcDirectory: "app" }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5800,
  },
});
