import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const version = "22.22.3";
const distDir = ".next-prod";
const nodePath = path.join(
  root,
  ".local-runtime",
  `node-v${version}-win-x64`,
  "node.exe",
);
const nextEntrypoint = path.join(root, "node_modules", "next", "dist", "bin", "next");

try {
  await fs.access(nodePath);
} catch {
  console.error(`Project Node runtime was not found at ${nodePath}.`);
  console.error("Run `npm run node:setup` first.");
  process.exit(1);
}

const child = spawn(nodePath, [nextEntrypoint, "build"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_DIST_DIR: distDir,
  },
});

child.on("exit", async (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
