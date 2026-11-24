import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  connectFirebaseAccount,
  linkedFirebaseUser,
} from "../src/modules/users/firebase-account.repository.mjs";
import { registerAccount } from "../src/modules/auth/accounts.mjs";

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE app_user LOGIN;");
  await db.exec(
    await readFile(
      new URL(
        "../src/database/migrations/01_kynetis_schema.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const pool = {
    query: db.query.bind(db),
    connect: async () => ({ query: db.query.bind(db), release() {} }),
  };
  return { db, pool };
}
const identity = {
  projectId: "fixture-project",
  uid: "firebase-uid-one",
  email: "person@example.test",
  name: "Test Person",
};

test("Firebase identity creates one local UUID account without a usable local password", async () => {
  const { db, pool } = await fixture();
  try {
    const user = await connectFirebaseAccount(pool, identity, {
      nationality: "Bermuda",
    });
    assert.match(user.id, /^[a-f0-9-]{36}$/);
    assert.equal(user.user_metadata.nationality, "Bermuda");
    const repeated = await connectFirebaseAccount(pool, identity, {
      first_name: "Do not overwrite",
    });
    assert.equal(repeated.id, user.id);
    assert.equal(repeated.user_metadata.first_name, "Test");
    const { rows } = await db.query("SELECT password_hash FROM kynetis.users");
    assert.ok(rows[0].password_hash.startsWith("firebase-only:"));
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM kynetis.users")).rows[0].n,
      1,
    );
    assert.equal(
      await linkedFirebaseUser(pool, "other-project", identity.uid),
      null,
    );
  } finally {
    await db.close();
  }
});

test("matching email cannot claim an existing account without its original password", async () => {
  const { db, pool } = await fixture();
  try {
    const original = await registerAccount(pool, {
      email: identity.email,
      password: "Original-Password-123",
      metadata: { first_name: "Original", nationality: "Bermuda" },
    });
    const preservedState = {
      documents: [{ id: "existing-private-document" }],
      consents: [{ id: "existing-consent" }],
    };
    await db.query(
      "INSERT INTO kynetis.workspaces(id,owner_id,state) VALUES($1,$1,$2::jsonb)",
      [original.id, JSON.stringify(preservedState)],
    );
    await db.query(
      "INSERT INTO kynetis.memberships(user_id,workspace_id,role) VALUES($1,$1,'customer')",
      [original.id],
    );
    await db.query(
      "INSERT INTO kynetis.portal_grants(user_id,workspace_id,role,label,reason) VALUES($1,$1,'compliance_officer','Existing institution','Preserve the existing explicit grant')",
      [original.id],
    );
    await db.query(
      "INSERT INTO kynetis.sessions(token_hash,user_id,expires_at) VALUES('old-session',$1,now()+interval '1 hour')",
      [original.id],
    );
    await assert.rejects(connectFirebaseAccount(pool, identity), {
      code: "ACCOUNT_LINK_REQUIRED",
    });
    await assert.rejects(
      connectFirebaseAccount(pool, identity, {}, "Wrong-Password-123"),
      /incorrect/,
    );
    assert.equal(
      await linkedFirebaseUser(pool, identity.projectId, identity.uid),
      null,
    );
    const linked = await connectFirebaseAccount(
      pool,
      identity,
      { first_name: "Replacement" },
      "Original-Password-123",
    );
    assert.equal(linked.id, original.id);
    assert.equal(linked.user_metadata.first_name, "Original");
    assert.equal(linked.user_metadata.nationality, "Bermuda");
    assert.deepEqual(
      (
        await db.query("SELECT state FROM kynetis.workspaces WHERE id=$1", [
          original.id,
        ])
      ).rows[0].state,
      preservedState,
    );
    assert.equal(
      (
        await db.query(
          "SELECT role FROM kynetis.portal_grants WHERE user_id=$1",
          [original.id],
        )
      ).rows[0].role,
      "compliance_officer",
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM kynetis.sessions WHERE user_id=$1",
          [original.id],
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(
      connectFirebaseAccount(
        pool,
        { ...identity, uid: "different-uid" },
        {},
        "Original-Password-123",
      ),
      /cannot be linked/,
    );
    await db.query("UPDATE kynetis.users SET active=false WHERE id=$1", [
      original.id,
    ]);
    assert.equal(
      await linkedFirebaseUser(pool, identity.projectId, identity.uid),
      null,
    );
    await assert.rejects(connectFirebaseAccount(pool, identity), /disabled/);
    await assert.rejects(
      connectFirebaseAccount(pool, {
        ...identity,
        email: "changed@example.test",
      }),
      /disabled/,
    );
  } finally {
    await db.close();
  }
});

test("Firebase sign-in needs a usable email and does not accept a missing identity", async () => {
  const { db, pool } = await fixture();
  try {
    await assert.rejects(
      connectFirebaseAccount(pool, { ...identity, email: undefined }),
      /email address/,
    );
    await assert.rejects(
      connectFirebaseAccount(pool, { ...identity, uid: "" }),
      /email address/,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM kynetis.users")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
