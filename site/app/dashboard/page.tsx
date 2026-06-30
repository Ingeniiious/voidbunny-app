import Link from "next/link";
import { redirect } from "next/navigation";
import {
  RiAddCircleLine,
  RiGlobalLine,
  RiPulseLine,
  RiVerifiedBadgeLine,
} from "@remixicon/react";

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
import { PageHeader } from "@/components/dashboard/page-header";
import { StaggerGrid, StaggerItem } from "@/components/dashboard/stagger-grid";
import { getSession } from "@/lib/auth/session";
import { getProfileById } from "@/lib/auth/profile";
import { db } from "@/lib/db";

interface SubdomainRow {
  fqdn: string;
  slug: string;
  ip: string;
  status: string;
  last_heartbeat: Date;
  created_at: Date;
}

export default async function DashboardOverviewPage() {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in?next=/dashboard");
  const profile = await getProfileById(session.profileId);
  if (!profile) redirect("/auth/sign-out");

  const sql = db();
  const subdomains = await sql<SubdomainRow[]>`
    SELECT fqdn, slug, ip::text AS ip, status, last_heartbeat, created_at
    FROM subdomains
    WHERE profile_id = ${profile.id} AND status = 'active'
    ORDER BY created_at DESC
  `;

  const tierLabel = profile.tier === 1 ? "Verified" : "Unverified";
  const used = subdomains.length;
  const quota = profile.subdomain_quota;
  const canClaim = used < quota;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Overview"
        title={greeting(profile.name ?? profile.email ?? "")}
        description="Manage your free .box.voidbunny.xyz subdomains. Each subdomain points at your own server — Voidbunny just runs the DNS."
        actions={
          <Button asChild disabled={!canClaim} className="rounded-full px-5">
            <Link href="/dashboard/claim">
              <RiAddCircleLine data-icon="inline-start" />
              Claim Subdomain
            </Link>
          </Button>
        }
      />

      <StaggerGrid className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StaggerItem>
          <StatCard
            icon={<RiVerifiedBadgeLine size={16} />}
            label="Tier"
            value={tierLabel}
            hint={
              profile.tier === 1
                ? "GitHub connected · 4 bonus slots available"
                : "Connect GitHub in Settings to verify"
            }
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={<RiGlobalLine size={16} />}
            label="Subdomains"
            value={`${used} / ${quota}`}
            hint={canClaim ? "Slot available" : "Quota reached"}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={<RiPulseLine size={16} />}
            label="Heartbeat"
            value={used ? "Healthy" : "—"}
            hint={used ? "All subdomains responding" : "Claim your first to begin"}
          />
        </StaggerItem>
      </StaggerGrid>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Active Subdomains
          </h2>
        </div>

        {subdomains.length === 0 ? (
          <EmptySubdomains />
        ) : (
          <div className="flex flex-col gap-3">
            {subdomains.map((sd) => (
              <SubdomainRowCard key={sd.fqdn} row={sd} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="relative overflow-hidden border-border/80 bg-card transition-colors hover:border-brand/40">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription className="font-mono text-[10px] uppercase tracking-[0.22em]">
          {label}
        </CardDescription>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-medium leading-none">{value}</div>
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function SubdomainRowCard({ row }: { row: SubdomainRow }) {
  return (
    <Card className="transition-colors hover:border-brand/40">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex flex-col gap-1">
          <CardTitle className="font-mono text-sm">{row.fqdn}</CardTitle>
          <CardDescription>
            {row.ip} · last heartbeat {timeAgo(row.last_heartbeat)}
          </CardDescription>
        </div>
        <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-[0.18em]">
          {row.status}
        </Badge>
      </CardHeader>
    </Card>
  );
}

function EmptySubdomains() {
  return (
    <Card className="border-dashed">
      <CardHeader className="flex flex-col items-center gap-3 text-center">
        <RiGlobalLine size={28} className="text-muted-foreground" />
        <CardTitle className="text-lg font-medium">No subdomains yet</CardTitle>
        <CardDescription className="max-w-md text-sm">
          Claim a free subdomain to point at your server. The installer wires up Caddy and Let&apos;s
          Encrypt automatically.
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex justify-center">
        <Button asChild className="rounded-full px-5">
          <Link href="/dashboard/claim">
            <RiAddCircleLine data-icon="inline-start" />
            Claim First Subdomain
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function greeting(name: string): string {
  const first = name.split(/[\s@]+/)[0] ?? "";
  return first ? `Welcome back, ${first}` : "Welcome back";
}

function timeAgo(d: Date): string {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
