# Imagine — AI Image Generator

Turn text prompts into images. Uses [Pollinations.ai](https://pollinations.ai) for image generation.

## API key (recommended)

Without a key the app runs in **free mode**: images carry a Pollinations watermark, a basic model is used, and only one image can be made about every 30–40 seconds.

1. Create a free account and a **secret key** (`sk_...`) at https://enter.pollinations.ai/keys
2. Copy `.env.example` to `.env` and set `POLLINATIONS_API_KEY=sk_...`
3. Restart `pnpm dev`

The key stays on the server (Vite dev server or `server/index.js`) and is never sent to the browser. Generation uses your account’s Pollen credits.

## Requirements

- Node.js 20+
- pnpm

## Commands

| Command        | What it does                                              |
| -------------- | --------------------------------------------------------- |
| `pnpm install` | Install dependencies (first time only)                    |
| `pnpm dev`     | Start the dev server at http://localhost:5173 with live reload |
| `pnpm build`   | Build the production site into `dist/`                    |
| `pnpm preview` | Serve the built `dist/` folder at http://localhost:4173   |
| `pnpm start`   | Production server (site + API proxy) at http://localhost:3000 — run `pnpm build` first |

## Project structure

```
index.html        Page markup (Vite entry point)
src/main.js       App logic
src/style.css     Styles
server/proxy.js   Image API proxy (adds the secret key server-side)
server/index.js   Production server for `pnpm start`
public/           Static files copied as-is (favicon)
.env              Your API key (not committed)
vite.config.js    Dev server / build settings
dist/             Production build output (generated)
```

To deploy, run `pnpm build` then `pnpm start` on any Node.js host (Render, Railway, a VPS, …) with `POLLINATIONS_API_KEY` set as an environment variable. A plain static host won’t work because the API proxy needs a server.
# Image-ai
