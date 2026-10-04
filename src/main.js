import "./style.css";

const MAX_HISTORY = 40;
const FREE_RETRIES = 6;      // free mode: how many times to wait out the cooldown
const FREE_COOLDOWN_S = 30;  // seconds between free-mode attempts

const $ = (id) => document.getElementById(id);
const form = $("genForm");
const promptEl = $("prompt");
const results = $("results");
const historyEl = $("history");
const errorEl = $("error");
const btn = $("generateBtn");
const modelEl = $("model");

const SURPRISE = [
  "A giant koi fish swimming through clouds above a floating Japanese village at sunset",
  "A steampunk owl made of brass gears perched on an old library bookshelf",
  "An astronaut relaxing in a hammock on the moon, Earth rising in the background",
  "A neon-lit cyberpunk street market in the rain, reflections on wet pavement",
  "A tiny dragon sleeping inside a teacup on a wooden table, morning light",
  "A crystal palace in the middle of a frozen lake under the aurora borealis",
  "A cat wearing a wizard hat reading a glowing spellbook by candlelight",
  "An underwater city with bioluminescent coral towers and glass domes",
  "A vintage red bicycle leaning against a wall covered in blooming wisteria",
  "A lighthouse on a cliff during a dramatic thunderstorm, waves crashing",
];

let hasKey = false;
let isLocal = false;
let parallel = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- server status (which provider, API key, local model state) ----------
function setModels(models, enabled) {
  modelEl.innerHTML = "";
  for (const [value, label] of Object.entries(models)) modelEl.append(new Option(label, value));
  modelEl.disabled = !enabled;
}

function showLocalStatus(local) {
  const banner = $("localBanner");
  banner.hidden = false;
  if (local.ready) {
    banner.innerHTML = "<strong>Local model ready.</strong> Images are generated on this computer — " +
      "no internet service is used. Each image takes a little while on the CPU.";
  } else if (local.loading) {
    banner.innerHTML = "<strong>Loading local model…</strong> The first start downloads the model " +
      "(about 4&nbsp;GB) — this can take several minutes.";
  } else {
    banner.innerHTML = "<strong>Local model unavailable:</strong> ";
    banner.append(local.error || "unknown error");
  }
}

async function loadStatus() {
  let status = {};
  try { status = await (await fetch("/api/status")).json(); } catch {}
  isLocal = status.provider === "local";
  hasKey = Boolean(status.hasKey);
  parallel = Boolean(status.parallel);

  $("freeBanner").hidden = isLocal || hasKey;
  $("localBanner").hidden = !isLocal;
  $("enhance").disabled = isLocal; // prompt enhancing is a Pollinations feature
  $("qualityLabel").hidden = !isLocal; // step count only applies to the local model

  if (isLocal) {
    setModels(status.models, false);
    showLocalStatus(status.local);
    if (!status.local.ready) setTimeout(loadStatus, 3000); // poll until the model is loaded
  } else if (hasKey) {
    setModels(status.models, true);
  }
}

// ---------- history storage (IndexedDB, stores image blobs) ----------
const DB_NAME = "imagine";
const STORE = "history";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbRun(mode, fn) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return undefined; // storage unavailable (private mode etc.) — history just won't persist
  }
}

const getHistory = async () =>
  ((await dbRun("readonly", (s) => s.getAll())) || []).sort((a, b) => b.time - a.time);

async function addHistory(item) {
  await dbRun("readwrite", (s) => s.put(item));
  const all = await getHistory();
  const extra = all.slice(MAX_HISTORY);
  if (extra.length) await dbRun("readwrite", (s) => extra.forEach((x) => s.delete(x.id)));
}

// ---------- theme ----------
(function initTheme() {
  let theme;
  try { theme = localStorage.getItem("imagine-theme"); } catch {}
  if (!theme) theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  $("themeToggle").onclick = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("imagine-theme", next); } catch {}
  };
})();

// ---------- UI helpers ----------
promptEl.addEventListener("input", () => {
  $("charCount").textContent = `${promptEl.value.length} / 1000`;
});

$("surpriseBtn").onclick = () => {
  promptEl.value = SURPRISE[Math.floor(Math.random() * SURPRISE.length)];
  promptEl.dispatchEvent(new Event("input"));
  promptEl.focus();
};

promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit();
});

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = !msg;
}

function downloadBlob(blob, prompt) {
  const name = prompt.slice(0, 40).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "image";
  const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg").replace("svg+xml", "svg");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function openLightbox(src, caption) {
  const lb = $("lightbox");
  lb.querySelector("img").src = src;
  lb.querySelector(".lb-caption").textContent = caption;
  lb.hidden = false;
}
$("lightbox").addEventListener("click", (e) => {
  if (e.target.tagName !== "IMG") $("lightbox").hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("lightbox").hidden = true;
});

