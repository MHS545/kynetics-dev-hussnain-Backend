import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { firebaseConfig } from "./firebase-config.js";

export const usesFirebase = () => process.env.AUTH_PROVIDER === "firebase";

export function firebaseAdmin() {
  const app =
    getApps().find((app) => app.name === "kynetis-auth") ??
    initializeApp(
      {
        credential: applicationDefault(),
        projectId: firebaseConfig.projectId,
      },
      "kynetis-auth",
    );
  return getAuth(app);
}
