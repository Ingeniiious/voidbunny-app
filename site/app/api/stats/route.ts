import { NextResponse } from "next/server";
import { fetchRecentCommits, fetchRepoStats } from "@/lib/github";

// Server-side aggregator for the /stats dashboard. Both GitHub calls
// share the helper's 60-second revalidate cache, so this route only
// hits the GitHub API once per minute regardless of how many clients
// are polling. Telemetry / mentions are placeholders until v0.6 ships
// the install.sh telemetry endpoint + F5Bot webhook.

const REPO_OWNER = "Ingeniiious";
const REPO_NAME = "voidbunny-app";

export interface StatsResponse {
  github: {
    stars: number;
    forks: number;
    openIssues: number;
    lastCommit: {
      sha: string;
      message: string;
      author: string;
      date: string;
      url: string;
    } | null;
    recentCommits: Array<{
      sha: string;
      message: string;
      author: string;
      date: string;
      url: string;
    }>;
    repoUrl: string;
  } | null;
  realUsers: number | null;
  countries: number | null;
  mentions: Array<{ source: string; url: string; when: string }> | null;
  fetchedAt: string;
}

// Revalidate the response itself every 60 s as a belt-and-braces measure
// alongside the per-fetch cache — keeps the response shape consistent
// even if a sub-fetch errors mid-flight (the older cached body wins).
export const revalidate = 60;

export async function GET(): Promise<NextResponse<StatsResponse>> {
  let github: StatsResponse["github"] = null;
  try {
    const [repo, commits] = await Promise.all([
      fetchRepoStats(REPO_OWNER, REPO_NAME),
      fetchRecentCommits(REPO_OWNER, REPO_NAME, 5),
    ]);
    github = {
      stars: repo.stars,
      forks: repo.forks,
      openIssues: repo.openIssues,
      lastCommit: commits[0] ?? null,
      recentCommits: commits,
      repoUrl: repo.htmlUrl,
    };
  } catch (err) {
    // Don't 500 the page over a transient GH outage — return null github
    // and let the client render the "—" placeholder cleanly.
    console.error("[/api/stats] github fetch failed", err);
  }

  return NextResponse.json({
    github,
    realUsers: null,
    countries: null,
    mentions: null,
    fetchedAt: new Date().toISOString(),
  });
}
