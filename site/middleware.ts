import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";

// Protect everything under /dashboard. Unauthenticated requests get bounced
// through the libraryyy.com handshake (sign-in route handles the redirect).

export function middleware(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (session) return NextResponse.next();

  const signIn = new URL("/sign-in", req.nextUrl.origin);
  signIn.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(signIn, 302);
}

export const config = {
  matcher: ["/dashboard/:path*"],
  runtime: "nodejs",  // session.ts uses node:crypto
};
