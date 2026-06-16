import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env.local");
const requiredKeys = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
];

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

try {
  const envContent = await fs.readFile(envPath, "utf8");
  const envValues = parseEnv(envContent);
  const missing = requiredKeys.filter((key) => !envValues[key]);

  if (missing.length === 0) {
    console.log("Firebase config looks ready.");
    console.log(`Project ID: ${envValues.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`);
    console.log("Next step: enable Email/Password auth and deploy Firestore rules.");
    process.exit(0);
  }

  console.log("Firebase config is still incomplete.");
  console.log("Missing keys:");
  missing.forEach((key) => console.log(`- ${key}`));
  console.log("");
  console.log("Paste the values from Firebase Console > Project settings > Your apps > SDK setup and configuration.");
  process.exit(1);
} catch (error) {
  if (error.code === "ENOENT") {
    console.log(".env.local does not exist yet.");
    console.log("A template file has been created. Fill it with your Firebase web app values.");
    process.exit(1);
  }

  throw error;
}
