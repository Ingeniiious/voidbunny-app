import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

// vb_session — voidbunny's own session cookie. Signed standalone payload so
// every page can check auth without a DB round-trip. 30-day sliding expiry:
// each request that uses an unexpired cookie issues a fresh one with a new
// exp. When it actually expires, the user goes back through libraryyy.com.

export const SESSION_COOKIE = "vb_session";
const SESSION_TTL_S = 30 * 24 * 60 * 60;          // 30 days
const SESSION_REFRESH_THRESHOLD_S = 7 * 24 * 60 * 60;  // refresh if < 7 days left

export interface Session {
  profileId: string;
  libraryyyUserId: string;
  exp: number;       // seconds
}

function secret(): string {
  const s = process.env.VOIDBUNNY_SESSION_SECRET;
  if (!s) throw new Error("session-env-missing: set VOIDBUNNY_SESSION_SECRET");
  return s;
}

export function encodeSession(session: Omit<Session, "exp">): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  const payload = JSON.stringify({ ...session, exp });
  const body = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function decodeSession(raw: string | undefined | null): Session | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];

  const expected = createHmac("sha256", secret()).update(body).digest();
  const presented = Buffer.from(sig, "base64url");
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    return null;
  }

  let parsed: Session;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  if (typeof parsed.profileId !== "string" || !parsed.profileId) return null;
  if (typeof parsed.libraryyyUserId !== "string" || !parsed.libraryyyUserId) return null;
  return parsed;
}

export function needsRefresh(session: Session): boolean {
  return session.exp - Math.floor(Date.now() / 1000) < SESSION_REFRESH_THRESHOLD_S;
}

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export function buildSessionCookie(value: string) {
  return {
    name: SESSION_COOKIE,
    value,
    maxAge: SESSION_TTL_S,
    ...COOKIE_OPTS,
  };
}

export function clearSessionCookie() {
  return {
    name: SESSION_COOKIE,
    value: "",
    maxAge: 0,
    ...COOKIE_OPTS,
  };
}

// Server-component / route-handler helper.
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

// Middleware helper — middleware uses NextRequest cookies, not the
// server-component cookies() API.
export function getSessionFromRequest(req: NextRequest): Session | null {
  return decodeSession(req.cookies.get(SESSION_COOKIE)?.value);
}

// Convenience for route handlers that build a NextResponse with a fresh cookie.
export function attachSession(res: NextResponse, session: Omit<Session, "exp">): NextResponse {
  res.cookies.set(buildSessionCookie(encodeSession(session)));
  return res;
}
