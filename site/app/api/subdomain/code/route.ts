import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getProfileById } from "@/lib/auth/profile";
import { createClaimCode, CLAIM_CODE_TTL_MS } from "@/lib/subdomain/claim-code";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/subdomain/code
// Issues a one-time install code (vbc_*) the user pastes into the installer.
// Returns: { code, expiresAt, installCommand }

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const profile = await getProfileById(session.profileId);
  if (!profile) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  if (profile.status === "banned") {
    return NextResponse.json({ error: "account-banned" }, { status: 403 });
  }

  const sql = db();

  // Per-user rate limit: max 3 codes generated per day.
  const recent = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM claim_codes
    WHERE profile_id = ${profile.id} AND created_at > now() - interval '1 day'
  `;
  if (Number(recent[0]?.count ?? "0") >= 3) {
    return NextResponse.json({ error: "rate-limited", retryAfterHours: 24 }, { status: 429 });
  }

  // Quota check — don't issue codes when there are no slots open.
  const usage = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM subdomains
    WHERE profile_id = ${profile.id} AND status = 'active'
  `;
  if (Number(usage[0]?.count ?? "0") >= profile.subdomain_quota) {
    return NextResponse.json({ error: "quota-reached" }, { status: 403 });
  }

  const newCode = createClaimCode();
  await sql`
    INSERT INTO claim_codes (code_hash, profile_id, expires_at, verify_token)
    VALUES (
      ${newCode.codeHash},
      ${profile.id},
      ${newCode.expiresAt.toISOString()},
      ${newCode.verifyToken}
    )
  `;

  await sql`
    INSERT INTO audit_log (actor_id, action, target, payload)
    VALUES (${profile.id}, 'code.issue', ${profile.id}, ${sql.json({ ttl_ms: CLAIM_CODE_TTL_MS })})
  `;

  return NextResponse.json({
    code: newCode.code,
    expiresAt: newCode.expiresAt.toISOString(),
    installCommand: `curl -fsSL voidbunny.xyz/install.sh | bash -s -- ${newCode.code}`,
  });
}
