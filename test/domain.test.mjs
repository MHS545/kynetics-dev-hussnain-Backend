import assert from "node:assert/strict";
import test from "node:test";
import { seed, apply, blockers, redact } from "@kynetis/shared/domain";
const step = (s, r, a, p = {}) => apply(s, r, a, p).state,
  grant = (s) =>
    step(s, "customer", "consent", { id: s.consents[0].id, choice: "grant" }),
  doc = (id, type) => ({
    id,
    type,
    name: id + ".pdf",
    key: id,
    hash: "hash-" + id,
    mime: "application/pdf",
    size: 20,
    status: "PENDING",
  });
const ready = () => {
  let s = grant(seed());
  for (const [id, type] of [
    ["identity", "Passport / ID"],
    ["address", "Proof of Residential Address"],
  ]) {
    s = step(s, "customer", "upload", { document: doc(id, type) });
    s = step(s, "compliance_officer", "verify", { id, status: "VALID" });
  }
  return s;
};
test("role checks reject customer and admin officer mutations", () => {
  assert.throws(
    () => step(seed(), "customer", "policy", { days: 61 }),
    /Officer/,
  );
  assert.throws(() => step(seed(), "admin", "request-consent"), /Officer/);
});
test("grant-revoke-new-request keeps exact authorization history", () => {
  let s = grant(seed());
  s = step(s, "customer", "consent", {
    id: s.consents[0].id,
    choice: "revoke",
  });
  assert.equal(s.consents[0].status, "REVOKED");
  s = step(s, "compliance_officer", "request-consent");
  assert.equal(s.consents.length, 2);
  assert.equal(s.consents[1].status, "PENDING");
});
test("denial cannot be granted later on same record", () => {
  const s = step(seed(), "customer", "consent", {
    id: "consent-bcp-1",
    choice: "deny",
  });
  assert.equal(s.consents[0].status, "REVOKED");
  assert.throws(
    () =>
      step(s, "customer", "consent", { id: "consent-bcp-1", choice: "grant" }),
    /changed/,
  );
});
test("redaction hides documents and private fields without consent", () => {
  const s = step(seed(), "customer", "upload", {
    document: doc("a", "Passport / ID"),
  });
  assert.equal(redact(s, "compliance_officer").documents.length, 0);
  assert.equal(redact(s, "compliance_officer").profile.email, "");
  assert.equal(redact(grant(s), "compliance_officer").documents.length, 1);
  assert.equal(redact(s, "admin").documents.length, 0);
});
test("requests require consent and bounded due days", () => {
  const p = { category: "Other", note: "Need evidence", days: 14 };
  assert.throws(
    () => step(seed(), "compliance_officer", "request-document", p),
    /consent/,
  );
  assert.throws(
    () =>
      step(grant(seed()), "compliance_officer", "request-document", {
        ...p,
        days: 1,
      }),
    /days/,
  );
});
test("request upload must match category, verification resolves it", () => {
  let s = step(grant(seed()), "compliance_officer", "request-document", {
    category: "Other",
    note: "Need evidence",
    days: 14,
  });
  const id = s.requests[0].id;
  assert.throws(
    () =>
      step(s, "customer", "upload", {
        document: { ...doc("a", "Passport / ID"), requestId: id },
      }),
    /match/,
  );
  s = step(s, "customer", "upload", {
    document: { ...doc("a", "Other"), requestId: id },
  });
  assert.equal(s.requests[0].status, "UPLOADED");
  s = step(s, "compliance_officer", "verify", { id: "a", status: "VALID" });
  assert.equal(s.requests[0].status, "VERIFIED");
});
test("server blocks clearance with missing verified evidence", () =>
  assert.throws(
    () =>
      step(grant(seed()), "compliance_officer", "decide", {
        outcome: "CLEARED",
        notes: "Checked",
        sign1: true,
        sign2: true,
      }),
    /verified/,
  ));
