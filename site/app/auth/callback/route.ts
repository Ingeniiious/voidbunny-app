import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { verifyBridgeJwt } from "@/lib/auth/jwt-bridge";
import { upsertProfile } from "@/lib/auth/profile";
import { attachSession } from "@/lib/auth/session";

const STATE_COOKIE = "vb_oauth_state";
const COOKIE_SECURE = process.env.NODE_ENV === "production";
const CLEAR_COOKIE_OPTS = {
  value: "",
  maxAge: 0,
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const linkSecret = process.env.VOIDBUNNY_LINK_SECRET;
  if (!linkSecret) return new NextResponse("auth-config-missing: VOIDBUNNY_LINK_SECRET", { status: 500 });

  const token = req.nextUrl.searchParams.get("token");
  const presentedState = req.nextUrl.searchParams.get("state");
  if (!token || !presentedState) return new NextResponse("auth-missing-params", { status: 400 });

  const stateCookie = req.cookies.get(STATE_COOKIE)?.value ?? "";
  if (!constantTimeEq(stateCookie, presentedState)) {
    return new NextResponse("auth-state-mismatch", { status: 400 });
  }

  let claims;
  try {
    claims = verifyBridgeJwt(token, linkSecret);
  } catch (err) {
    // Only echo our own controlled jwt-* codes; fall back to a generic code
    // so future error messages can't leak details into the HTTP response.
    const code =
      err instanceof Error && /^jwt-[a-z0-9-]+$/.test(err.message)
        ? err.message
        : "jwt-verify-failed";
    console.warn("[auth/callback] verifyBridgeJwt failed:", err);
    return new NextResponse(`auth-${code}`, { status: 400 });
  }

  const profile = await upsertProfile({
    libraryyyUserId: claims.sub,
    email: claims.email,
    name: claims.name,
  });

  const nextRaw = req.cookies.get(STATE_COOKIE + "_next")?.value ?? "/dashboard";
  const next = isSafeNextPath(nextRaw) ? nextRaw : "/dashboard";

  const dest = new URL(next, req.nextUrl.origin);
  const res = NextResponse.redirect(dest, 302);

  // Burn state cookies — mirror the creation attrs so every browser actually
  // clears them (RFC 6265 §3 / §4.1.2).
  res.cookies.set({ name: STATE_COOKIE, ...CLEAR_COOKIE_OPTS });
  res.cookies.set({ name: STATE_COOKIE + "_next", ...CLEAR_COOKIE_OPTS });

  // Set session
  attachSession(res, {
    profileId: profile.id,
    libraryyyUserId: profile.libraryyy_user_id,
  });

  return res;
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isSafeNextPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  return !/[\x00-\x1f\x7f]/.test(path);
}
