import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const version = "22.22.3";
const runtimeDir = path.join(root, ".local-runtime", `node-v${version}-win-x64`);
const nodeExePath = path.join(runtimeDir, "node.exe");
const downloadUrl = `https://nodejs.org/dist/v${version}/win-x64/node.exe`;

await fs.mkdir(runtimeDir, { recursive: true });

try {
  await fs.access(nodeExePath);
  console.log(`Project Node runtime already exists at ${nodeExePath}`);
  process.exit(0);
} catch {
  // Continue with download.
}

console.log(`Downloading Node.js v${version} from ${downloadUrl}`);

const response = await fetch(downloadUrl);

if (!response.ok || !response.body) {
  throw new Error(`Unable to download Node.js runtime. HTTP ${response.status}`);
}

const buffer = Buffer.from(await response.arrayBuffer());
await fs.writeFile(nodeExePath, buffer);

console.log(`Saved project Node runtime to ${nodeExePath}`);
