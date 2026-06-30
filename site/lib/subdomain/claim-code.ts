import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

// Claim codes are short-lived one-time tokens issued by /dashboard/claim and
// consumed by the installer. Format: vbc_<24 base32 chars>.
//
// We store SHA-256 of the code (not bcrypt) — these are high-entropy random
// secrets with a 10-minute TTL, so a fast hash is fine and lookup-by-prefix
// stays cheap. bcrypt is reserved for manage_tokens (which live forever).

const PREFIX = "vbc_";
const CODE_BYTES = 15;             // 15 random bytes → 24 base32 chars
const VERIFY_TOKEN_BYTES = 24;     // 24 bytes → ~33 base32 chars; embedded in claim, echoed by box
export const CLAIM_CODE_TTL_MS = 10 * 60 * 1000;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 0x1f];
  return out;
}

export interface NewClaimCode {
  code: string;          // vbc_xxxx — shown to user once, then discarded
  codeHash: string;      // store this in claim_codes.code_hash
  verifyToken: string;   // store this in claim_codes.verify_token; box echoes it
  expiresAt: Date;
}

export function createClaimCode(): NewClaimCode {
  const code = PREFIX + base32(randomBytes(CODE_BYTES));
  return {
    code,
    codeHash: hashCode(code),
    verifyToken: base32(randomBytes(VERIFY_TOKEN_BYTES)),
    expiresAt: new Date(Date.now() + CLAIM_CODE_TTL_MS),
  };
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// Constant-time compare for hash strings of equal length.
export function codeMatches(expectedHash: string, presentedCode: string): boolean {
  const presentedHash = hashCode(presentedCode);
  if (presentedHash.length !== expectedHash.length) return false;
  return timingSafeEqual(Buffer.from(presentedHash, "hex"), Buffer.from(expectedHash, "hex"));
}

export function isClaimCodeShape(value: string): boolean {
  return value.startsWith(PREFIX) && /^vbc_[a-z2-7]{24,32}$/.test(value);
}
