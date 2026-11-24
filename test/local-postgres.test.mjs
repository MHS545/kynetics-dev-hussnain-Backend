import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  registerAccount,
  signIn,
  userForToken,
  signOut,
  makeReset,
  resetPassword,
  validReset,
} from "../src/modules/auth/accounts.mjs";
import { dbStatus } from "../src/database/database.mjs";
import { tokenHash } from "../src/modules/auth/password.mjs";
import {
  evidencePath,
  storeEvidence,
  readEvidence,
} from "../src/modules/files/storage/evidence.mjs";
const sql = await readFile(
  new URL("../src/database/migrations/01_kynetis_schema.sql", import.meta.url),
  "utf8",
);
async function fresh(setup = true) {
  const db = new PGlite();
  await db.exec("CREATE ROLE app_user LOGIN;");
  if (setup) await db.exec(sql);
  return db;
}
const user = (email) => ({
  email,
  password: "Local-Password-123!",
  metadata: { first_name: "Sample", last_name: "Customer" },
});
test("manual schema required; no starter table or customer data created automatically", async () => {
  const db = await fresh(false);
  try {
    assert.equal((await dbStatus(db)).schemaReady, false);
    await db.exec(sql);
    assert.equal((await dbStatus(db)).schemaReady, true);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM kynetis.users")).rows[0]
        .n,
      0,
    );
    await db.exec(sql);
    assert.equal(
      (await db.query("SELECT to_regclass('public.customers') AS name")).rows[0]
        .name,
      null,
    );
  } finally {
    await db.close();
  }
});
test("native account sessions, duplicate rejection, password reset and revocation", async () => {
  const db = await fresh();
  try {
    await db.query("SET ROLE app_user");
    const a = await registerAccount(db, user("sample@example.test"));
    await assert.rejects(
      registerAccount(db, user("SAMPLE@example.test")),
      (e) => e.status === 409,
    );
    await assert.rejects(
      signIn(db, a.email, "wrong-password"),
      (e) => e.status === 401,
    );
    const session = await signIn(db, a.email, "Local-Password-123!");
    assert.equal((await userForToken(db, session.token)).id, a.id);
    const row = (await db.query("SELECT token_hash FROM kynetis.sessions"))
      .rows[0];
    assert.notEqual(row.token_hash, session.token);
    assert.equal(row.token_hash, tokenHash(session.token));
    await signOut(db, session.token);
    assert.equal(await userForToken(db, session.token), null);
    const again = await signIn(db, a.email, "Local-Password-123!"),
      reset = await makeReset(db, a.email);
    assert.equal(await validReset(db, reset), true);
    await resetPassword(db, reset, "Changed-Password-456!");
    assert.equal(await validReset(db, reset), false);
    assert.equal(await userForToken(db, again.token), null);
    await assert.rejects(
      resetPassword(db, reset, "another-password"),
      (e) => e.status === 401,
    );
    await assert.rejects(
      signIn(db, a.email, "Local-Password-123!"),
      (e) => e.status === 401,
    );
    assert.ok((await signIn(db, a.email, "Changed-Password-456!")).token);
  } finally {
    await db.close();
  }
});
test("server-owned portal grants, revision conflicts, audit writes and revocation", async () => {
  const db = await fresh();
  try {
    const customer = await registerAccount(db, user("customer@example.test")),
      officer = await registerAccount(db, user("officer@example.test"));
    await db.query("SET ROLE app_user");
    const bootstrap = async (u) =>
      (
        await db.query("SELECT kynetis.bootstrap($1,$2::jsonb) AS data", [
          u.id,
          JSON.stringify({ profile: { firstName: "Sample" }, documents: [] }),
        ])
      ).rows[0].data;
    const c = await bootstrap(customer),
      o = await bootstrap(officer);
    assert.equal(o.role, "customer");
    assert.equal(o.portals.length, 1);
    await assert.rejects(
      db.query(
        "INSERT INTO kynetis.portal_grants(user_id,workspace_id,role,label,reason) VALUES($1,$2,'admin','Admin','Self assigned access')",
        [officer.id, c.workspace],
      ),
      (e) => e.code === "42501",
    );
    await db.query("RESET ROLE");
    await db.query(
      "INSERT INTO kynetis.portal_grants(user_id,workspace_id,role,label,reason) VALUES($1,$2,'compliance_officer','Institution','Operator approved test access')",
      [officer.id, c.workspace],
    );
    await db.query("SET ROLE app_user");
    assert.equal((await bootstrap(officer)).portals.length, 2);
    const event = {
      id: crypto.randomUUID(),
      operation: "test",
      actor: "customer",
      created_at: new Date().toISOString(),
      payload: { test: true },
      previous_hash: "GENESIS",
      digest: "test-digest",
    };
    await db.query("SELECT kynetis.commit($1,0,$2::jsonb,$3::jsonb,$4,null)", [
      c.workspace,
      '{"saved":true}',
      JSON.stringify(event),
      customer.id,
    ]);
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT revision FROM kynetis.workspaces WHERE id=$1",
            [c.workspace],
          )
        ).rows[0].revision,
      ),
      1,
    );
    await assert.rejects(
      db.query("SELECT kynetis.commit($1,0,$2::jsonb,$3::jsonb,$4,null)", [
        c.workspace,
        "{}",
        JSON.stringify(event),
        customer.id,
      ]),
      (e) => e.code === "40001",
    );
    await assert.rejects(
      db.query("DELETE FROM kynetis.events"),
      (e) => e.code === "42501",
    );
    await db.query("RESET ROLE");
    await db.query(
      "UPDATE kynetis.portal_grants SET revoked_at=now() WHERE user_id=$1",
      [officer.id],
    );
    await db.query("SET ROLE app_user");
    assert.equal((await bootstrap(officer)).portals.length, 1);
    await assert.rejects(
      db.query("SELECT kynetis.commit($1,1,$2::jsonb,$3::jsonb,$4,null)", [
        c.workspace,
        "{}",
        JSON.stringify({
          ...event,
          id: crypto.randomUUID(),
          previous_hash: "test-digest",
        }),
        officer.id,
      ]),
      (e) => e.code === "42501",
    );
  } finally {
    await db.close();
  }
});
test("evidence uses private UUID paths and rejects traversal or duplicate writes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kynetis-files-"));
  const old = process.env.EVIDENCE_DIR;
  process.env.EVIDENCE_DIR = dir;
  try {
    assert.throws(() => evidencePath("../../etc/passwd"));
    const key = crypto.randomUUID() + "/" + crypto.randomUUID(),
      bytes = Buffer.from("%PDF-1.7 synthetic");
    await storeEvidence(key, bytes);
    assert.deepEqual(await readEvidence(key), bytes);
    await assert.rejects(storeEvidence(key, bytes), (e) => e.code === "EEXIST");
  } finally {
    if (old === undefined) delete process.env.EVIDENCE_DIR;
    else process.env.EVIDENCE_DIR = old;
    await rm(dir, { recursive: true, force: true });
  }
});
