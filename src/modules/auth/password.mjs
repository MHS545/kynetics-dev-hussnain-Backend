import {
  randomBytes,
  scrypt as derive,
  timingSafeEqual,
  createHash,
} from "node:crypto";
const params = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function key(password, salt) {
  return new Promise((resolve, reject) =>
    derive(password, salt, 64, params, (e, k) => (e ? reject(e) : resolve(k))),
  );
}
export async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await key(password, salt)).toString("hex")}`;
}
export async function passwordMatches(password, hash) {
  if (
    typeof hash !== "string" ||
    !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash)
  )
    return false;
  const [, salt, expected] = hash.split(":");
  const actual = await key(password, salt);
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
export const randomToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (value) =>
  createHash("sha256").update(value).digest("hex");
