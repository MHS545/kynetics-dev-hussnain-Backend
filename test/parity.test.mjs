import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import ts from "typescript";
const baseline = JSON.parse(
  await readFile(new URL("./ui-reference.json", import.meta.url), "utf8"),
);
function jsxHash(file, text) {
  const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
    printer = ts.createPrinter();
  const parts = [];
  function visit(node) {
    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    ) {
      parts.push(printer.printNode(ts.EmitHint.Unspecified, node, source));
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}
test("rendered screen markup, styles and public assets match the original reference", async () => {
  for (const [file, expected] of Object.entries(baseline)) {
    const bytes = await readFile(new URL("../../" + file, import.meta.url));
    const actual =
      expected.kind === "jsx"
        ? jsxHash(file, bytes.toString("utf8"))
        : createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, expected.hash, file);
  }
});
