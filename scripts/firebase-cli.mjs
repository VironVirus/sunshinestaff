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
    if (envValues.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
      return envValues.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    }
  } catch {
    // Fall through to the repository's Firebase project alias.
  }

  try {
    const firebaseRc = JSON.parse(
      await fs.readFile(path.join(root, ".firebaserc"), "utf8"),
    );
    return firebaseRc?.projects?.default || "";
  } catch {
    return "";
  }
}

const projectId = await loadProjectId();
const loginLikeCommand = args[0] === "login";
const firebaseExecutable = process.platform === "win32" ? "firebase.cmd" : "firebase";
const localFirebaseCommand = path.join(root, "node_modules", ".bin", firebaseExecutable);
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
let firebaseCommand = localFirebaseCommand;
let commandPrefix = [];

try {
  await fs.access(localFirebaseCommand);
} catch {
  firebaseCommand = npxCommand;
  commandPrefix = ["--yes", "--prefer-offline", "firebase-tools@15.27.0"];
}

const finalArgs = loginLikeCommand
  ? [...args]
  : [...args, "--config", "firebase.json"];

if (projectId && !loginLikeCommand) {
  finalArgs.push("--project", projectId);
}

if (!projectId && !loginLikeCommand) {
  console.error("Firebase project ID is missing.");
  console.error("Set NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local or projects.default in .firebaserc.");
  process.exit(1);
}

const child = process.platform === "win32"
  ? spawn("cmd.exe", ["/c", firebaseCommand, ...commandPrefix, ...finalArgs], {
      cwd: root,
      stdio: "inherit",
      shell: false,
    })
  : spawn(firebaseCommand, [...commandPrefix, ...finalArgs], {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });

child.on("error", (error) => {
  if (error?.code === "ENOENT") {
    console.error("The project could not start Firebase CLI through npx.");
    console.error("Confirm Node.js and npm are installed, then retry.");
    process.exit(1);
  }

  console.error("Unable to start Firebase CLI:", error?.message || error);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
