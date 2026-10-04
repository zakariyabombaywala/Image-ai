// Image API proxy shared by the Vite dev/preview server and the production server.
//
// Two providers, picked with IMAGE_PROVIDER in .env:
//   local        — our own model server (model-server/server.py) running on this machine
//   pollinations — Pollinations.ai cloud API (secret key stays server-side)

const KEYED_API = "https://gen.pollinations.ai/image/";
const FREE_API = "https://image.pollinations.ai/prompt/";

// Pollinations models offered when an API key is configured (alias → label).
export const POLLINATIONS_MODELS = {
  flux: "Flux Schnell (fast)",
  "z-image": "Z-Image Turbo",
  "flux-klein": "Flux 2 Klein",
  "flux-2-pro": "Flux 2 Pro (best quality)",
  seedream: "Seedream 4",
};

const LOCAL_MODELS = { local: "Dreamshaper v7 LCM (on this PC)" };

const clampInt = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readParams(url) {
  const prompt = (url.searchParams.get("prompt") || "").trim().slice(0, 1000);
  return {
    prompt,
    params: new URLSearchParams({
      width: String(clampInt(url.searchParams.get("width"), 256, 2048, 1024)),
      height: String(clampInt(url.searchParams.get("height"), 256, 2048, 1024)),
      seed: String(clampInt(url.searchParams.get("seed"), 0, 2 ** 31 - 1, 0)),
    }),
  };
}

/** Pipe an upstream image response to the browser, or turn failures into JSON errors. */
async function relay(upstream, res) {
  const type = upstream.headers.get("content-type") || "";
  if (upstream.ok && type.startsWith("image/")) {
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-store");
    return res.end(Buffer.from(await upstream.arrayBuffer()));
  }
  const text = await upstream.text().catch(() => "");
  let body;
  try { body = JSON.parse(text); } catch { body = { detail: text.slice(0, 500) }; }
  if (upstream.status === 402 || upstream.status === 429) body.error = "rate_limited";
  return sendJson(res, upstream.status === 200 ? 502 : upstream.status, {
    error: body.error || "upstream_error",
    detail: body.detail ?? body,
  });
}

async function fetchUpstream(target, init, res, timeoutMs) {
  try {
    return await fetch(target, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    sendJson(res, 504, { error: "upstream_unreachable", detail: String(err.cause?.code || err) });
    return null;
  }
}

async function localStatus(localUrl) {
  try {
    const r = await fetch(`${localUrl}/status`, { signal: AbortSignal.timeout(3000) });
    return await r.json();
  } catch {
    return { ready: false, loading: false, error: "Local model server is not running. Start it with `pnpm model`." };
  }
}

/** Connect-style middleware: handles /api/* and passes everything else on. */
export function createApiMiddleware(env = {}) {
  const provider = env.IMAGE_PROVIDER === "pollinations" ? "pollinations" : "local";
  const apiKey = env.POLLINATIONS_API_KEY || "";
  const localUrl = (env.LOCAL_MODEL_URL || "http://127.0.0.1:7860").replace(/\/$/, "");

  async function status() {
    if (provider === "local") {
      return { provider, parallel: false, models: LOCAL_MODELS, local: await localStatus(localUrl) };
    }
    return {
      provider,
      hasKey: Boolean(apiKey),
      parallel: Boolean(apiKey),
      models: apiKey ? POLLINATIONS_MODELS : {},
    };
  }

  async function image(url, res) {
    const { prompt, params } = readParams(url);
    if (!prompt) return sendJson(res, 400, { error: "Missing prompt" });
    params.set("prompt", prompt);

    if (provider === "local") {
      const steps = url.searchParams.get("steps");
      if (steps) params.set("steps", String(clampInt(steps, 1, 12, 4)));
      // CPU generation can take minutes when several requests queue up.
      const upstream = await fetchUpstream(`${localUrl}/generate?${params}`, {}, res, 600_000);
      return upstream && relay(upstream, res);
    }

    params.delete("prompt");
    params.set("enhance", url.searchParams.get("enhance") === "true" ? "true" : "false");
    params.set("nologo", "true");
    const headers = {};
    let base = FREE_API;
    if (apiKey) {
      const model = url.searchParams.get("model");
      params.set("model", model in POLLINATIONS_MODELS ? model : "flux");
      headers.Authorization = `Bearer ${apiKey}`;
      base = KEYED_API;
    }
    const upstream = await fetchUpstream(base + encodeURIComponent(prompt) + "?" + params, { headers }, res, 180_000);
    return upstream && relay(upstream, res);
  }

  return (req, res, next) => {
    if (!req.url.startsWith("/api/")) return next?.();
    const url = new URL(req.url, "http://localhost");
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });

    const handler =
      url.pathname === "/api/status" ? async () => sendJson(res, 200, await status())
      : url.pathname === "/api/image" ? () => image(url, res)
      : null;
    if (!handler) return sendJson(res, 404, { error: "Not found" });
    handler().catch((err) => sendJson(res, 500, { error: "Internal error", detail: String(err) }));
  };
}
