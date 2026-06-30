import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// GET /auth/sign-in?next=/dashboard
//
// Kicks off the libraryyy.com handshake. Generates a CSRF state nonce,
// stashes it in a short-lived cookie, and redirects to libraryyy's
// authorize endpoint. libraryyy will redirect back to /auth/callback
// with ?token=<JWT>&state=<same nonce>.

const STATE_COOKIE = "vb_oauth_state";
const STATE_TTL_S = 600;
const DEFAULT_NEXT = "/dashboard";
const COOKIE_SECURE = process.env.NODE_ENV === "production";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const authorizeUrl = process.env.LIBRARYYY_AUTHORIZE_URL;
  if (!authorizeUrl) {
    return new NextResponse("auth-config-missing: set LIBRARYYY_AUTHORIZE_URL", { status: 500 });
  }

  const callbackOrigin = req.nextUrl.origin;
  const callback = `${callbackOrigin}/auth/callback`;

  const nextParam = req.nextUrl.searchParams.get("next") ?? DEFAULT_NEXT;
  const next = isSafeNextPath(nextParam) ? nextParam : DEFAULT_NEXT;

  const state = randomBytes(24).toString("base64url");

  const target = new URL(authorizeUrl);
  target.searchParams.set("return", callback);
  target.searchParams.set("state", state);
  target.searchParams.set("next", next);

  const res = NextResponse.redirect(target, 302);
  res.cookies.set({
    name: STATE_COOKIE,
    value: state,
    maxAge: STATE_TTL_S,
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
  });
  res.cookies.set({
    name: STATE_COOKIE + "_next",
    value: next,
    maxAge: STATE_TTL_S,
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
  });
  return res;
}

function isSafeNextPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  // Reject all C0 + DEL control chars so nothing splits headers or smuggles
  // bytes into the Location header.
  return !/[\x00-\x1f\x7f]/.test(path);
}
