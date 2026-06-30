// GitHub API helpers for /api/stats. Public-repo endpoints work
// unauthenticated at 60 req/hr; with our 60-second revalidate cache
// that maxes out at 60 server-side calls/hr regardless of viewer count,
// so a token is genuinely optional. Set GITHUB_TOKEN in env to upgrade
// to the 5000/hr authenticated bucket once we have meaningful traffic.

const GH_API = "https://api.github.com";
const USER_AGENT = "voidbunny-stats/1.0 (+https://voidbunny.xyz)";
const REVALIDATE_SECONDS = 60;

export interface GitHubRepoStats {
  stars: number;
  forks: number;
  openIssues: number;
  pushedAt: string;
  htmlUrl: string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

function headers(): HeadersInit {
  const h: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    (h as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return h;
}

export async function fetchRepoStats(
  owner: string,
  repo: string,
): Promise<GitHubRepoStats> {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}`, {
    headers: headers(),
    // Next.js native caching — the platform deduplicates across viewers
    // within the revalidate window. Works on Vercel without any extra
    // infra (in-memory caches don't survive serverless cold-starts).
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!res.ok) {
    throw new Error(`GitHub repo fetch failed: ${res.status} ${res.statusText}`);
  }
  const data: {
    stargazers_count: number;
    forks_count: number;
    open_issues_count: number;
    pushed_at: string;
    html_url: string;
  } = await res.json();
  return {
    stars: data.stargazers_count,
    forks: data.forks_count,
    openIssues: data.open_issues_count,
    pushedAt: data.pushed_at,
    htmlUrl: data.html_url,
  };
}

export async function fetchRecentCommits(
  owner: string,
  repo: string,
  limit = 5,
): Promise<GitHubCommit[]> {
  const res = await fetch(
    `${GH_API}/repos/${owner}/${repo}/commits?per_page=${limit}`,
    {
      headers: headers(),
      next: { revalidate: REVALIDATE_SECONDS },
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub commits fetch failed: ${res.status} ${res.statusText}`);
  }
  const data: Array<{
    sha: string;
    html_url: string;
    commit: {
      message: string;
      author: { name: string; date: string };
    };
  }> = await res.json();
  return data.map((c) => ({
    sha: c.sha,
    // GitHub commits often have multi-line bodies; we only want the
    // first line for a ticker-style display.
    message: (c.commit.message ?? "").split("\n")[0] ?? "",
    author: c.commit.author?.name ?? "unknown",
    date: c.commit.author?.date ?? new Date().toISOString(),
    url: c.html_url,
  }));
}
