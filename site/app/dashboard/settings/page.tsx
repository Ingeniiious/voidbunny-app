import { redirect } from "next/navigation";
import Link from "next/link";
import { RiGithubFill, RiArrowRightUpLine, RiLogoutBoxRLine } from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/dashboard/page-header";
import { getSession } from "@/lib/auth/session";
import { getProfileById } from "@/lib/auth/profile";
import { db } from "@/lib/db";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in?next=/dashboard/settings");
  const profile = await getProfileById(session.profileId);
  if (!profile) redirect("/auth/sign-out");

  const sql = db();
  const [gh] = await sql<{ github_username: string | null; github_connected_at: Date | null }[]>`
    SELECT github_username, github_connected_at
    FROM user_profiles WHERE id = ${profile.id}
  `;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Settings" title="Account" description="Manage your Voidbunny account, identity, and connected providers." />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
            <CardDescription>Provided by libraryyy.com. Update them there.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Row label="Name" value={profile.name || "—"} />
            <Row label="Email" value={profile.email || "—"} />
            <Row label="Tier" value={profile.tier === 1 ? "Verified" : "Unverified"} />
          </CardContent>
          <CardFooter className="justify-end">
            <Button asChild variant="outline" className="rounded-full">
              <a
                href="https://libraryyy.com/dashboard"
                target="_blank"
                rel="noreferrer noopener"
              >
                <RiArrowRightUpLine data-icon="inline-start" />
                Manage on libraryyy.com
              </a>
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">GitHub</CardTitle>
                <CardDescription>
                  Connect GitHub to verify your account and unlock additional subdomain slots.
                </CardDescription>
              </div>
              <Badge variant={gh?.github_username ? "default" : "secondary"} className="font-mono text-[10px] uppercase tracking-[0.18em]">
                {gh?.github_username ? "Connected" : "Not Connected"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {gh?.github_username ? (
              <div className="flex items-center gap-2 text-sm">
                <RiGithubFill size={18} />
                <span className="font-mono">@{gh.github_username}</span>
                <span className="text-xs text-muted-foreground">
                  · connected{" "}
                  {gh.github_connected_at ? new Date(gh.github_connected_at).toLocaleDateString() : ""}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Verified accounts get 2 subdomains and can earn referral bonuses (up to 6 total).
              </p>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <Button asChild className="rounded-full">
              <Link href="/api/github/connect">
                <RiGithubFill data-icon="inline-start" />
                {gh?.github_username ? "Reconnect" : "Connect GitHub"}
              </Link>
            </Button>
          </CardFooter>
        </Card>

        <Separator className="my-2" />

        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base">Sign out</CardTitle>
            <CardDescription>
              Ends your Voidbunny session. Sign back in any time via libraryyy.com.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-end">
            <Button asChild variant="outline" className="rounded-full border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive">
              <Link href="/auth/sign-out">
                <RiLogoutBoxRLine data-icon="inline-start" />
                Sign Out
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
