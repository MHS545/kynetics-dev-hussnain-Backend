import { database } from "../../database/database.mjs";
import { userForToken } from "./accounts.mjs";
import { firebaseAdmin, usesFirebase } from "../../config/firebase-admin.js";
import { firebaseConfig } from "../../config/firebase-config.js";
import { linkedFirebaseUser } from "../users/firebase-account.repository.mjs";
export type User = {
  id: string;
  email?: string;
  email_confirmed_at?: string;
  user_metadata?: Record<string, any>;
};
export function sessionToken(req: Request) {
  const authorization = req.headers.get("authorization");
  if (authorization) return authorization.replace(/^Bearer\s+/i, "");
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("kynetis_v2_session="))
    ?.slice("kynetis_v2_session=".length);
}
const checkedRequests = new WeakMap<Request, Promise<User | null>>();
export function authenticatedUser(req: Request): Promise<User | null> {
  const checked = checkedRequests.get(req) ?? userForSession(sessionToken(req));
  checkedRequests.set(req, checked);
  return checked;
}
export async function userForSession(token?: string): Promise<User | null> {
  if (!usesFirebase()) return userForToken(database(), token);
  if (!token || token.length > 16384) return null;
  try {
    const claims = await firebaseAdmin().verifySessionCookie(token, true);
    return await linkedFirebaseUser(
      database(),
      firebaseConfig.projectId,
      claims.uid,
    );
  } catch {
    return null;
  }
}
export function sessionCookie(req: Request, token: string, clear = false) {
  return `kynetis_v2_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 28800}${new URL(req.headers.get("origin") || req.url).protocol === "https:" ? "; Secure" : ""}`;
}
