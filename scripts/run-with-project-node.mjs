import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const version = "22.22.3";
const nodePath = path.join(
  root,
  ".local-runtime",
  `node-v${version}-win-x64`,
  "node.exe",
);

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("No command was provided to run-with-project-node.");
  process.exit(1);
}

try {
  await fs.access(nodePath);
} catch {
  console.error(`Project Node runtime was not found at ${nodePath}.`);
  console.error("Run `npm run node:setup` first.");
  process.exit(1);
}

const [entrypoint, ...rest] = args;
const resolvedEntrypoint = path.isAbsolute(entrypoint)
  ? entrypoint
  : path.join(root, entrypoint);

const child = spawn(nodePath, [resolvedEntrypoint, ...rest], {
  cwd: root,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
