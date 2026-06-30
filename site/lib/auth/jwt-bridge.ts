import { createHmac, timingSafeEqual } from "node:crypto";

// HS256 JWT — hand-rolled to avoid a dependency for ~30 lines of code.
// Format: base64url(header) "." base64url(payload) "." base64url(signature)
// The bridge between libraryyy.com and voidbunny.xyz uses this format with
// a shared VOIDBUNNY_LINK_SECRET. Tokens live for 5 minutes.

export interface BridgeClaims {
  sub: string;     // libraryyy neon_auth.user.id
  email: string;
  name: string;
  iat: number;     // seconds
  exp: number;     // seconds
}

const HEADER_B64 = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));

export function signBridgeJwt(claims: BridgeClaims, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify(claims)));
  const data = `${HEADER_B64}.${payload}`;
  const sig = b64url(hmac(secret, data));
  return `${data}.${sig}`;
}

export function verifyBridgeJwt(token: string, secret: string): BridgeClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("jwt-malformed");
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const expected = hmac(secret, `${headerB64}.${payloadB64}`);
  const presented = b64urlDecode(sigB64);
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    throw new Error("jwt-bad-signature");
  }

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString("utf8"));
  } catch {
    throw new Error("jwt-bad-header");
  }
  if (header.alg !== "HS256" || header.typ !== "JWT") throw new Error("jwt-bad-header");

  let claims: BridgeClaims;
  try {
    claims = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    throw new Error("jwt-bad-payload");
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now) throw new Error("jwt-expired");
  if (typeof claims.iat !== "number" || claims.iat > now + 60) throw new Error("jwt-future-iat");
  if (
    typeof claims.sub !== "string" || !claims.sub ||
    typeof claims.email !== "string" || !claims.email ||
    typeof claims.name !== "string" || !claims.name
  ) {
    throw new Error("jwt-missing-claims");
  }

  return claims;
}

function hmac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
