import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/dashboard/page-header";
import { ReferralLink } from "@/components/dashboard/referral-link";
import { getSession } from "@/lib/auth/session";
import { getProfileById } from "@/lib/auth/profile";
import { db } from "@/lib/db";

interface ReferralRow {
  referred_email: string | null;
  referred_name: string | null;
  bonus_granted_at: Date | null;
  created_at: Date;
}

export default async function ReferralsPage() {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in?next=/dashboard/referrals");
  const profile = await getProfileById(session.profileId);
  if (!profile) redirect("/auth/sign-out");

  const sql = db();
  const referrals = await sql<ReferralRow[]>`
    SELECT
      up.email AS referred_email,
      up.name  AS referred_name,
      r.bonus_granted_at,
      r.created_at
    FROM referrals r
    JOIN user_profiles up ON up.id = r.referred_id
    WHERE r.referrer_id = ${profile.id}
    ORDER BY r.created_at DESC
  `;

  const earned = referrals.filter((r) => r.bonus_granted_at).length;
  const pending = referrals.length - earned;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Referrals"
        title="Invite a friend, both get +1 slot"
        description="Share your link. When a friend signs up, claims a subdomain, and keeps it healthy for 7 days, you both earn a bonus subdomain (up to 4 bonuses · 6 total)."
      />

      {profile.tier === 0 ? (
        <Card className="mb-8 border-amber-500/40 bg-amber-500/[0.04]">
          <CardHeader>
            <CardTitle className="text-base">Verify your account to earn bonuses</CardTitle>
            <CardDescription>
              Connect GitHub in Settings to enable referral rewards. Your invite link still works,
              but you won&apos;t accrue bonuses until you reach Tier 1.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <ReferralLink code={profile.referral_code} />

      <div className="mt-8 grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="font-mono text-[10px] uppercase tracking-[0.22em]">
              Bonuses Earned
            </CardDescription>
            <CardTitle className="text-3xl font-medium leading-none">{earned}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {earned >= 4 ? "Cap reached" : `${4 - earned} more available`}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="font-mono text-[10px] uppercase tracking-[0.22em]">
              Pending
            </CardDescription>
            <CardTitle className="text-3xl font-medium leading-none">{pending}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Vesting (7-day heartbeat window)
          </CardContent>
        </Card>
      </div>

      <Separator className="my-10" />

      <h2 className="mb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Your invites
      </h2>

      {referrals.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardDescription className="text-center">
              No invites yet. Share your link above to get started.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {referrals.map((r) => (
            <Card key={String(r.created_at)} className="border-border/80">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 py-4">
                <div className="flex flex-col">
                  <CardTitle className="text-sm font-medium">
                    {r.referred_name || r.referred_email || "Anonymous"}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Joined {new Date(r.created_at).toLocaleDateString()}
                  </CardDescription>
                </div>
                <Badge
                  variant={r.bonus_granted_at ? "default" : "secondary"}
                  className="font-mono text-[10px] uppercase tracking-[0.18em]"
                >
                  {r.bonus_granted_at ? "Granted" : "Pending"}
                </Badge>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