test("server blocks clearance without both signoffs", () => {
  const s = ready();
  assert.equal(blockers(s).length, 0);
  assert.throws(
    () =>
      step(s, "compliance_officer", "decide", {
        outcome: "CLEARED",
        notes: "Checked",
        sign1: true,
        sign2: false,
      }),
    /sign-offs/,
  );
});
test("final decision remains frozen after later uploads and locks repeat decisions", () => {
  let s = step(ready(), "compliance_officer", "decide", {
    outcome: "CLEARED",
    notes: "Reviewed evidence",
    sign1: true,
    sign2: true,
  });
  const frozen = JSON.stringify(s.review.decision);
  s = step(s, "customer", "upload", { document: doc("next", "Passport / ID") });
  assert.equal(JSON.stringify(s.review.decision), frozen);
  assert.equal(s.review.decision.documents.length, 2);
  assert.throws(
    () =>
      step(s, "compliance_officer", "decide", {
        outcome: "REJECTED",
        notes: "Changed",
        reason: "Other",
      }),
    /locked/,
  );
});
test("rejection requires reason and notes without clearance signoffs", () => {
  const s = grant(seed());
  assert.throws(
    () =>
      step(s, "compliance_officer", "decide", {
        outcome: "REJECTED",
        notes: "Checked",
      }),
    /reason/,
  );
  assert.equal(
    step(s, "compliance_officer", "decide", {
      outcome: "REJECTED",
      notes: "Evidence missing",
      reason: "Other",
    }).review.status,
    "REJECTED",
  );
});
test("policy persists 60-61-60 and rejects out-of-range and fractional values", () => {
  let s = step(seed(), "compliance_officer", "policy", { days: 61 });
  assert.equal(s.policyDays, 61);
  s = step(s, "compliance_officer", "policy", { days: 60 });
  assert.equal(s.policyDays, 60);
  for (const days of [0, 366, 1.5])
    assert.throws(
      () => step(s, "compliance_officer", "policy", { days }),
      /whole number/,
    );
});
test("profile rejects blank required name and future birth date", () => {
  assert.throws(
    () => step(seed(), "customer", "profile", { firstName: " " }),
    /required/,
  );
  assert.throws(
    () => step(seed(), "customer", "profile", { dob: "2999-01-01" }),
    /date of birth/,
  );
});
test("revocation hides previously available decision while preserving stored snapshot", () => {
  let s = step(ready(), "compliance_officer", "decide", {
    outcome: "CLEARED",
    notes: "Reviewed evidence",
    sign1: true,
    sign2: true,
  });
  s = step(s, "customer", "consent", {
    id: s.consents[0].id,
    choice: "revoke",
  });
  assert.equal(redact(s, "compliance_officer").review.decision, undefined);
  assert.ok(s.review.decision);
});
test("checklists and invitation drafts are authorized and persist in workspace state", () => {
  let s = seed();
  const pack = {
    id: "custom",
    name: "Individual checks",
    description: "Identity evidence",
    version: 99,
    requirements: [
      {
        id: "id",
        category: "Proof of identity",
        minimum: 1,
        required: true,
        notarized: false,
      },
    ],
  };
  assert.throws(
    () => step(s, "customer", "pack-save", { pack, publish: true }),
    /Officer/,
  );
  s = step(s, "compliance_officer", "pack-save", { pack, publish: false });
  assert.equal(
    s.institutional.packs.find((p) => p.id === "custom").status,
    "DRAFT",
  );
  const invitation = {
    email: "User@Example.test",
    name: "Test user",
    relationship: "Personal",
    accountType: "Individual",
    packId: "custom",
    requirements: pack.requirements,
    message: "",
    relatedParties: ["Representative"],
  };
  assert.throws(
    () => step(s, "compliance_officer", "invitation-save", { invitation }),
    /published/,
  );
  s = step(s, "compliance_officer", "pack-save", { pack, publish: true });
  assert.equal(s.institutional.packs.find((p) => p.id === "custom").version, 1);
  s = step(s, "compliance_officer", "invitation-save", { invitation });
  assert.equal(s.institutional.invitations[0].email, "user@example.test");
  assert.equal(s.institutional.invitations[0].packVersion, 1);
  assert.equal(s.institutional.invitations[0].status, "DRAFT");
  assert.throws(
    () => step(s, "compliance_officer", "invitation-save", { invitation }),
    /already exists/,
  );
  const frozen = JSON.stringify(s.institutional.invitations[0].requirements);
  s = step(s, "compliance_officer", "pack-save", {
    pack: { ...pack, requirements: [{ ...pack.requirements[0], minimum: 2 }] },
    publish: true,
  });
  assert.equal(
    JSON.stringify(s.institutional.invitations[0].requirements),
    frozen,
  );
  assert.equal(redact(s, "customer").institutional, undefined);
  s = step(s, "compliance_officer", "pack-delete", { id: "custom" });
  assert.ok(!s.institutional.packs.some((p) => p.id === "custom"));
  assert.ok(s.institutional.archivedPacks.some((p) => p.id === "custom"));
  s = step(s, "compliance_officer", "pack-restore", { id: "custom" });
  assert.ok(s.institutional.packs.some((p) => p.id === "custom"));
  s = step(s, "compliance_officer", "invitation-cancel", {
    id: s.institutional.invitations[0].id,
  });
  assert.equal(s.institutional.invitations[0].status, "CANCELLED");
});
test("server rejects malformed checklists, quantities and invitation payloads", () => {
  const pack = {
    id: "invalid",
    name: "Checklist",
    description: "",
    requirements: [
      {
        id: "r",
        category: "Proof of identity",
        minimum: 1,
        required: true,
        notarized: false,
      },
    ],
  };
  for (const minimum of [0, 11, 1.2, "1"])
    assert.throws(
      () =>
        step(seed(), "compliance_officer", "pack-save", {
          pack: {
            ...pack,
            requirements: [{ ...pack.requirements[0], minimum }],
          },
        }),
      /Minimum/,
    );
  assert.throws(
    () =>
      step(seed(), "compliance_officer", "pack-save", {
        pack: { ...pack, requirements: [] },
      }),
    /1–30/,
  );
  assert.throws(
    () =>
      step(seed(), "compliance_officer", "pack-save", {
        pack: {
          ...pack,
          requirements: [
            { ...pack.requirements[0], category: "Other / custom evidence" },
          ],
        },
      }),
    /custom/,
  );
  assert.throws(
    () =>
      step(seed(), "compliance_officer", "invitation-save", {
        invitation: { email: "invalid" },
      }),
    /email/,
  );
});
test("decision records the verified API actor and actual review identifier", () => {
  const s = ready();
  s.review.id = 17;
  const result = apply(s, "compliance_officer", "decide", {
    outcome: "CLEARED",
    notes: "Evidence reviewed",
    sign1: true,
    sign2: true,
    actorName: "Authorized reviewer",
    actorId: "verified-user",
  });
  assert.equal(result.state.review.decision.actor, "Authorized reviewer");
  assert.equal(result.state.review.decision.actorUserId, "verified-user");
  assert.equal(result.payload.reviewId, 17);
});
