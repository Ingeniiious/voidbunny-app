import { api, type CliKind } from './api';

export interface ActivityRepoSummary {
  cwd: string;
  name: string;
  owner: string | null;
  host: string | null;
  avatar_url: string | null;
  last_active: number;
  busy_ms: number;
  turns: number;
  top_cli: CliKind | null;
}

export interface ActivityCliSummary {
  cli: CliKind;
  busy_ms: number;
  turns: number;
  runs: number;
}

export interface TokensTotals {
  input_7d: number;
  output_7d: number;
  input_30d: number;
  output_30d: number;
  input_all: number;
  output_all: number;
}

export interface TokenCliSummary {
  cli: CliKind;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  messages: number;
}

export interface SummaryResponse {
  totals: {
    events_7d: number;
    events_30d: number;
    events_365d: number;
    tokens: TokensTotals;
  };
  by_cli: ActivityCliSummary[];
  tokens_by_cli: TokenCliSummary[];
  top_repos: ActivityRepoSummary[];
  generated_at: number;
}

export interface HeatmapDay {
  date: string;
  count: number;
  busy_ms: number;
  top_cli: CliKind | null;
}

export interface HeatmapResponse {
  from: number;
  to: number;
  days: HeatmapDay[];
}

export interface RepoRow extends ActivityRepoSummary {
  remote_url?: string | null;
  runs: number;
}

export interface TimelineRun {
  id: number;
  session_id: string;
  cli: CliKind;
  cwd: string;
  name: string;
  owner: string | null;
  host: string | null;
  avatar_url: string | null;
  started_at: number;
  ended_at: number | null;
  busy_ms: number;
  turns: number;
}

export interface TokenDay {
  day: string;
  cli: CliKind;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface TokenRepo {
  cwd: string;
  name: string;
  owner: string | null;
  avatar_url: string | null;
  host: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  messages: number;
}

export interface TokenModel {
  model: string;
  cli: CliKind;
  input_tokens: number;
  output_tokens: number;
  messages: number;
}

export interface TokensResponse {
  range: string;
  since: number;
  by_day: TokenDay[];
  by_repo: TokenRepo[];
  by_model: TokenModel[];
}

export function fetchSummary() {
  return api<SummaryResponse>('/api/activity/summary');
}

export function fetchHeatmap(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return api<HeatmapResponse>(`/api/activity/heatmap${qs ? `?${qs}` : ''}`);
}

export function fetchRepos() {
  return api<{ repos: RepoRow[] }>('/api/activity/repos');
}

export function fetchTimeline(limit = 50) {
  return api<{ runs: TimelineRun[] }>(`/api/activity/timeline?limit=${limit}`);
}

export function fetchTokens(range: '7d' | '30d' | '90d' | '365d' = '30d') {
  return api<TokensResponse>(`/api/activity/tokens?range=${range}`);
}

// --- CLI Help Center -------------------------------------------------------

export type CliHelpKind = 'subcommand' | 'flag' | 'slash';

export interface CliHelpEntry {
  name: string;
  summary: string | null;
  description: string | null;
  usage: string | null;
  source: 'parsed' | 'curated';
  category: string;
}

export interface CliHelpCategory {
  key: string;
  label: string;
}

export interface CliHelpCatalogRow {
  cli: CliKind;
  display_name: string;
  version: string | null;
  installed: boolean;
  homepage: string | null;
  bin_path: string | null;
  last_scanned_at: number | null;
  scan_error: string | null;
  counts: { subcommand: number; flag: number; slash: number };
}

export interface CliHelpDetail {
  cli: CliKind;
  display_name: string;
  version: string | null;
  installed: boolean;
  homepage: string | null;
  bin_path: string | null;
  last_scanned_at: number | null;
  scan_error: string | null;
  categories: CliHelpCategory[];
  subcommands: CliHelpEntry[];
  flags: CliHelpEntry[];
  slash: CliHelpEntry[];
}

export function fetchCliHelpCatalog() {
  return api<{ clis: CliHelpCatalogRow[] }>('/api/activity/help/catalog');
}

export function fetchCliHelp(cli: string) {
  return api<CliHelpDetail>(`/api/activity/help/${encodeURIComponent(cli)}`);
}

export function refreshCliHelp() {
  return api<{ ok: boolean }>('/api/activity/help/refresh', { method: 'POST' });
}

// --- CLI subscription usage (e.g. Claude /usage) ---------------------------

export interface CliUsageRow {
  cli: CliKind;
  plan: string | null;
  session_pct: number | null;
  session_reset: string | null;
  week_pct_all: number | null;
  week_pct_sonnet: number | null;
  week_reset: string | null;
  credits: string | null;
  error: string | null;
  fetched_at: number;
}

export function fetchCliUsage() {
  return api<{ clis: CliUsageRow[] }>('/api/activity/usage');
}

export function refreshCliUsage() {
  return api<{ ok: boolean }>('/api/activity/usage/refresh', { method: 'POST' });
}

// Small formatting helpers shared across dashboard components.

export function formatDuration(ms: number): string {
  if (!ms || ms < 1000) return '0s';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${hr}h ${rem}m` : `${hr}h`;
}

export function formatTokens(n: number): string {
  if (!n) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export function formatRelative(ms: number): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}
