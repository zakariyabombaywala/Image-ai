"""Local image generation server — runs Stable Diffusion 1.5 (LCM) on this machine.

No third-party service: the model is downloaded once from Hugging Face and then
runs fully offline on the CPU.

    GET /status                      -> {"ready": bool, "loading": bool, "error": str|null, ...}
    GET /generate?prompt=...&width=1024&height=1024&seed=1&steps=4  -> image/jpeg

Settings (env vars, all optional):
    MODEL_ID        Hugging Face model id   (default: SimianLuo/LCM_Dreamshaper_v7)
    MODEL_PORT      Port to listen on        (default: 7860)
    MODEL_STEPS     Default inference steps  (default: 4; LCM works well with 2-8)
    MODEL_PIXELS    Target image area        (default: 512*512 — SD 1.5 native size)
    MODEL_THREADS   CPU threads for PyTorch  (default: physical cores)
    SAFETY_CHECKER  1 = keep the model's NSFW filter, 0 = disable (default: 1)
"""

import io
import json
import math
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
# Keep downloaded model files inside the project (not on C:).
os.environ.setdefault("HF_HOME", str(HERE / "models"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
# Abort a stalled download after 30 s instead of hanging forever (it is retried below).
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "30")

MODEL_ID = os.environ.get("MODEL_ID", "SimianLuo/LCM_Dreamshaper_v7")
PORT = int(os.environ.get("MODEL_PORT", "7860"))
DEFAULT_STEPS = int(os.environ.get("MODEL_STEPS", "4"))
TARGET_PIXELS = int(os.environ.get("MODEL_PIXELS", str(512 * 512)))
SAFETY = os.environ.get("SAFETY_CHECKER", "1") != "0"

state = {"ready": False, "loading": True, "error": None, "model": MODEL_ID, "progress": "starting"}
pipe = None
gen_lock = threading.Lock()  # CPU can only usefully run one generation at a time


def log(*args):
    print("[model]", *args, flush=True)


def load_model():
    global pipe
    try:
        import torch
        from diffusers import DiffusionPipeline

        threads = int(os.environ.get("MODEL_THREADS", "0")) or max(1, (os.cpu_count() or 2) // 2)
        torch.set_num_threads(threads)
        log(f"Loading {MODEL_ID} on CPU with {threads} threads (first run downloads ~4 GB)…")
        state["progress"] = "loading model"

        t0 = time.time()
        kwargs = {"torch_dtype": torch.float32}
        if not SAFETY:
            kwargs.update(safety_checker=None, requires_safety_checker=False)
        p = None
        for attempt in range(1, 11):
            try:
                p = DiffusionPipeline.from_pretrained(MODEL_ID, **kwargs)
                break
            except OSError as exc:  # network errors / interrupted download — resume
                if attempt == 10:
                    raise
                log(f"Download interrupted ({exc.__class__.__name__}), retrying ({attempt}/10)…")
                state["progress"] = f"downloading (retry {attempt})"
                time.sleep(3)
        p.to("cpu")
        p.set_progress_bar_config(disable=True)
        try:
            p.enable_attention_slicing()  # lower peak RAM
        except Exception:
            pass
        pipe = p
        state.update(ready=True, loading=False, progress="ready")
        log(f"Model ready in {time.time() - t0:.0f}s")
    except Exception as exc:  # noqa: BLE001 — report any load failure to the UI
        state.update(ready=False, loading=False, error=f"{type(exc).__name__}: {exc}", progress="failed")
        log("Failed to load model:", state["error"])


def fit_size(width, height):
    """Scale the requested aspect ratio to SD 1.5's native area, rounded to multiples of 64."""
    aspect = width / height
    h = math.sqrt(TARGET_PIXELS / aspect)
    w = h * aspect
    snap = lambda v: max(256, min(1024, int(round(v / 64)) * 64))
    return snap(w), snap(h)


def to_int(value, default, lo, hi):
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return default


def generate(query):
    import torch

    prompt = (query.get("prompt", [""])[0] or "").strip()[:1000]
    if not prompt:
        return 400, {"error": "Missing prompt"}
    width, height = fit_size(
        to_int(query.get("width", [None])[0], 1024, 64, 4096),
        to_int(query.get("height", [None])[0], 1024, 64, 4096),
    )
    seed = to_int(query.get("seed", [None])[0], 0, 0, 2**31 - 1)
    steps = to_int(query.get("steps", [None])[0], DEFAULT_STEPS, 1, 12)

    with gen_lock:
        t0 = time.time()
        result = pipe(
            prompt=prompt,
            width=width,
            height=height,
            num_inference_steps=steps,
            guidance_scale=8.0,
            generator=torch.Generator("cpu").manual_seed(seed),
            output_type="pil",
        )
        took = time.time() - t0

    nsfw = getattr(result, "nsfw_content_detected", None)
    if nsfw and nsfw[0]:
        return 422, {"error": "blocked", "detail": "The safety filter blocked this image. Try a different prompt."}

    buf = io.BytesIO()
    result.images[0].save(buf, format="JPEG", quality=92)
    log(f"{width}x{height}, {steps} steps, seed {seed}: {took:.1f}s — {prompt[:60]!r}")
    return 200, (buf.getvalue(), took)


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/status":
            return self._json(200, {**state, "steps": DEFAULT_STEPS})
        if url.path != "/generate":
            return self._json(404, {"error": "Not found"})
        if not state["ready"]:
            return self._json(503, {"error": "model_loading" if state["loading"] else "model_failed",
                                    "detail": state["error"] or state["progress"]})
        try:
            status, body = generate(parse_qs(url.query))
        except Exception as exc:  # noqa: BLE001
            log("Generation failed:", exc)
            return self._json(500, {"error": "generation_failed", "detail": str(exc)})
        if status != 200:
            return self._json(status, body)
        image, took = body
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(image)))
        self.send_header("X-Generation-Seconds", f"{took:.1f}")
        self.end_headers()
        self.wfile.write(image)

    def log_message(self, *args):  # silence default per-request logging
        pass


def main():
    threading.Thread(target=load_model, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)  # localhost only
    log(f"Listening on http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
