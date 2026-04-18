import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/v2/",
  build: {
    emptyOutDir: true,
    outDir: "../web/dist/v2"
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174
  }
});
