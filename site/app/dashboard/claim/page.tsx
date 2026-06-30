import { redirect } from "next/navigation";
import { RiInformationLine } from "@remixicon/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/dashboard/page-header";
import { ClaimCodeIssuer } from "@/components/dashboard/claim-code-issuer";
import { getSession } from "@/lib/auth/session";
import { getProfileById } from "@/lib/auth/profile";
import { db } from "@/lib/db";

export default async function ClaimPage() {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in?next=/dashboard/claim");
  const profile = await getProfileById(session.profileId);
  if (!profile) redirect("/auth/sign-out");

  const sql = db();
  const countRows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM subdomains
    WHERE profile_id = ${profile.id} AND status = 'active'
  `;
  const used = Number(countRows[0]?.count ?? "0");
  const canClaim = used < profile.subdomain_quota;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Claim"
        title="Claim a free subdomain"
        description="Generate a one-time install code and paste it into the Voidbunny installer on your server. The code expires in 10 minutes."
      />

      {canClaim ? (
        <ClaimCodeIssuer remaining={profile.subdomain_quota - used} />
      ) : (
        <QuotaReached used={used} total={profile.subdomain_quota} tier={profile.tier} />
      )}

      <Separator className="my-10" />

      <section className="flex flex-col gap-4">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          How it works
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {[
            { n: 1, t: "Generate code", b: "Click Generate Code. You get a one-time vbc_… token." },
            { n: 2, t: "Run installer", b: "Paste the curl command onto your fresh Ubuntu server." },
            { n: 3, t: "Live URL", b: "Installer prints your live https://<slug>.box.voidbunny.xyz." },
          ].map((s) => (
            <div
              key={s.n}
              className="rounded-xl border border-border/80 bg-card p-4 transition-colors hover:border-brand/40"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
                Step {s.n}
              </div>
              <div className="mt-2 text-sm font-medium">{s.t}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.b}</p>
            </div>
          ))}
        </ol>
      </section>
    </div>
  );
}

function QuotaReached({
  used,
  total,
  tier,
}: {
  used: number;
  total: number;
  tier: number;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <RiInformationLine size={20} className="mt-1 text-muted-foreground" />
          <div className="flex flex-col gap-1">
            <CardTitle className="text-lg">Quota reached</CardTitle>
            <CardDescription>
              You&apos;ve claimed {used} of {total} available subdomains.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {tier === 0
          ? "Connect GitHub in Settings to verify your account and unlock a second slot, plus the ability to earn referral bonuses."
          : "Invite a friend with your referral link. When they claim a subdomain and pass heartbeat for 7 days, you both get +1 slot (cap of 6 total)."}
      </CardContent>
    </Card>
  );
}
