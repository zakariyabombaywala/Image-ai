// Production server: serves the built site from dist/ and the /api proxy.
// Usage: pnpm build && pnpm start
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiMiddleware } from "./proxy.js";

try { process.loadEnvFile(); } catch { /* no .env file — rely on real env vars */ }

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const api = createApiMiddleware(process.env.POLLINATIONS_API_KEY);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

async function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  let file = normalize(join(DIST, pathname));
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(DIST, "index.html");
  }
  try {
    const body = await readFile(file);
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    if (file.includes(`${join("dist", "assets")}`)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("Not found — did you run `pnpm build`?");
  }
}

createServer((req, res) => api(req, res, () => serveStatic(req, res))).listen(PORT, () => {
  console.log(`Imagine running at http://localhost:${PORT}`);
  console.log(process.env.POLLINATIONS_API_KEY
    ? "Pollinations API key loaded."
    : "No POLLINATIONS_API_KEY set — running in free mode (watermark, 1 image at a time).");
});
