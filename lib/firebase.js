import { getApp, getApps, initializeApp } from "@firebase/app";
import { connectAuthEmulator, getAuth } from "@firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "@firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const missingFirebaseKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

export const hasFirebaseConfig = missingFirebaseKeys.length === 0;

const shouldUseFirebaseEmulators =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

const app = hasFirebaseConfig
  ? getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

if (auth && db && shouldUseFirebaseEmulators && typeof window !== "undefined") {
  const authHost =
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1";
  const authPort = Number(process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT || "9099");
  const firestoreHost =
    process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST || "127.0.0.1";
  const firestorePort = Number(
    process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT || "8080",
  );

  if (!window.__SUNSHINE_FIREBASE_EMULATORS_CONNECTED__) {
    connectAuthEmulator(auth, `http://${authHost}:${authPort}`, {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, firestoreHost, firestorePort);
    window.__SUNSHINE_FIREBASE_EMULATORS_CONNECTED__ = true;
  }
}
