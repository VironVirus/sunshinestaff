import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env.local");
const args = process.argv.slice(2);

function parseEnv(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex === -1) {
          return [line, ""];
        }

        return [
          line.slice(0, separatorIndex).trim(),
          line.slice(separatorIndex + 1).trim(),
        ];
      }),
  );
}

async function loadProjectId() {
  try {
    const envContent = await fs.readFile(envPath, "utf8");
    const envValues = parseEnv(envContent);
    return envValues.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
  } catch {
    return "";
  }
}

const projectId = await loadProjectId();
const command = "npx";
const loginLikeCommand = args[0] === "login";
const finalArgs = ["firebase-tools", ...args, "--config", "firebase.json"];

if (projectId && !loginLikeCommand) {
  finalArgs.push("--project", projectId);
}

if (!projectId && !loginLikeCommand) {
  console.error("NEXT_PUBLIC_FIREBASE_PROJECT_ID is missing in .env.local.");
  console.error("Add your Firebase project ID before running Firebase CLI helper commands.");
  process.exit(1);
}

const child = spawn(command, finalArgs, {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
