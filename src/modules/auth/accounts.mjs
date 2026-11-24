import {
  passwordHash,
  passwordMatches,
  randomToken,
  tokenHash,
} from "./password.mjs";
export class AccountError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AccountError";
    this.status = status;
  }
}
export const publicUser = (row) => ({
  id: row.id,
  email: row.email,
  email_confirmed_at: row.created_at,
  user_metadata: row.metadata,
});
export async function registerAccount(db, { email, password, metadata }) {
  const hash = await passwordHash(password);
  try {
    const { rows } = await db.query(
      "INSERT INTO kynetis.users(email,password_hash,metadata) VALUES($1,$2,$3::jsonb) RETURNING id,email,metadata,created_at",
      [email.trim().toLowerCase(), hash, JSON.stringify(metadata)],
    );
    return publicUser(rows[0]);
  } catch (e) {
    if (e.code === "23505")
      throw new AccountError(
        "An account with this email already exists. Sign in instead.",
        409,
      );
    throw e;
  }
}
export async function throttle(db, key) {
  const result = await db.query(
    `INSERT INTO kynetis.auth_attempts(key) VALUES($1)
 ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN kynetis.auth_attempts.expires_at<now() THEN 1 ELSE kynetis.auth_attempts.attempts+1 END,
 expires_at=CASE WHEN kynetis.auth_attempts.expires_at<now() THEN now()+interval '15 minutes' ELSE kynetis.auth_attempts.expires_at END RETURNING attempts`,
    [tokenHash(key)],
  );
  if (result.rows[0].attempts > 10)
    throw new AccountError(
      "Too many attempts. Wait 15 minutes before trying again.",
      429,
    );
}
export async function signIn(db, email, password) {
  await throttle(db, "login:" + email.trim().toLowerCase());
  const { rows } = await db.query(
    "SELECT * FROM kynetis.users WHERE email=$1",
    [email.trim().toLowerCase()],
  );
  const row = rows[0];
  if (
    !row ||
    !row.active ||
    !(await passwordMatches(password, row.password_hash))
  )
    throw new AccountError(
      "Sign-in failed. Check your email and password.",
      401,
    );
  const token = randomToken();
  await db.query(
    "INSERT INTO kynetis.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",
    [tokenHash(token), row.id],
  );
  await db.query("DELETE FROM kynetis.auth_attempts WHERE key=$1", [
    tokenHash("login:" + email.trim().toLowerCase()),
  ]);
  return { token, user: publicUser(row) };
}
export async function userForToken(db, token) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await db.query(
    "SELECT u.* FROM kynetis.users u JOIN kynetis.sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true",
    [tokenHash(token)],
  );
  return rows[0] ? publicUser(rows[0]) : null;
}
export async function signOut(db, token) {
  if (token)
    await db.query("DELETE FROM kynetis.sessions WHERE token_hash=$1", [
      tokenHash(token),
    ]);
}
export async function makeReset(db, email) {
  const { rows } = await db.query(
    "SELECT id FROM kynetis.users WHERE email=$1 AND active=true",
    [email.trim().toLowerCase()],
  );
  if (!rows[0]) throw new AccountError("Account not found.");
  const token = randomToken();
  await db.query("DELETE FROM kynetis.reset_tokens WHERE user_id=$1", [
    rows[0].id,
  ]);
  await db.query(
    "INSERT INTO kynetis.reset_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '15 minutes')",
    [tokenHash(token), rows[0].id],
  );
  return token;
}
export async function validReset(db, token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return false;
  return (
    (
      await db.query(
        "SELECT 1 FROM kynetis.reset_tokens WHERE token_hash=$1 AND expires_at>now()",
        [tokenHash(token)],
      )
    ).rows.length === 1
  );
}
export async function resetPassword(client, token, password) {
  if (!(await validReset(client, token)))
    throw new AccountError("This reset link is invalid or expired.", 401);
  const hash = await passwordHash(password);
  await client.query("BEGIN");
  try {
    const result = await client.query(
      "DELETE FROM kynetis.reset_tokens WHERE token_hash=$1 AND expires_at>now() RETURNING user_id",
      [tokenHash(token)],
    );
    if (!result.rows[0])
      throw new AccountError("This reset link is invalid or expired.", 401);
    const id = result.rows[0].user_id;
    await client.query(
      "UPDATE kynetis.users SET password_hash=$1 WHERE id=$2",
      [hash, id],
    );
    await client.query("DELETE FROM kynetis.sessions WHERE user_id=$1", [id]);
    await client.query("DELETE FROM kynetis.reset_tokens WHERE user_id=$1", [
      id,
    ]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}
