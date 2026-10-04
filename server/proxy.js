// Image API proxy shared by the Vite dev/preview server and the production server.
// Keeps the Pollinations secret key on the server — the browser never sees it.

const KEYED_API = "https://gen.pollinations.ai/image/";
const FREE_API = "https://image.pollinations.ai/prompt/";

// Models offered when an API key is configured (alias → label). Cheapest first.
export const MODELS = {
  flux: "Flux Schnell (fast)",
  "z-image": "Z-Image Turbo",
  "flux-klein": "Flux 2 Klein",
  "flux-2-pro": "Flux 2 Pro (best quality)",
  seedream: "Seedream 4",
};

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

async function handleImage(url, res, apiKey) {
  const prompt = (url.searchParams.get("prompt") || "").trim().slice(0, 1000);
  if (!prompt) return sendJson(res, 400, { error: "Missing prompt" });

  const params = new URLSearchParams({
    width: String(clampInt(url.searchParams.get("width"), 256, 2048, 1024)),
    height: String(clampInt(url.searchParams.get("height"), 256, 2048, 1024)),
    seed: String(clampInt(url.searchParams.get("seed"), 0, 2 ** 31 - 1, 0)),
    enhance: url.searchParams.get("enhance") === "true" ? "true" : "false",
    nologo: "true",
  });

  const headers = {};
  let target;
  if (apiKey) {
    const model = url.searchParams.get("model");
    params.set("model", model in MODELS ? model : "flux");
    headers.Authorization = `Bearer ${apiKey}`;
    target = KEYED_API;
  } else {
    target = FREE_API;
  }

  let upstream;
  try {
    upstream = await fetch(target + encodeURIComponent(prompt) + "?" + params, {
      headers,
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err) {
    return sendJson(res, 504, { error: "Image service did not respond", detail: String(err) });
  }

  const type = upstream.headers.get("content-type") || "";
  if (!upstream.ok || !type.startsWith("image/")) {
    const detail = (await upstream.text().catch(() => "")).slice(0, 500);
    // 402 / 429 = rate limited (free mode) or out of credits (keyed mode)
    return sendJson(res, upstream.status === 200 ? 502 : upstream.status, {
      error: upstream.status === 402 || upstream.status === 429 ? "rate_limited" : "upstream_error",
      detail,
    });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

/** Connect-style middleware: handles /api/* and passes everything else on. */
export function createApiMiddleware(apiKey) {
  return (req, res, next) => {
    if (!req.url.startsWith("/api/")) return next?.();
    const url = new URL(req.url, "http://localhost");

    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
    if (url.pathname === "/api/status") {
      return sendJson(res, 200, { hasKey: Boolean(apiKey), models: apiKey ? MODELS : {} });
    }
    if (url.pathname === "/api/image") {
      return handleImage(url, res, apiKey).catch((err) =>
        sendJson(res, 500, { error: "Internal error", detail: String(err) }),
      );
    }
    return sendJson(res, 404, { error: "Not found" });
  };
}
