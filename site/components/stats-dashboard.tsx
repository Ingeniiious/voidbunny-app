"use client";

import { type ReactNode } from "react";
import useSWR from "swr";
import { motion } from "motion/react";
import {
  RiStarFill,
  RiGitForkLine,
  RiBugLine,
  RiTimeLine,
  RiUserLine,
  RiGlobalLine,
  RiChat3Line,
  RiGithubFill,
} from "@remixicon/react";
import { DitherShader } from "@/components/dither-shader";
import type { StatsResponse } from "@/app/api/stats/route";

// Voidbunny growth dashboard. Polls /api/stats every 60s via SWR; that
// endpoint shares a 60s server-side cache so client polling is cheap
// regardless of viewer count. Tiles that aren't ready yet (real-users,
// country map, mentions ticker) render as deliberate "coming soon"
// placeholders rather than empty boxes — the goal of this page is
// social proof, and an empty tile is anti-proof.

const BRAND_TONE = { r: 0.92, g: 0.36, b: 0.06 } as const;
const POLL_MS = 60_000;
const STATS_ENDPOINT = "/api/stats";

const FALLBACK: StatsResponse = {
  github: null,
  realUsers: null,
  countries: null,
  mentions: null,
  fetchedAt: new Date().toISOString(),
};

const fetcher = async (url: string): Promise<StatsResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`stats fetch failed: ${res.status}`);
  return res.json();
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  return `${mo}mo ago`;
}

