// Cloudflare Worker: serves the built site (dist/) and the /api proxy.
// Usage: pnpm cf:deploy   (see "Deploying" in README.md)
//
// The local model server can't run on Cloudflare, so this always uses Pollinations.
// POLLINATIONS_API_KEY is a Worker secret (`npx wrangler secret put POLLINATIONS_API_KEY`).

import { POLLINATIONS_MODELS } from "../server/proxy.js";

const KEYED_API = "https://gen.pollinations.ai/image/";
const FREE_API = "https://image.pollinations.ai/prompt/";

const clampInt = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function relay(upstream) {
  const type = upstream.headers.get("content-type") || "";
  if (upstream.ok && type.startsWith("image/")) {
    return new Response(upstream.body, {
      headers: { "Content-Type": type, "Cache-Control": "no-store" },
    });
  }
  const text = await upstream.text().catch(() => "");
  let body;
  try { body = JSON.parse(text); } catch { body = { detail: text.slice(0, 500) }; }
  if (upstream.status === 402 || upstream.status === 429) body.error = "rate_limited";
  return json(upstream.status === 200 ? 502 : upstream.status, {
    error: body.error || "upstream_error",
    detail: body.detail ?? body,
  });
}

async function image(url, apiKey) {
  const prompt = (url.searchParams.get("prompt") || "").trim().slice(0, 1000);
  if (!prompt) return json(400, { error: "Missing prompt" });

  const params = new URLSearchParams({
    width: String(clampInt(url.searchParams.get("width"), 256, 2048, 1024)),
    height: String(clampInt(url.searchParams.get("height"), 256, 2048, 1024)),
    seed: String(clampInt(url.searchParams.get("seed"), 0, 2 ** 31 - 1, 0)),
    enhance: url.searchParams.get("enhance") === "true" ? "true" : "false",
    nologo: "true",
  });
  const headers = {};
  let base = FREE_API;
  if (apiKey) {
    const model = url.searchParams.get("model");
    params.set("model", model in POLLINATIONS_MODELS ? model : "flux");
    headers.Authorization = `Bearer ${apiKey}`;
    base = KEYED_API;
  }

  try {
    const upstream = await fetch(base + encodeURIComponent(prompt) + "?" + params, {
      headers,
      signal: AbortSignal.timeout(180_000),
    });
    return relay(upstream);
  } catch (err) {
    return json(504, { error: "upstream_unreachable", detail: String(err) });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET") return json(405, { error: "Method not allowed" });

    const apiKey = env.POLLINATIONS_API_KEY || "";
    try {
      if (url.pathname === "/api/status") {
        return json(200, {
          provider: "pollinations",
          hasKey: Boolean(apiKey),
          parallel: Boolean(apiKey),
          models: apiKey ? POLLINATIONS_MODELS : {},
        });
      }
      if (url.pathname === "/api/image") return await image(url, apiKey);
      return json(404, { error: "Not found" });
    } catch (err) {
      return json(500, { error: "Internal error", detail: String(err) });
    }
  },
};
