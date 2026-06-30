import { randomInt } from "node:crypto";
import { adjectives, nouns } from "./words";

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

function pick<T>(list: readonly T[]): T {
  return list[randomInt(0, list.length)]!;
}

function suffix(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += BASE36[randomInt(0, BASE36.length)];
  return out;
}

export function generateSlug(suffixLen = 3): string {
  return `${pick(adjectives)}-${pick(nouns)}-${suffix(suffixLen)}`;
}

export type SlugAvailability = (slug: string) => Promise<boolean>;

// generateUniqueSlug retries against the availability check until it finds
// a free slug. If we collide 3 times in a row we widen the base36 suffix —
// that means we're getting close to saturation on the 200×200×46656 space.
export async function generateUniqueSlug(
  isAvailable: SlugAvailability,
  maxAttempts = 8,
): Promise<string> {
  let attempts = 0;
  let suffixLen = 3;
  while (attempts < maxAttempts) {
    const candidate = generateSlug(suffixLen);
    if (await isAvailable(candidate)) return candidate;
    attempts++;
    if (attempts % 3 === 0) suffixLen++;
  }
  throw new Error("subdomain-slug-exhausted");
}