// ---------- cards ----------
function createCard(item) {
  const card = document.createElement("div");
  card.className = "card";
  card.style.aspectRatio = `${item.width} / ${item.height}`;

  const skeleton = document.createElement("div");
  skeleton.className = "skeleton";
  skeleton.textContent = "Queued…";

  const img = document.createElement("img");
  img.alt = item.prompt;
  img.onload = () => {
    img.classList.add("loaded");
    skeleton.remove();
  };

  const actions = document.createElement("div");
  actions.className = "actions";

  const reuse = document.createElement("button");
  reuse.textContent = "↻ Reuse";
  reuse.title = "Load this prompt & seed";
  reuse.onclick = () => {
    promptEl.value = item.userPrompt ?? item.prompt;
    $("seed").value = item.seed;
    promptEl.dispatchEvent(new Event("input"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const dl = document.createElement("button");
  dl.textContent = "⬇ Download";
  dl.disabled = true;

  actions.append(reuse, dl);
  card.append(skeleton, img, actions);

  return {
    el: card,
    setStatus(text) { skeleton.textContent = text; },
    setError(text) {
      skeleton.textContent = text;
      skeleton.style.animation = "none";
    },
    setImage(blob) {
      const src = URL.createObjectURL(blob);
      img.src = src;
      img.onclick = () => openLightbox(src, item.prompt);
      dl.disabled = false;
      dl.onclick = () => downloadBlob(blob, item.prompt);
      return src;
    },
  };
}

let historyUrls = [];
async function renderHistory() {
  historyUrls.forEach(URL.revokeObjectURL);
  historyUrls = [];
  const list = await getHistory();
  historyEl.innerHTML = "";
  if (!list.length) {
    historyEl.innerHTML = '<p class="empty muted">No history yet.</p>';
    return;
  }
  for (const item of list) {
    const card = createCard(item);
    card.el.classList.add("history-item");
    historyUrls.push(card.setImage(item.blob));
    historyEl.append(card.el);
  }
}

$("clearHistory").onclick = async () => {
  await dbRun("readwrite", (s) => s.clear());
  renderHistory();
};

// ---------- generation ----------
function imageUrl(item) {
  const params = new URLSearchParams({
    prompt: item.prompt,
    width: item.width,
    height: item.height,
    seed: item.seed,
    enhance: item.enhance,
  });
  if (item.model) params.set("model", item.model);
  if (item.steps) params.set("steps", item.steps);
  return "/api/image?" + params;
}

/** fetch() that shows a running "Generating… 12s" timer on the card. */
async function timedFetch(url, card) {
  const start = Date.now();
  card.setStatus("Generating…");
  const timer = setInterval(() => {
    card.setStatus(`Generating… ${Math.round((Date.now() - start) / 1000)}s`);
  }, 1000);
  try {
    return await fetch(url);
  } catch {
    return null;
  } finally {
    clearInterval(timer);
  }
}

/** Local model: wait while it loads, then generate. */
async function generateLocal(item, card) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const res = await timedFetch(imageUrl(item), card);
    if (res?.ok) return res.blob();
    const body = res ? await res.json().catch(() => ({})) : {};
    if (body.error === "model_loading") {
      card.setStatus("Waiting for the local model to load…");
      await sleep(5000);
      continue;
    }
    if (body.error === "upstream_unreachable" || !res) {
      throw new Error("Local model server is not running — restart `pnpm dev`.");
    }
    throw new Error(typeof body.detail === "string" ? body.detail : "Generation failed — try again");
  }
  throw new Error("The local model took too long to load.");
}

/** Fetch one image, waiting out the free-tier cooldown when rate limited. */
async function generateOne(item, card) {
  if (isLocal) return generateLocal(item, card);

  const attempts = hasKey ? 2 : FREE_RETRIES;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await timedFetch(imageUrl(item), card);
    if (res?.ok) return res.blob();

    const body = res ? await res.json().catch(() => ({})) : {};
    const rateLimited = body.error === "rate_limited";

    if (res?.status === 401 || res?.status === 403) {
      throw new Error("Invalid API key — check POLLINATIONS_API_KEY in .env");
    }
    if (hasKey && rateLimited) {
      throw new Error("Out of Pollinations credits (or key limit reached).");
    }
    if (attempt === attempts) break;

    const wait = rateLimited ? FREE_COOLDOWN_S : 3;
    for (let s = wait; s > 0; s--) {
      card.setStatus(rateLimited ? `Free-tier cooldown… ${s}s` : `Retrying in ${s}s…`);
      await sleep(1000);
    }
  }
  throw new Error("Failed — try again");
}

/** Run jobs with at most `limit` running at the same time. */
async function runQueue(jobs, limit) {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) await jobs[next++]();
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");

  const userPrompt = promptEl.value.trim();
  if (!userPrompt) {
    showError("Please enter a prompt first.");
    promptEl.focus();
    return;
  }

  const style = $("style").value;
  const prompt = style ? `${userPrompt}, ${style}` : userPrompt;
  const [width, height] = $("size").value.split("x").map(Number);
  const count = Number($("count").value);
  const model = hasKey && !isLocal ? modelEl.value : "";
  const enhance = !isLocal && $("enhance").checked;
  const steps = isLocal ? Number($("quality").value) : undefined;
  const seedInput = $("seed").value;
  const baseSeed = seedInput !== "" ? Number(seedInput) : Math.floor(Math.random() * 1e9);

  btn.disabled = true;
  btn.querySelector(".btn-label").textContent = "Generating…";
  results.innerHTML = "";

  let failures = 0;
  let lastError = "";
  const jobs = Array.from({ length: count }, (_, i) => {
    const item = {
      id: `${Date.now()}-${i}`,
      prompt, userPrompt, width, height, model, enhance, steps,
      seed: baseSeed + i,
      time: Date.now() + i,
    };
    const card = createCard(item);
    results.append(card.el);

    return async () => {
      try {
        const blob = await generateOne(item, card);
        card.setImage(blob);
        await addHistory({ ...item, blob });
        renderHistory();
      } catch (err) {
        failures++;
        lastError = err.message;
        card.setError(err.message);
      }
    };
  });

  // Pollinations with a key runs variants in parallel; free mode and the local CPU model go one at a time.
  await runQueue(jobs, parallel ? count : 1);

  btn.disabled = false;
  btn.querySelector(".btn-label").textContent = "Generate";
  if (failures === count) showError(lastError || "Generation failed — please try again.");
});

try { localStorage.removeItem("imagine-history"); } catch {} // old URL-based history
loadStatus();
renderHistory();
