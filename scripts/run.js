// Runs a command (e.g. `vite`) together with the local model server when
// IMAGE_PROVIDER=local. Usage: node scripts/run.js <command> [args...]
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

try { process.loadEnvFile(); } catch { /* no .env */ }

const root = fileURLToPath(new URL("..", import.meta.url));
const python = process.platform === "win32"
  ? `${root}model-server/.venv/Scripts/python.exe`
  : `${root}model-server/.venv/bin/python`;

const children = [];
const stopAll = () => children.forEach((c) => c.exitCode === null && c.kill());
process.on("SIGINT", () => { stopAll(); process.exit(0); });
process.on("SIGTERM", () => { stopAll(); process.exit(0); });

if (process.env.IMAGE_PROVIDER !== "pollinations") {
  if (existsSync(python)) {
    children.push(spawn(python, [`${root}model-server/server.py`], { stdio: "inherit" }));
  } else {
    console.warn("\n⚠ Local model is not installed yet. Run `pnpm setup:model` first.\n");
  }
}

// With no command, just run the model server (`pnpm model`).
const [cmd, ...args] = process.argv.slice(2);
const main = cmd ? spawn(cmd, args, { stdio: "inherit", shell: true }) : children[0];
if (!main) process.exit(1);
if (cmd) children.push(main);
main.on("exit", (code) => { stopAll(); process.exit(code ?? 0); });
