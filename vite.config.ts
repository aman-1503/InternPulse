import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

// The Cloudflare plugin reads wrangler.jsonc, runs the Worker + Durable Object
// in a local workerd runtime during `vite dev`, and wires the React build into
// the Workers assets runtime for `vite build` / `wrangler deploy`.
export default defineConfig({
  plugins: [tailwindcss(), react(), cloudflare()],
});
