import assert from "node:assert/strict";
import test from "node:test";
import {
  missingEnvironment,
  canPreviewRoles,
} from "../dist/config/environment.js";
test("local setup requires only server-side DB credentials", () => {
  assert.deepEqual(missingEnvironment({}), ["DB_PASSWORD"]);
  assert.deepEqual(missingEnvironment({ DB_PASSWORD: "local-test" }), []);
});
test("there is no client-selectable preview role bypass", () => {
  process.env.KYNETIS_DEMO_OWNER_EMAIL = "owner@example.test";
  assert.equal(canPreviewRoles(), false);
  delete process.env.KYNETIS_DEMO_OWNER_EMAIL;
});
