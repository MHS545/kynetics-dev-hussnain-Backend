// Only the server calls this with claims already verified by Firebase Admin.
import { randomBytes } from "node:crypto";
import { AccountError, publicUser, throttle } from "../auth/accounts.mjs";
import { passwordMatches } from "../auth/password.mjs";

export async function linkedFirebaseUser(db, projectId, uid) {
  const { rows } = await db.query(
    "SELECT * FROM kynetis.users WHERE metadata->>'firebase_project_id'=$1 AND metadata->>'firebase_uid'=$2 AND active=true",
    [projectId, uid],
  );
  return rows[0] ? publicUser(rows[0]) : null;
}

export async function connectFirebaseAccount(
  db,
  identity,
  profile = {},
  existingPassword,
) {
  const { projectId, uid, email } = identity;
  if (
    !projectId ||
    !uid ||
    typeof email !== "string" ||
    !email.includes("@") ||
    email.length > 254
  )
    throw new AccountError(
      "This sign-in provider must supply an email address.",
    );
  const normalizedEmail = email.trim().toLowerCase();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Serializes duplicate first-sign-in requests without changing the schema.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `firebase:${projectId}:${uid}`,
    ]);
    const { rows: bindings } = await client.query(
      "SELECT * FROM kynetis.users WHERE metadata->>'firebase_project_id'=$1 AND metadata->>'firebase_uid'=$2 FOR UPDATE",
      [projectId, uid],
    );
    if (bindings.length) {
      if (bindings.length !== 1 || !bindings[0].active)
        throw new AccountError(
          "This account is disabled. Contact your operator.",
          403,
        );
      await client.query("COMMIT");
      return publicUser(bindings[0]);
    }
    const { rows } = await client.query(
      "SELECT * FROM kynetis.users WHERE email=$1 FOR UPDATE",
      [normalizedEmail],
    );
    const existing = rows[0];
    const binding = { firebase_project_id: projectId, firebase_uid: uid };
    let row;
    if (existing) {
      // Possession of an email alone never transfers an existing workspace.
      if (!existing.active || existing.metadata.firebase_uid)
        throw new AccountError(
          "This account cannot be linked. Contact your operator.",
          403,
        );
      if (!existingPassword) {
        const error = new AccountError(
          "An existing Kynetis account uses this email. Enter its original password to link it.",
          409,
        );
        error.code = "ACCOUNT_LINK_REQUIRED";
        throw error;
      }
      if (!(await passwordMatches(existingPassword, existing.password_hash)))
        throw new AccountError(
          "The original Kynetis password is incorrect.",
          401,
        );
      ({
        rows: [row],
      } = await client.query(
        "UPDATE kynetis.users SET metadata=metadata || $2::jsonb WHERE id=$1 RETURNING *",
        [existing.id, JSON.stringify(binding)],
      ));
      // Invalidate pre-link local sessions and password-reset links.
      await client.query("DELETE FROM kynetis.sessions WHERE user_id=$1", [
        existing.id,
      ]);
      await client.query("DELETE FROM kynetis.reset_tokens WHERE user_id=$1", [
        existing.id,
      ]);
    } else {
      const names = (identity.name || "").trim().split(/\s+/);
      const metadata = {
        first_name: names[0] || "",
        last_name: names.slice(1).join(" "),
        nationality: "",
        additional_nationalities: [],
        ...profile,
        ...binding,
      };
      ({
        rows: [row],
      } = await client.query(
        "INSERT INTO kynetis.users(email,password_hash,metadata) VALUES($1,$2,$3::jsonb) RETURNING *",
        [
          normalizedEmail,
          "firebase-only:" + randomBytes(32).toString("hex"),
          JSON.stringify(metadata),
        ],
      ));
    }
    await client.query("COMMIT");
    return publicUser(row);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505")
      throw new AccountError("Account setup changed. Sign in again.", 409);
    throw error;
  } finally {
    client.release();
  }
}

export async function checkLinkAttempts(db, uid) {
  await throttle(db, "firebase-link:" + uid);
}
