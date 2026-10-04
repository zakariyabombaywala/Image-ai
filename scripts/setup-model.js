// One-time setup for the local model: creates model-server/.venv and installs
// PyTorch (CPU build) + diffusers. Usage: pnpm setup:model
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../model-server", import.meta.url));
const venvPython = process.platform === "win32" ? `${dir}/.venv/Scripts/python.exe` : `${dir}/.venv/bin/python`;
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

if (!existsSync(venvPython)) {
  console.log("Creating Python virtual environment…");
  run(process.platform === "win32" ? "python" : "python3", ["-m", "venv", `${dir}/.venv`]);
}
run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
run(venvPython, ["-m", "pip", "install", "torch", "--index-url", "https://download.pytorch.org/whl/cpu"]);
run(venvPython, ["-m", "pip", "install", "-r", `${dir}/requirements.txt`]);
console.log("\n✓ Local model installed. The model itself (~4 GB) downloads on the first `pnpm dev`.");
