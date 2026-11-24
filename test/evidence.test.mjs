import assert from "node:assert/strict";
import test from "node:test";
import { evidenceMime, evidenceSizeError } from "@kynetis/shared/evidence";
test("recognizes supported signatures without trusting filename or supplied MIME", () => {
  assert.equal(
    evidenceMime(new TextEncoder().encode("%PDF-1.7")),
    "application/pdf",
  );
  assert.equal(
    evidenceMime(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/png",
  );
  assert.equal(
    evidenceMime(Uint8Array.from([255, 216, 255, 224])),
    "image/jpeg",
  );
});
test("rejects empty, truncated and renamed executable or HTML file content", () => {
  for (const b of [
    [],
    [37, 80, 68, 70],
    [137, 80, 78, 71],
    [255, 216],
    [77, 90, 0, 0],
    new TextEncoder().encode("<html>"),
  ])
    assert.equal(evidenceMime(Uint8Array.from(b)), "");
});
test("ordinary evidence accepts exactly 10 MiB and rejects empty or larger files", () => {
  assert.equal(evidenceSizeError(10 * 1024 * 1024), "");
  assert.match(evidenceSizeError(10 * 1024 * 1024 + 1), /10 MB/);
  assert.match(evidenceSizeError(0), /empty/);
});
test("requested evidence has a separate 20 MiB limit", () => {
  assert.equal(evidenceSizeError(20 * 1024 * 1024, true), "");
  assert.match(evidenceSizeError(20 * 1024 * 1024 + 1, true), /20 MB/);
});
