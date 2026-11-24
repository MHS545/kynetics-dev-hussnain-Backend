// Opt-in live Firebase verification. Uses a disposable local database and
// temporary example.test Firebase users that are deleted in finally. Sends no email.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as pause } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { registerAccount } from "../src/modules/auth/accounts.mjs";

if (process.env.KYNETIS_FIREBASE_SMOKE !== "1") {
  console.log(
    "Opt-in required: set KYNETIS_FIREBASE_SMOKE=1 to test live Firebase with disposable users.",
  );
  process.exit(0);
}
const root = new URL("../../", import.meta.url);
const projectId = "kynetis-dev-hussnain-d0fba";
const apiKey = "AIzaSyDhc4VMGmV5FGdcFPTtBfV6XwI7iPE32a8";
const admin = getAuth(
  initializeApp({ projectId, credential: applicationDefault() }),
);
const temporaryUsers = [];
let db, socket, child, apiChild;
let checks = 0;
const pass = (label) => {
  checks++;
  console.log("PASS " + label);
};
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
try {
  db = new PGlite();
  await db.exec("CREATE ROLE app_user LOGIN;");
  await db.exec(
    await readFile(
      new URL("backend/src/database/migrations/01_kynetis_schema.sql", root),
      "utf8",
    ),
  );
  socket = new PGLiteSocketServer({
    db,
    port: 0,
    host: "127.0.0.1",
    maxConnections: 12,
  });
  await socket.start();
  const pg = new URL("postgresql://" + socket.getServerConn());
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const backendPort = await freePort();
  apiChild = spawn(process.execPath, ["backend/dist/main.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(backendPort),
      APP_ORIGIN: base,
      AUTH_PROVIDER: "firebase",
      DB_HOST: pg.hostname,
      DB_PORT: pg.port,
      DB_NAME: "postgres",
      DB_USER: "postgres",
      DB_PASSWORD: "disposable-fixture",
    },
    stdio: "ignore",
  });
  child = spawn(
    process.execPath,
    [
      "../node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: new URL("frontend/", root),
      env: {
        ...process.env,
        AUTH_PROVIDER: "firebase",
        BACKEND_URL: `http://127.0.0.1:${backendPort}`,
        DB_HOST: pg.hostname,
        DB_PORT: pg.port,
        DB_NAME: "postgres",
        DB_USER: "postgres",
        DB_PASSWORD: "disposable-fixture",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "ignore",
    },
  );
  let ready = false;
  for (let n = 0; n < 240; n++) {
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await pause(250);
  }
  assert.ok(ready, "Production test server did not start.");
  function client() {
    const cookies = new Map();
    return async (route, method = "GET", body, origin = base) => {
      const response = await fetch(base + route, {
        method,
        redirect: "manual",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: [...cookies]
            .map(([key, value]) => `${key}=${value}`)
            .join("; "),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [key, ...value] = cookie.split(";")[0].split("=");
        cookies.set(key, value.join("="));
      }
      const value = response.headers
        .get("content-type")
        ?.includes("application/json")
        ? await response.json()
        : await response.text();
      return {
        status: response.status,
        body: value,
        headers: response.headers,
      };
    };
  }
  async function firebaseIdentity() {
    const uid = "kynetis-check-" + randomUUID();
    const email = uid + "@example.test";
    const password = "Test-" + randomUUID() + "!";
    await admin.createUser({ uid, email, password });
    temporaryUsers.push(uid);
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    assert.equal(
      response.status,
      200,
      "Firebase email/password authentication failed.",
    );
    const result = await response.json();
    return { uid, email, idToken: result.idToken };
  }
  const guest = client();
  assert.equal((await guest("/api/workspace")).status, 401);
  assert.equal(
    (
      await guest("/api/auth/login", "POST", {
        email: "x@example.test",
        password: "wrong",
      })
    ).status,
    403,
  );
  assert.equal((await guest("/api/auth/register", "POST", {})).status, 403);
  assert.equal((await guest("/api/auth/password", "POST", {})).status, 403);
  pass("Firebase mode blocks legacy local authentication and reset endpoints");
  assert.equal(
    (await guest("/api/auth/firebase", "POST", { idToken: "forged" })).status,
    401,
  );
  assert.equal(
    (
      await guest(
        "/api/auth/firebase",
        "POST",
        {},
        "https://other.example.test",
      )
    ).status,
    403,
  );
  pass("forged tokens and cross-origin session creation are refused");

  const identity = await firebaseIdentity();
  const customer = client();
  const login = await customer("/api/auth/firebase", "POST", {
    idToken: identity.idToken,
  });
  assert.equal(
    login.status,
    200,
    "Verified Firebase sign-in did not open a workspace.",
  );
  assert.equal(login.body.snapshot.role, "customer");
  assert.equal(login.body.snapshot.auth.authenticated, true);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
  const userId = login.body.snapshot.auth.userId;
  pass(
    "real Firebase email/password login creates a customer workspace and protected cookie",
  );
  assert.equal((await customer("/api/auth/session")).body.authenticated, true);
  assert.equal((await customer("/api/workspace")).body.auth.userId, userId);
  const profile = await customer("/customer/profile");
  assert.equal(profile.status, 200);
  assert.ok(!profile.body.includes("NEXT_REDIRECT;replace;/login;"));
  assert.equal(
    (
      await customer("/api/workspace", "POST", {
        action: "role",
        role: "admin",
      })
    ).status,
    403,
  );
  pass(
    "Firebase session reaches protected pages and retains PostgreSQL role checks",
  );
  await customer("/api/auth/logout", "POST");
  assert.equal((await customer("/api/workspace")).status, 401);
  pass("logout clears the protected session");

  const linkedIdentity = await firebaseIdentity();
  const original = await registerAccount(db, {
    email: linkedIdentity.email,
    password: "Original-Password-123",
    metadata: { first_name: "Preserved" },
  });
  const linked = client();
  assert.equal(
    (
      await linked("/api/auth/firebase", "POST", {
        idToken: linkedIdentity.idToken,
      })
    ).body.code,
    "ACCOUNT_LINK_REQUIRED",
  );
  assert.equal(
    (
      await linked("/api/auth/firebase", "POST", {
        idToken: linkedIdentity.idToken,
        existingPassword: "Wrong-Password",
      })
    ).status,
    401,
  );
  const connected = await linked("/api/auth/firebase", "POST", {
    idToken: linkedIdentity.idToken,
    existingPassword: "Original-Password-123",
  });
  assert.equal(connected.status, 200);
  assert.equal(connected.body.snapshot.auth.userId, original.id);
  assert.equal(connected.body.snapshot.state.profile.firstName, "Preserved");
  pass(
    "existing accounts require the original password and retain their local identity/profile",
  );
  await admin.updateUser(linkedIdentity.uid, { disabled: true });
  assert.equal((await linked("/api/workspace")).status, 401);
  pass("disabling the Firebase account invalidates its application session");
  console.log(
    `PASS ${checks} Firebase integration checks. Google popup requires the account owner's browser.`,
  );
} catch {
  // Never dump Firebase responses, tokens or credentials into logs.
  console.error(
    `Firebase integration check failed after ${checks} completed checks. Inspect the last passing boundary.`,
  );
  process.exitCode = 1;
} finally {
  if (child) {
    child.kill();
    await pause(400);
  }
  if (apiChild) {
    apiChild.kill();
    await pause(500);
  }
  if (socket) await socket.stop();
  if (db) await db.close();
  let cleanupFailed = false;
  for (const uid of temporaryUsers) {
    try {
      await admin.deleteUser(uid);
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) {
    console.error(
      "Temporary Firebase user cleanup failed. Remove accounts prefixed kynetis-check- from the Firebase console.",
    );
    process.exitCode = 1;
  } else if (temporaryUsers.length)
    console.log(
      "Temporary Firebase test users deleted. Existing PostgreSQL records were not used.",
    );
}
