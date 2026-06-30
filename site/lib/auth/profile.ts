import { db } from "@/lib/db";

export interface ProfileRow {
  id: string;
  libraryyy_user_id: string;
  email: string | null;
  name: string | null;
  tier: number;
  subdomain_quota: number;
  status: string;
  referral_code: string;
}

// Idempotent upsert keyed by libraryyy_user_id. We cache the user's email
// and name from the bridge JWT so the dashboard renders without a network
// call to libraryyy.com. libraryyy is the source of truth — we refresh
// the cache on every sign-in callback.
export async function upsertProfile(args: {
  libraryyyUserId: string;
  email: string;
  name: string;
}): Promise<ProfileRow> {
  const sql = db();
  const rows = await sql<ProfileRow[]>`
    INSERT INTO user_profiles (libraryyy_user_id, email, name, last_login_at)
    VALUES (${args.libraryyyUserId}, ${args.email}, ${args.name}, now())
    ON CONFLICT (libraryyy_user_id)
    DO UPDATE SET
      email         = EXCLUDED.email,
      name          = EXCLUDED.name,
      last_login_at = now()
    RETURNING id, libraryyy_user_id, email, name, tier, subdomain_quota, status, referral_code
  `;
  return rows[0]!;
}

export async function getProfileById(id: string): Promise<ProfileRow | null> {
  const sql = db();
  const rows = await sql<ProfileRow[]>`
    SELECT id, libraryyy_user_id, email, name, tier, subdomain_quota, status, referral_code
    FROM user_profiles WHERE id = ${id}
  `;
  return rows[0] ?? null;
}