export function StatsDashboard(): ReactNode {
  const { data } = useSWR<StatsResponse>(STATS_ENDPOINT, fetcher, {
    refreshInterval: POLL_MS,
    // Don't refetch on tab focus — keeps the visible counter steady
    // while the user is actively reading the page.
    revalidateOnFocus: false,
    fallbackData: FALLBACK,
  });
  const stats = data ?? FALLBACK;
  const gh = stats.github;
  const stars = gh?.stars ?? 0;
  const forks = gh?.forks ?? 0;
  const openIssues = gh?.openIssues ?? 0;
  const lastCommitDate = gh?.lastCommit?.date ?? new Date().toISOString();
  const recentCommits = gh?.recentCommits ?? [];
  const repoUrl = gh?.repoUrl ?? "https://github.com/Ingeniiious/Claude-Server";

  return (
    <div className="relative min-h-screen bg-black text-white">
      {/* Ambient brand-tinted dither — same shader as the marketing site,
          dimmed and centered behind the page chrome. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 opacity-30"
      >
        <DitherShader variant="hero" tone={BRAND_TONE} />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 30%, rgba(234,88,12,0.18) 0%, transparent 70%), linear-gradient(180deg, #000 0%, #050505 100%)",
        }}
      />

      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10 sm:py-24">
        {/* Page chrome — back link + title strip */}
        <div className="flex items-center justify-between">
          <a
            href="/"
            className="focus-ring inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-brand"
          >
            <span aria-hidden="true">←</span> voidbunny
          </a>
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            live · polls every 60s
          </span>
        </div>

        {/* HERO STAR COUNTER */}
        <section
          aria-labelledby="stars-heading"
          className="mt-16 flex flex-col items-center text-center sm:mt-24"
        >
          <h1
            id="stars-heading"
            className="font-mono text-[10px] uppercase tracking-[0.32em] text-brand/80"
          >
            GitHub Stars · Live
          </h1>
          <div className="mt-6 flex items-center gap-4">
            <RiStarFill className="h-10 w-10 text-brand sm:h-14 sm:w-14" />
            <motion.span
              // Keying on the value remounts the span on every change, so
              // motion fires the enter animation as a pulse — the "stars
              // tick up" visual the page is built around.
              key={stars}
              initial={{ scale: 1.3, opacity: 0.6 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="font-mono text-7xl font-medium tabular-nums leading-none tracking-tighter text-white sm:text-9xl lg:text-[10rem]"
            >
              {stars.toLocaleString()}
            </motion.span>
          </div>
          <p className="mt-6 max-w-md font-mono text-xs text-white/40">
            <a
              href={repoUrl}
              className="inline-flex items-center gap-1.5 text-white/60 underline-offset-4 transition-colors hover:text-brand hover:underline"
            >
              <RiGithubFill className="h-3.5 w-3.5" />
              {repoUrl.replace("https://github.com/", "")}
            </a>
          </p>
        </section>

        {/* SECONDARY METRICS — 3 small tiles */}
        <section className="mt-16 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <MetricTile
            icon={<RiGitForkLine className="h-4 w-4" />}
            label="Forks"
            value={forks.toLocaleString()}
          />
          <MetricTile
            icon={<RiBugLine className="h-4 w-4" />}
            label="Open issues"
            value={openIssues.toLocaleString()}
          />
          <MetricTile
            icon={<RiTimeLine className="h-4 w-4" />}
            label="Last commit"
            value={relativeTime(lastCommitDate)}
          />
        </section>

        {/* PLACEHOLDER TILES — real users + country map + mentions */}
        <section className="mt-12 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_1.4fr] lg:gap-4">
          <PlaceholderTile
            icon={<RiUserLine className="h-5 w-5" />}
            label="Voidbunny instances live"
            note="Coming with v0.6 telemetry"
          >
            <span className="font-mono text-5xl font-medium tabular-nums leading-none text-white/30">
              —
            </span>
          </PlaceholderTile>

          <PlaceholderTile
            icon={<RiGlobalLine className="h-5 w-5" />}
            label="Countries"
            note="Coming with v0.6 telemetry"
          >
            {/* Faded world-map abstraction — concentric arcs hinting at a globe */}
            <svg
              viewBox="0 0 120 80"
              className="h-20 w-full opacity-20"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
              aria-hidden="true"
            >
              <ellipse cx="60" cy="40" rx="50" ry="30" />
              <ellipse cx="60" cy="40" rx="50" ry="18" />
              <ellipse cx="60" cy="40" rx="50" ry="6" />
              <line x1="10" y1="40" x2="110" y2="40" />
              <line x1="60" y1="10" x2="60" y2="70" />
              {[20, 35, 50, 75, 90].map((x) => (
                <circle key={x} cx={x} cy={40 + (x % 7) - 3} r="0.8" fill="currentColor" />
              ))}
            </svg>
          </PlaceholderTile>

          <PlaceholderTile
            icon={<RiChat3Line className="h-5 w-5" />}
            label="Recent mentions"
            note="Coming after launch (F5Bot feed)"
          >
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="h-1.5 w-12 rounded-full bg-white/10" />
                  <div className="h-1.5 flex-1 rounded-full bg-white/5" />
                </div>
              ))}
            </div>
          </PlaceholderTile>
        </section>

        {/* RECENT COMMITS FEED */}
        <section className="mt-12">
          <div className="flex items-baseline justify-between">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand/80">
              Recent commits
            </h2>
            <a
              href={`${repoUrl}/commits`}
              className="focus-ring inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40 transition-colors hover:text-brand"
            >
              all <span aria-hidden="true">↗</span>
            </a>
          </div>

          {recentCommits.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-6 text-center font-mono text-xs text-white/40 sm:px-6">
              No commits yet — check back after launch.
            </p>
          ) : (
          <ul className="mt-4 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.02]">
            {recentCommits.map((commit) => (
              <li key={commit.sha} className="px-4 py-3 sm:px-6">
                <a
                  href={commit.url}
                  className="focus-ring group flex flex-col items-baseline gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-brand/80">
                      {commit.sha.slice(0, 7)}
                    </span>
                    <span className="truncate text-sm text-white/80 transition-colors group-hover:text-white">
                      {commit.message}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-white/40">
                    {relativeTime(commit.date)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          )}
        </section>

        {/* Footer — small, just a note about the page */}
        <p className="mt-16 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">
          stats refresh every 60 seconds · github api cached server-side
        </p>
      </div>
    </div>
  );
}

function MetricTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}): ReactNode {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
        <span className="text-brand/70">{icon}</span>
        {label}
      </div>
      <div className="mt-2 font-mono text-3xl font-medium tabular-nums tracking-tight text-white">
        {value}
      </div>
    </div>
  );
}

function PlaceholderTile({
  icon,
  label,
  note,
  children,
}: {
  icon: ReactNode;
  label: string;
  note: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
        <span className="text-brand/70">{icon}</span>
        {label}
      </div>
      <div className="mt-4 flex min-h-[5rem] items-center justify-center text-white/40">
        {children}
      </div>
      <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">
        {note}
      </p>
    </div>
  );
}
