import assert from "node:assert/strict";
import test from "node:test";
import {
  registrationErrors,
  profileFromRegistration,
} from "@kynetis/shared/registration";
import { countries } from "@kynetis/shared/countries";
import { apply, redact } from "@kynetis/shared/domain";
import { initialCustomerState } from "../dist/modules/workspace/customer-profile.js";
const good = {
  firstName: "Jamie",
  lastName: "Davis",
  email: "jamie@example.test",
  nationality: "Pakistan",
  additionalNationalities: ["Canada"],
  password: "Synthetic-test-password",
  confirmPassword: "Synthetic-test-password",
};
test("registration accepts the PDF fields and the 249 country choices", () => {
  assert.equal(countries.length, 249);
  assert.equal(new Set(countries.map((c) => c.code)).size, 249);
  assert.deepEqual(registrationErrors(good), {});
});
test("registration rejects incomplete, malformed and inconsistent input", () => {
  assert.equal(Object.keys(registrationErrors({})).length, 6);
  for (const bad of [
    null,
    [],
    { firstName: 4, lastName: {}, email: [], password: true },
    { ...good, password: "short" },
    { ...good, confirmPassword: "different" },
    { ...good, nationality: "not a country" },
  ])
    assert.ok(Object.keys(registrationErrors(bad)).length > 0);
});
test("additional nationalities cannot repeat the primary or each other", () => {
  for (const additionalNationalities of [
    ["Pakistan"],
    ["Canada", "Canada"],
    [""],
    ["unknown"],
    { country: "Canada" },
  ])
    assert.ok(
      registrationErrors({ ...good, additionalNationalities })
        .additionalNationalities,
    );
});
test("profile metadata excludes passwords and caller-supplied permissions", () => {
  const metadata = profileFromRegistration({
    ...good,
    role: "admin",
    workspace: "someone-else",
  });
  assert.deepEqual(Object.keys(metadata).sort(), [
    "additional_nationalities",
    "first_name",
    "last_name",
    "nationality",
  ]);
  assert.equal(JSON.stringify(metadata).includes(good.password), false);
});
test("a registered customer starts with their own details and no institution access", () => {
  const u = {
    id: "10000000-0000-4000-8000-000000000003",
    email: good.email,
    user_metadata: {
      ...profileFromRegistration(good),
      registration_source: "kynetis",
      role: "admin",
    },
  };
  const state = initialCustomerState(u);
  assert.equal(state.profile.firstName, "Jamie");
  assert.equal(state.profile.email, good.email);
  assert.deepEqual(state.profile.additionalNationalities, ["Canada"]);
  assert.equal(state.consents.length, 0);
  assert.equal(state.documents.length, 0);
  assert.equal(state.institutions.length, 0);
  assert.equal(state.profile.kyc, initialCustomerState(u).profile.kyc);
  assert.notEqual(
    state.profile.kyc,
    initialCustomerState({ ...u, id: "10000000-0000-4000-8000-000000000004" })
      .profile.kyc,
  );
});
test("nationality updates persist while restricted roles cannot see them", () => {
  const state = initialCustomerState({
    id: "test-user",
    email: good.email,
    user_metadata: {
      ...profileFromRegistration(good),
      registration_source: "kynetis",
    },
  });
  const updated = apply(state, "customer", "profile", {
    additionalNationalities: ["United Kingdom"],
  }).state;
  assert.deepEqual(updated.profile.additionalNationalities, ["United Kingdom"]);
  assert.throws(() =>
    apply(state, "customer", "profile", {
      additionalNationalities: ["Pakistan"],
    }),
  );
  assert.throws(() =>
    apply(state, "customer", "profile", {
      additionalNationalities: ["Canada", "Canada"],
    }),
  );
  for (const role of ["admin", "compliance_officer"])
    assert.deepEqual(redact(updated, role).profile.additionalNationalities, []);
});

test("accounts created outside Kynetis never receive another person's sample profile", () => {
  const s = initialCustomerState({
    id: "fresh-account",
    email: "fresh@example.test",
    user_metadata: { role: "admin" },
  });
  assert.equal(s.profile.firstName, "");
  assert.equal(s.profile.email, "fresh@example.test");
  assert.equal(s.profile.phone, "");
  assert.equal(s.consents.length, 0);
  assert.equal(s.institutions.length, 0);
  assert.notEqual(s.profile.kyc, "TB-8F4A-72X9-114");
});
