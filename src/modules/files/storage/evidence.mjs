import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
export function evidencePath(key) {
  if (
    typeof key !== "string" ||
    !/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(
      key,
    )
  )
    throw new Error("Invalid private file key.");
  return path.resolve(
    /* turbopackIgnore: true */ process.env.EVIDENCE_DIR || "./data/evidence",
    key,
  );
}
export async function storeEvidence(key, bytes) {
  const target = evidencePath(key);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
}
export async function readEvidence(key) {
  return readFile(/* turbopackIgnore: true */ evidencePath(key));
}
export async function boundedBytes(req, limit) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("File body is missing.");
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("File exceeds its reserved size.");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, length);
  } finally {
    reader.releaseLock();
  }
}
