import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    // Needed for temporary Cloudflare quick-tunnel phone testing.
    // The server still binds only to localhost; cloudflared is the public edge.
    allowedHosts: true,
  },
});
