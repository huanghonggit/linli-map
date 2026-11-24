import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(String(password), salt, SCRYPT_KEYLEN).toString(
    "hex",
  );
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== "string" || !stored.startsWith("scrypt$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [, salt, hex] = parts;
  const expected = Buffer.from(hex, "hex");
  const actual = scryptSync(String(password), salt, expected.length);
  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}

function b64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf-8");
  return buf.toString("base64url");
}

function b64urlDecode(str) {
  return Buffer.from(str, "base64url").toString("utf-8");
}

export function signToken(payload, secret, ttlSec = 7 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64urlEncode(
    JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }),
  );
  const sig = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expectedSig = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }
  try {
    const data = JSON.parse(b64urlDecode(body));
    const now = Math.floor(Date.now() / 1000);
    if (!data || typeof data.exp !== "number" || data.exp < now) return null;
    return data;
  } catch {
    return null;
  }
}

export class RateLimiter {
  constructor(maxAttempts = 20, windowMs = 10 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  check(key) {
    const now = Date.now();
    const list = (this.buckets.get(key) || []).filter(
      (ts) => now - ts < this.windowMs,
    );
    if (list.length >= this.maxAttempts) {
      this.buckets.set(key, list);
      return false;
    }
    list.push(now);
    this.buckets.set(key, list);
    if (this.buckets.size > 5000) {
      for (const [k, v] of this.buckets) {
        if (!v.length || now - v[v.length - 1] >= this.windowMs) {
          this.buckets.delete(k);
        }
      }
    }
    return true;
  }
}
