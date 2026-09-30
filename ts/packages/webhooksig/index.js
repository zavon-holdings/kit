// Twin of kit/go/webhooksig. Byte-identical output: the signature is the hex
// HMAC-SHA256 of "<unix seconds>.<raw body>" (X-Zavon-Signature beside
// X-Zavon-Timestamp), optionally as a "v1=<hex>[, v1=<hex>]" list during a
// secret rotation. The contract vectors in kit/contract/signature hold the
// two languages together. Fails closed: no secret, no verification.
import { createHmac, timingSafeEqual } from "node:crypto";

export const HEADER_SIGNATURE = "X-Zavon-Signature";
export const HEADER_TIMESTAMP = "X-Zavon-Timestamp";
export const MAX_SKEW_SECONDS = 300;

/** Bare hex signature, identical to core's auth.Sign. */
export function sign(secret, timestamp, body) {
  const mac = createHmac("sha256", secret);
  mac.update(`${timestamp}.`);
  mac.update(typeof body === "string" ? Buffer.from(body, "utf8") : body);
  return mac.digest("hex");
}

/** "v1=<hex>" per non-empty secret, current first, comma-separated. */
export function header(secrets, timestamp, body) {
  return secrets
    .filter((s) => s)
    .map((s) => `v1=${sign(s, timestamp, body)}`)
    .join(", ");
}

function candidates(value) {
  const out = [];
  for (const raw of value.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq >= 0) {
      if (part.slice(0, eq) === "v1") out.push(part.slice(eq + 1).trim());
      continue;
    }
    out.push(part);
  }
  return out;
}

function same(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Throws with a reason when the signature does not verify.
 * @param {string[]} secrets
 * @param {string} signatureHeader
 * @param {string} timestampHeader
 * @param {string|Buffer} body
 * @param {number} nowSeconds
 */
export function verify(secrets, signatureHeader, timestampHeader, body, nowSeconds = Math.floor(Date.now() / 1000)) {
  const live = (secrets ?? []).filter((s) => s);
  if (live.length === 0) throw new Error("no signing secret is configured, so every request is refused");
  const sig = (signatureHeader ?? "").trim();
  const ts = (timestampHeader ?? "").trim();
  if (!sig || !ts) throw new Error(`signed requests need both ${HEADER_SIGNATURE} and ${HEADER_TIMESTAMP}`);
  if (!/^-?\d+$/.test(ts)) throw new Error(`${HEADER_TIMESTAMP} must be unix seconds`);
  const sent = Number(ts);
  if (Math.abs(nowSeconds - sent) > MAX_SKEW_SECONDS) throw new Error("request timestamp is outside the 5m0s window");
  const presented = candidates(sig);
  for (const s of live) {
    const want = sign(s, sent, body);
    if (presented.some((got) => same(want, got))) return;
  }
  throw new Error("signature does not match");
}
