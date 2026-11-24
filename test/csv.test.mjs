import assert from "node:assert/strict";
import test from "node:test";
import { csvCell } from "@kynetis/shared/csv";
test("CSV neutralizes entered spreadsheet formulas including leading whitespace", () => {
  for (const value of [
    "=1+1",
    "+SUM(A1)",
    "-1+2",
    "@SUM(A1)",
    ' \t=HYPERLINK("url")',
    "\r=1",
  ])
    assert.ok(csvCell(value).startsWith("\"'"));
});
test("CSV retains quoting and multiline text", () => {
  assert.equal(csvCell('Jamie "Davis"'), '"Jamie ""Davis"""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
});
