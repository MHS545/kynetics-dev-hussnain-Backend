// Production Next.js HTTP checks against a disposable embedded PostgreSQL protocol fixture.
// No connection to the user's Docker database, Supabase, or live accounts is made.
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { makeReset } from "../src/modules/auth/accounts.mjs";
const root = path.resolve(import.meta.dirname, "../.."),
  temp = await mkdtemp(path.join(tmpdir(), "kynetis-http-"));
let db,
  socket,
  child,
  apiChild,
  output = "",
  checks = 0;
const pass = (label) => {
  checks++;
  console.log("PASS " + label);
};
// Next.js can redirect with a header, HTML meta tag or a streamed RSC instruction.
function assertPageRedirect(response, target) {
  if (response.status === 307) {
    assert.equal(response.headers.get("location"), target);
    return;
  }
  assert.equal(response.status, 200, "Unexpected protected-page response");
  const html = new TextDecoder().decode(response.body);
  const redirectTag = [...html.matchAll(/<meta\b[^>]*>/g)]
    .map((match) => match[0])
    .find(
      (tag) =>
        tag.includes('http-equiv="refresh"') && tag.includes("url=" + target),
    );
  const redirectInstruction = html.includes(
    "NEXT_REDIRECT;replace;" + target + ";307;",
  );
  assert.ok(
    redirectTag || redirectInstruction,
    "Protected page did not redirect to " + target,
  );
}
async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
try {
  db = new PGlite();
  await db.waitReady;
  await db.exec("CREATE ROLE app_user LOGIN;");
  socket = new PGLiteSocketServer({
    db,
    port: 0,
    host: "127.0.0.1",
    maxConnections: 12,
  });
  await socket.start();
  const pg = new URL("postgresql://" + socket.getServerConn()),
    port = await freePort(),
    base = `http://127.0.0.1:${port}`;
  const backendPort = await freePort();
  apiChild = spawn(process.execPath, ["backend/dist/main.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(backendPort),
      APP_ORIGIN: base,
      AUTH_PROVIDER: "local",
      DB_HOST: pg.hostname,
      DB_PORT: pg.port,
      DB_NAME: "postgres",
      DB_USER: "postgres",
      DB_PASSWORD: "synthetic-local-fixture",
      EVIDENCE_DIR: path.join(temp, "files"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiChild.stdout.on("data", (b) => (output += b));
  apiChild.stderr.on("data", (b) => (output += b));
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
      cwd: path.join(root, "frontend"),
      env: {
        ...process.env,
        AUTH_PROVIDER: "local",
        BACKEND_URL: `http://127.0.0.1:${backendPort}`,
        DB_HOST: pg.hostname,
        DB_PORT: pg.port,
        DB_NAME: "postgres",
        DB_USER: "postgres",
        DB_PASSWORD: "synthetic-local-fixture",
        EVIDENCE_DIR: path.join(temp, "files"),
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (output += b));
  let ready = false;
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(base + "/api/health");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await pause(200);
  }
  assert.ok(ready, "Next server failed: " + output);
  function client() {
    const jar = new Map();
    return async (route, method = "GET", body, extra = {}) => {
      const response = await fetch(base + route, {
        method,
        redirect: "manual",
        headers: {
          Origin: base,
          Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
          ...(body instanceof Uint8Array
            ? {}
            : { "Content-Type": "application/json" }),
          ...extra,
        },
        ...(body !== undefined
          ? { body: body instanceof Uint8Array ? body : JSON.stringify(body) }
          : {}),
      });
      for (const line of response.headers.getSetCookie()) {
        const pair = line.split(";")[0],
          i = pair.indexOf("=");
        jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      const content = response.headers.get("content-type") || "";
      const value = content.includes("application/json")
        ? await response.json()
        : new Uint8Array(await response.arrayBuffer());
      return {
        status: response.status,
        body: value,
        headers: response.headers,
      };
    };
  }
  const guest = client(),
    customer = client(),
    staff = client();
  const h = await guest("/api/health");
  assert.equal(h.body.databaseConnected, true);
  assert.equal(h.body.schemaReady, false);
  pass("server starts with connected database before manual schema");
  assert.equal((await guest("/api/workspace")).status, 401);
  pass("unauthenticated workspace denied");
  await db.exec(
    await readFile(
      path.join(root, "backend/src/database/migrations/01_kynetis_schema.sql"),
      "utf8",
    ),
  );
  assert.equal((await guest("/api/health")).body.schemaReady, true);
  pass("manual schema setup makes database ready");
  for (const route of [
    "/",
    "/login",
    "/register",
    "/register/complete",
    "/forgot-password",
    "/reset-password",
    "/onboard",
    "/auth/link-error",
    "/institution/login",
    "/how-it-works",
    "/help",
    "/data-access",
  ])
    assert.equal((await guest(route)).status, 200, route);
  const callback = new URL(
    (await guest("/auth/callback")).headers.get("location"),
  );
  assert.equal(callback.pathname, "/login");
  assert.equal(callback.port, String(port));
  pass("all existing public screens and authentication callback resolve");
  for (const route of [
    "/customer/dashboard",
    "/customer/profile",
    "/institution/dashboard",
    "/institution/reviews/1",
    "/admin/dashboard",
    "/portals",
    "/client-profile/4",
  ]) {
    assertPageRedirect(await guest(route), "/login");
  }
  assertPageRedirect(
    await guest("/admin/dashboard", "GET", undefined, {
      Cookie: "kynetis_v2_session=" + "a".repeat(43),
    }),
    "/login",
  );
  pass(
    "protected page requests reject missing and fabricated database sessions",
  );
  const loginPage = await guest("/login"),
    html = new TextDecoder().decode(loginPage.body);
  const assets = new Set(
    [...html.matchAll(/(?:href|src)="([^"<>]*\/_next\/static\/[^"<>]+)"/g)].map(
      (m) => m[1],
    ),
  );
  assert.ok(assets.size > 0, "Login HTML must reference built assets");
  for (const asset of assets)
    assert.equal(
      (await guest(asset.replaceAll("&amp;", "&"))).status,
      200,
      asset,
    );
  assert.equal((await guest("/favicon.svg")).status, 200);
  pass("compiled scripts, styles, local fonts and favicon are available");
  const registration = (email) => ({
    firstName: "Local",
    lastName: "Test",
    email,
    nationality: "Pakistan",
    additionalNationalities: [],
    password: "Synthetic-Password-123!",
    confirmPassword: "Synthetic-Password-123!",
    role: "admin",
  });
  assert.equal(
    (
      await guest(
        "/api/auth/register",
        "POST",
        registration("customer@example.test"),
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await guest(
        "/api/auth/register",
        "POST",
        registration("officer@example.test"),
      )
    ).status,
    201,
  );
  pass("actual registration API creates native accounts");
  assert.equal(
    (
      await guest(
        "/api/auth/register",
        "POST",
        registration("CUSTOMER@example.test"),
      )
    ).status,
    409,
  );
  pass("duplicate registration rejected");
  assert.equal(
    (
      await guest("/api/auth/login", "POST", {
        email: "customer@example.test",
        password: "wrong",
      })
    ).status,
    401,
  );
  pass("invalid login rejected");
  let login = await customer("/api/auth/login", "POST", {
    email: "customer@example.test",
    password: "Synthetic-Password-123!",
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.snapshot.role, "customer");
  assert.ok(
    login.headers
      .getSetCookie()
      .some((c) => c.includes("HttpOnly") && c.includes("SameSite=Strict")),
  );
  pass("login uses native HTTP-only sessions; posted admin role ignored");
  assert.equal((await guest("/api/users/me")).status, 401);
  const ownProfile = await customer("/api/users/me");
  assert.equal(ownProfile.status, 200);
  assert.equal(ownProfile.body.email, "customer@example.test");
  assert.equal(ownProfile.body.id, login.body.snapshot.auth.userId);
  assert.equal("password_hash" in ownProfile.body, false);
  assert.equal("metadata" in ownProfile.body, false);
  pass(
    "users module returns only the signed-in account profile and refuses guests",
  );
  assert.equal((await customer("/customer/dashboard")).status, 200);
  for (const section of [
    "profile",
    "consents",
    "documents",
    "risk-profile",
    "guide",
    "access-log",
    "design",
  ])
    assert.equal((await customer("/customer/" + section)).status, 200, section);
  assertPageRedirect(await customer("/customer"), "/customer/dashboard");
  pass("each customer screen has its own working route");
  for (const route of [
    "/admin/dashboard",
    "/institution/dashboard",
    "/client-profile/4",
  ]) {
    assertPageRedirect(await customer(route), "/portals");
  }
  pass(
    "customer page access does not grant administration or institution access",
  );
  assert.equal(
    (
      await customer("/api/workspace", "POST", {
        action: "role",
        role: "admin",
      })
    ).status,
    403,
  );
  pass("customer cannot select an ungranted staff portal");
  assert.equal(
    (
      await customer(
        "/api/workspace",
        "POST",
        { action: "profile", revision: 0, firstName: "Blocked" },
        { Origin: "http://other.example" },
      )
    ).status,
    403,
  );
  pass("cross-origin mutation refused");
  const ids = (
      await db.query("SELECT id,email FROM kynetis.users ORDER BY email")
    ).rows,
    cid = ids.find((u) => u.email === "customer@example.test").id,
    sid = ids.find((u) => u.email === "officer@example.test").id;
  await db.query(
    "INSERT INTO kynetis.portal_grants(user_id,workspace_id,role,label,reason) VALUES($1,$2,'compliance_officer','Institution','Operator approved fixture access'),($1,$2,'admin','Admin','Operator approved fixture access')",
    [sid, cid],
  );
  assert.equal(
    (
      await staff("/api/auth/login", "POST", {
        email: "officer@example.test",
        password: "Synthetic-Password-123!",
      })
    ).status,
    200,
  );
  for (const route of [
    "/institution/dashboard",
    "/institution/reviews/1",
    "/admin/dashboard",
    "/client-profile/4",
  ])
    assert.equal((await staff(route)).status, 200, route);
  pass("database-granted staff can load institution and administration routes");
  for (const section of [
    "lookup",
    "reviews",
    "reports",
    "settings",
    "audit",
    "invitations",
    "guide",
    "design",
  ])
    assert.equal((await staff("/institution/" + section)).status, 200, section);
  for (const section of ["institutions", "users", "guide", "audit", "design"])
    assert.equal((await staff("/admin/" + section)).status, 200, section);
  pass("each institution and administration screen has its own working route");
  let officer = (await staff("/api/workspace")).body;
  const officerGrant = officer.portals.find(
      (p) => p.role === "compliance_officer",
    ),
    adminGrant = officer.portals.find((p) => p.role === "admin");
  let chosen = await staff("/api/workspace", "POST", {
    action: "role",
    role: "compliance_officer",
    portalId: officerGrant.id,
  });
  assert.equal(chosen.status, 200);
  assert.equal(chosen.body.snapshot.role, "compliance_officer");
  pass("registered staff opens explicitly granted institution workspace");
  let response = await staff("/api/workspace", "POST", {
    action: "request-consent",
    revision: chosen.body.snapshot.revision,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  let state = (await customer("/api/workspace")).body;
  const consent = state.state.consents[0].id;
  response = await customer("/api/workspace", "POST", {
    action: "consent",
    choice: "grant",
    id: consent,
    revision: state.revision,
  });
  assert.equal(response.status, 200);
  state = response.body.snapshot;
  pass("institution request and customer consent share database state");
  const bytes = new TextEncoder().encode(
    "%PDF-1.4\nSynthetic test evidence\n%%EOF",
  );
  const prepared = await customer("/api/file", "POST", {
    action: "prepare",
    name: "synthetic.pdf",
    type: "Passport / ID",
    size: bytes.length,
    mime: "application/pdf",
    revision: state.revision,
  });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  assert.equal(
    (
      await customer(
        prepared.body.uploadUrl,
        "PUT",
        new Uint8Array(bytes.length).fill(65),
      )
    ).status,
    415,
  );
  pass("upload MIME signature checked on server");
  assert.equal(
    (await customer(prepared.body.uploadUrl, "PUT", bytes)).status,
    200,
  );
  const complete = await customer("/api/file", "POST", {
    action: "complete",
    ticketId: prepared.body.ticketId,
  });
  assert.equal(complete.status, 200, JSON.stringify(complete.body));
  state = complete.body.snapshot;
  const doc = state.state.documents[0];
  assert.equal(doc.status, "PENDING");
  assert.equal(doc.hash.length, 64);
  pass("private evidence upload completes with hash and audit event");
  assert.deepEqual((await customer("/api/file?id=" + doc.id)).body, bytes);
  assert.equal((await staff("/api/file?id=" + doc.id)).status, 200);
  pass("customer and consent-authorized officer can download original");
  officer = (await staff("/api/workspace")).body;
  assert.equal(
    (
      await staff("/api/workspace", "POST", {
        action: "verify",
        id: doc.id,
        status: "VALID",
        revision: officer.revision,
      })
    ).status,
    200,
  );
  pass("institution officer manually verifies evidence");
  state = (await customer("/api/workspace")).body;
  const concurrent = await Promise.all([
    customer("/api/workspace", "POST", {
      action: "profile",
      phone: "111",
      revision: state.revision,
    }),
    customer("/api/workspace", "POST", {
      action: "profile",
      phone: "222",
      revision: state.revision,
    }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  pass("concurrent stale save conflicts instead of overwriting");
  state = (await customer("/api/workspace")).body;
  assert.equal(
    (
      await customer("/api/workspace", "POST", {
        action: "consent",
        choice: "revoke",
        id: consent,
        revision: state.revision,
      })
    ).status,
    200,
  );
  assert.equal((await staff("/api/file?id=" + doc.id)).status, 403);
  assert.equal((await staff("/api/workspace")).body.state.documents.length, 0);
  pass("revocation blocks officer download and redacts workspace");
  assert.equal(
    (
      await staff("/api/workspace", "POST", {
        action: "role",
        role: "admin",
        portalId: adminGrant.id,
      })
    ).body.snapshot.role,
    "admin",
  );
  pass("administration portal requires its own database grant");
  const token = await makeReset(db, "customer@example.test");
  assert.equal(
    (await guest("/api/auth/recovery?token=" + token)).body.valid,
    true,
  );
  assert.equal(
    (
      await guest("/api/auth/password", "POST", {
        token,
        password: "New-Synthetic-Password!",
        confirmPassword: "New-Synthetic-Password!",
      })
    ).status,
    200,
  );
  assert.equal((await customer("/api/workspace")).status, 401);
  assert.equal(
    (await guest("/api/auth/recovery?token=" + token)).body.valid,
    false,
  );
  pass("one-use password reset invalidates prior sessions");
  assert.equal(
    (
      await customer("/api/auth/login", "POST", {
        email: "customer@example.test",
        password: "New-Synthetic-Password!",
      })
    ).status,
    200,
  );
  assert.equal((await customer("/api/auth/logout", "POST", {})).status, 200);
  assert.equal((await customer("/api/workspace")).status, 401);
  pass("logout revokes database session");
  assertPageRedirect(await customer("/customer/dashboard"), "/login");
  pass("logout also blocks protected page requests");
  assert.equal(
    (
      await guest("/api/auth/recover", "POST", {
        email: "customer@example.test",
      })
    ).status,
    503,
  );
  pass("unconfigured email delivery reported honestly");
  const events = (
    await db.query(
      "SELECT revision,previous_hash,digest FROM kynetis.events WHERE workspace_id=$1 ORDER BY revision",
      [cid],
    )
  ).rows;
  assert.equal(events[0].previous_hash, "GENESIS");
  for (let i = 1; i < events.length; i++)
    assert.equal(events[i].previous_hash, events[i - 1].digest);
  pass("audit chain preserves event order");
  await db.query(
    "UPDATE kynetis.portal_grants SET revoked_at=now() WHERE user_id=$1",
    [sid],
  );
  for (const route of ["/institution/dashboard", "/admin/dashboard"])
    assertPageRedirect(await staff(route), "/portals");
  assert.equal((await staff("/api/workspace")).body.role, "customer");
  pass("revoked grants stop staff page and API access");
  await db.query(
    "UPDATE kynetis.portal_grants SET revoked_at=NULL,created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE user_id=$1",
    [sid],
  );
  for (const route of ["/institution/dashboard", "/admin/dashboard"])
    assertPageRedirect(await staff(route), "/portals");
  assert.equal((await staff("/api/workspace")).body.role, "customer");
  pass("expired grants stop staff page and API access");
  console.log(`HTTP CHECKS PASSED: ${checks}`);
} catch (e) {
  console.error(e);
  console.error(output.slice(-4000));
  process.exitCode = 1;
} finally {
  if (child) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => child.once("exit", r)),
      pause(5000),
    ]);
  }
  if (apiChild) {
    apiChild.kill();
    await pause(500);
  }
  if (socket) await socket.stop();
  if (db) await db.close();
  await rm(temp, { recursive: true, force: true });
}
