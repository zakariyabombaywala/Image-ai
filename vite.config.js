import { defineConfig, loadEnv } from "vite";
import { createApiMiddleware } from "./server/proxy.js";

export default defineConfig(({ mode }) => {
  // Load all .env vars (no VITE_ prefix) so the key stays server-side only.
  const env = loadEnv(mode, process.cwd(), "");
  const api = createApiMiddleware(env.POLLINATIONS_API_KEY);

  return {
    plugins: [
      {
        name: "image-api",
        configureServer: (server) => { server.middlewares.use(api); },
        configurePreviewServer: (server) => { server.middlewares.use(api); },
      },
    ],
    server: {
      port: 5173,
      open: true, // open the browser automatically on `pnpm dev`
    },
    preview: {
      port: 4173,
      open: true,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
