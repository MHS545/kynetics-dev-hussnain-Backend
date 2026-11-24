import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { setTimeout as pause } from "node:timers/promises";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
if (process.env.KYNETIS_FIREBASE_SMOKE !== "1") {
  console.log(
    "Set KYNETIS_FIREBASE_SMOKE=1 to use disposable Firebase accounts for Chrome verification.",
  );
  process.exit(0);
}
const root = path.resolve(import.meta.dirname, "../..");
const temporary = await mkdtemp(path.join(tmpdir(), "kynetis-nest-browser-"));
const email = "kynetis-check-" + randomUUID() + "@example.test";
const password = "Check-" + randomUUID() + "!";
const admin = getAuth(
  initializeApp({
    projectId: "kynetis-dev-hussnain-d0fba",
    credential: applicationDefault(),
  }),
);
let db,
  socket,
  backend,
  frontend,
  browser,
  registered = false,
  checks = 0;
const pass = (message) => {
  checks++;
  console.log("PASS " + message);
};
async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
try {
  db = new PGlite();
  await db.exec("CREATE ROLE app_user LOGIN;");
  await db.exec(
    await readFile(
      path.join(root, "backend/src/database/migrations/01_kynetis_schema.sql"),
      "utf8",
    ),
  );
  socket = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 12,
  });
  await socket.start();
  const pg = new URL("postgresql://" + socket.getServerConn());
  const apiPort = await port(),
    frontPort = await port();
  const base = `http://localhost:${frontPort}`;
  backend = spawn(process.execPath, ["backend/dist/main.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(apiPort),
      APP_ORIGIN: base,
      AUTH_PROVIDER: "firebase",
      DB_HOST: pg.hostname,
      DB_PORT: pg.port,
      DB_NAME: "postgres",
      DB_USER: "postgres",
      DB_PASSWORD: "fixture",
      EVIDENCE_DIR: temporary,
    },
    stdio: "ignore",
  });
  frontend = spawn(
    process.execPath,
    [
      "../node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(frontPort),
    ],
    {
      cwd: path.join(root, "frontend"),
      env: {
        ...process.env,
        BACKEND_URL: `http://127.0.0.1:${apiPort}`,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "ignore",
    },
  );
  let ready = false;
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await pause(250);
  }
  assert.ok(ready, "Browser fixture servers did not start.");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/register");
  await page.getByLabel("First name", { exact: true }).fill("Browser");
  await page.getByLabel("Last name", { exact: true }).fill("Check");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.locator("#nationality").selectOption("Bermuda");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  registered = true;
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your profile is ready", exact: true })
    .waitFor({ timeout: 60000 });
  pass(
    "Chrome registration creates a Firebase identity and PostgreSQL workspace through NestJS",
  );
  await page
    .getByRole("button", { name: "Continue to sign in", exact: true })
    .click();
  await page.waitForURL("**/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/customer/dashboard", { timeout: 60000 });
  pass(
    "Chrome email/password sign-in opens the dashboard using a Nest-issued session",
  );
  await page.goto(base + "/customer/profile");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page.getByLabel("Phone", { exact: true }).fill("555010123");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit profile", exact: true })
    .waitFor();
  await page.reload();
  assert.equal(
    await page.getByLabel("Phone", { exact: true }).inputValue(),
    "555010123",
  );
  const saved = await db.query(
    "SELECT state->'profile'->>'phone' AS phone,revision FROM kynetis.workspaces",
  );
  assert.equal(saved.rows[0].phone, "555010123");
  assert.equal(Number(saved.rows[0].revision), 1);
  pass("profile save reaches PostgreSQL and survives protected-page refresh");
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .first()
    .click();
  await page.waitForURL("**/login");
  assert.equal((await page.request.get(base + "/api/workspace")).status(), 401);
  pass("logout clears the v2 session and blocks workspace access");
  const popupPromise = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  const popup = await popupPromise;
  await popup.waitForURL((url) => url.hostname === "accounts.google.com", {
    timeout: 60000,
  });
  pass("Google popup reaches the real Google account chooser");
  await popup.close();
  await page
    .getByRole("alert")
    .filter({ hasText: /closed/i })
    .waitFor({ timeout: 15000 });
  assert.equal(errors.length, 0, "Browser page JavaScript errors occurred.");
  pass(
    "Google cancellation is recoverable and no page JavaScript errors occurred",
  );
  await mkdir(path.join(root, ".logs"), { recursive: true });
  await page.goto(base + "/login");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(root, ".logs/login-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(root, ".logs/login-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  pass("desktop and mobile public-login screenshots captured");
  console.log(
    `PASS ${checks} browser checks. Personal Google consent and reset-email delivery remain manual.`,
  );
} catch (error) {
  console.error(
    error instanceof Error &&
      !/token|credential|private|password/i.test(error.message)
      ? error.message.slice(0, 300)
      : "Browser verification failed at the last reported boundary.",
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  frontend?.kill();
  backend?.kill();
  await pause(500);
  await socket?.stop();
  await db?.close();
  await rm(temporary, { recursive: true, force: true });
  if (registered) {
    try {
      const user = await admin.getUserByEmail(email);
      await admin.deleteUser(user.uid);
      console.log("Temporary browser-test Firebase account deleted.");
    } catch (error) {
      if (error.code !== "auth/user-not-found") {
        console.error("Temporary Firebase account cleanup failed.");
        process.exitCode = 1;
      }
    }
  }
}
