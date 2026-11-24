import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
// Nest owns the API. This adapter preserves validated Web Request/Response rules.
const requests = new WeakMap<ExpressRequest, Request>();
export function webRequest(request: ExpressRequest): Request {
  const cached = requests.get(request);
  if (cached) return cached;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value))
      value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  const url = new URL(
    request.originalUrl,
    "http://" + (request.get("host") || "127.0.0.1"),
  );
  const body = ["GET", "HEAD"].includes(request.method)
    ? undefined
    : new Uint8Array(request.body || []);
  const result = new Request(url, { method: request.method, headers, body });
  requests.set(request, result);
  return result;
}
export async function send(
  response: ExpressResponse,
  result: Promise<Response> | Response,
) {
  const output = await result;
  response.status(output.status);
  output.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") response.setHeader(key, value);
  });
  const cookies = output.headers.getSetCookie();
  if (cookies.length) response.setHeader("Set-Cookie", cookies);
  response.send(Buffer.from(await output.arrayBuffer()));
}
