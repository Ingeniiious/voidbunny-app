import { NextResponse, type NextRequest } from "next/server";
import { clearSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", req.nextUrl.origin), 302);
  res.cookies.set(clearSessionCookie());
  return res;
}

export const POST = GET;
