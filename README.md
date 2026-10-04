# Imagine — AI Image Generator

Turn text prompts into images. By default everything runs **on your own computer** with an
open-source model (Stable Diffusion 1.5, *LCM Dreamshaper v7*) — no third-party service, no API key,
no per-image cost. It runs on a normal laptop CPU using Intel OpenVINO, an INT8-compressed model and the
TAESD tiny decoder (~20–45 s per image on an i5-8250U). Pollinations.ai can optionally be used instead.

## Requirements

- Node.js 20.12+ and pnpm
- Python 3.10+ (for the local model)
- ~6 GB free disk space, 8 GB+ RAM (close heavy apps while generating)

## First-time setup

```bash
pnpm install          # website dependencies
pnpm setup:model      # Python venv + PyTorch (CPU) + diffusers  (~1 GB)
cp .env.example .env  # settings
pnpm dev              # first run downloads the model (~4 GB) once
```

## Commands

| Command            | What it does                                                              |
| ------------------ | ------------------------------------------------------------------------- |
| `pnpm dev`         | Website at http://localhost:5173 (live reload) **+ local model server**   |
| `pnpm build`       | Build the production site into `dist/`                                    |
| `pnpm preview`     | Serve the built site at http://localhost:4173 (+ model server)            |
| `pnpm start`       | Production server at http://localhost:3000 (+ model server) — build first |
| `pnpm model`       | Run only the local model server (http://127.0.0.1:7860)                   |
| `pnpm setup:model` | Install / update the Python environment for the local model              |

## Settings (`.env`)

| Variable               | Default                 | Meaning                                         |
| ---------------------- | ----------------------- | ----------------------------------------------- |
| `IMAGE_PROVIDER`       | `local`                 | `local` = own model, `pollinations` = cloud API |
| `MODEL_STEPS`          | `3`                     | Default steps (the Quality menu overrides it)   |
| `MODEL_BACKEND`        | `openvino`              | `openvino` (fast) or `torch` (plain PyTorch)    |
| `FAST_DECODER`         | `1`                     | `1` = tiny decoder (~2 s), `0` = full VAE (slow) |
| `SAFETY_CHECKER`       | `0`                     | `1` = NSFW filter (+1.2 GB RAM, slower)          |
| `LOCAL_MODEL_URL`      | `http://127.0.0.1:7860` | Where the model server listens                  |
| `POLLINATIONS_API_KEY` | —                       | Secret key for the Pollinations provider        |
| `PORT`                 | `3000`                  | Port for `pnpm start`                           |

The model server also reads `MODEL_PIXELS` and `MODEL_THREADS`
(see the top of `model-server/server.py`).

## How it works

```
Browser ──► website (Vite / server/index.js) ──► /api/image proxy ──► local model server (Python, CPU)
                                                               └──► or Pollinations.ai (if configured)
```

- Images are generated at SD 1.5's native size (~512×512, matching the chosen aspect ratio).
- On CPU, variants are generated one after another.
- Speed (i5-8250U, 512×512, warm): Fast (2 steps) ~22 s · Balanced (3) ~34 s · Detailed (4) ~46 s.
  The first image after starting is slower (warm-up). Close heavy apps: if RAM runs out, Windows swaps
  to disk and generation becomes several times slower.
- First start downloads ~4 GB and compresses the model to INT8 once; later starts reuse it.
- The Pollinations key (if used) stays on the server and is never sent to the browser.

## Project structure

```
index.html              Page markup (Vite entry point)
src/main.js             App logic
src/style.css           Styles
public/                 Static files copied as-is (favicon)
server/proxy.js         /api proxy — picks local model or Pollinations
server/index.js         Production server for `pnpm start`
worker/index.js         Cloudflare Worker (site + /api proxy) for `pnpm cf:deploy`
wrangler.jsonc          Cloudflare Workers config
model-server/server.py  Local Stable Diffusion server (Python)
model-server/models/    Downloaded model files (not committed)
scripts/run.js          Starts the model server alongside dev/preview/start
scripts/setup-model.js  Creates the Python environment
vite.config.js          Dev server / build settings
.env                    Your settings (not committed)
dist/                   Production build output (generated)
```

## Deploying

### Cloudflare Workers (recommended)

The site and the `/api` proxy run on Cloudflare (`worker/index.js`, configured in `wrangler.jsonc`).
The local Python model can't run there, so the deployed site always uses **Pollinations**.

1. Log in once: `npx wrangler login`
2. Store your Pollinations key as a secret (optional — without it you get the free, rate-limited mode):
   `npx wrangler secret put POLLINATIONS_API_KEY`
3. Deploy: `pnpm cf:deploy` — prints the live URL (`https://image-ai.<you>.workers.dev`).

Test the Worker locally first with `pnpm cf:dev` (http://localhost:8787). To use your own domain, add it
in the Cloudflare dashboard under *Workers & Pages → image-ai → Settings → Domains & Routes*.
To auto-deploy on every push, connect the GitHub repo there (*Settings → Build*) with build command
`pnpm build` and deploy command `npx wrangler deploy`.

### Your own server

Run `pnpm build` then `pnpm start` on a machine with Node.js and Python. With the local provider the
model runs on that machine, so it needs enough RAM (8 GB+) — a GPU server makes it much faster.
# Image-ai
