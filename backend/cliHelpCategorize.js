// Rule-based categoriser for CLI commands, flags, and slash commands. No AI,
// just keyword/regex matching against `name + ' ' + summary` lowercased. The
// first matching rule wins; ordering goes most-specific to most-generic so a
// "login flag" doesn't fall into the broader "auth" bucket by accident.
//
// `other` is the explicit fallback when nothing matches. Categories are
// stored on cli_help_commands.category and used by the drawer UI to group
// entries within each tab (Subcommands / Flags / Slash).

// Display order + label is the source of truth for the frontend too — we
// expose this list via the API so the UI doesn't have to duplicate it.
export const CATEGORIES = [
  { key: 'auth',        label: 'Authentication' },
  { key: 'session',     label: 'Session' },
  { key: 'model',       label: 'Model' },
  { key: 'mcp',         label: 'MCP servers' },
  { key: 'plugins',     label: 'Agents, plugins, hooks' },
  { key: 'permissions', label: 'Permissions & tools' },
  { key: 'files',       label: 'Files & paths' },
  { key: 'voice',       label: 'Voice' },
  { key: 'config',      label: 'Configuration' },
  { key: 'review',      label: 'Code review' },
  { key: 'install',     label: 'Install & updates' },
  { key: 'output',      label: 'Output & display' },
  { key: 'debug',       label: 'Debug & logs' },
  { key: 'help',        label: 'Help & info' },
  { key: 'other',       label: 'Other' },
];

export const CATEGORY_ORDER = CATEGORIES.map((c) => c.key);

// Each rule: { category, name?, text? } — `name` matches just the entry's
// name (more reliable for short tokens like `--model`); `text` matches
// against the combined "name + summary" haystack. Listed top-down by
// priority — first hit wins.
const RULES = [
  // --- voice ---
  { category: 'voice', name: /(^|[^a-z])voice([^a-z]|$)/i },
  { category: 'voice', text: /\b(voice|microphone|whisper|speech|audio)\b/ },

  // --- mcp (do this before plugins so /mcp doesn't fall into plugins) ---
  { category: 'mcp', name: /(^|[^a-z])mcp([^a-z]|$)/i },
  { category: 'mcp', text: /\bmcp server/i },

  // --- auth ---
  // `token` alone is too broad (matches "token usage", "context token"), so
  // only count it when it's clearly auth-shaped (api/auth/access token).
  { category: 'auth', name: /(login|logout|signin|signout|auth(?!or))/i },
  { category: 'auth', text: /\b(authenticat|sign in|sign out|api key|credential|oauth|api token|auth token|access token|session token)\b/i },

  // --- model ---
  { category: 'model', name: /^(-{0,2})model(s)?$/i },
  { category: 'model', name: /^\/model/i },
  { category: 'model', text: /\b(switch model|choose model|model to use)\b/i },

  // --- review ---
  { category: 'review', name: /(review|diff|bug|ultrareview)/i },
  { category: 'review', text: /\b(pull request|code review|review)\b/i },

  // --- plugins / agents / hooks ---
  // `hook` in a summary is too generic (e.g. /config mentions "hooks" only in
  // passing); rely on the name match for that case. Text rule keeps the
  // explicit multi-word phrases.
  { category: 'plugins', name: /(plugin|agent|subagent|hook)/i },
  { category: 'plugins', text: /\b(subagent|background agent|plugin manifest)/i },

  // --- permissions ---
  { category: 'permissions', name: /(permission|allow|deny|disallow|dangerous|skip-permission|tools?$)/i },
  { category: 'permissions', text: /\b(permission|allowed tool|skip permission|dangerous|sandbox)\b/i },

  // --- install / updates / version (before files so "doctor" with a
  // workspace-mentioning summary doesn't land in files) ---
  { category: 'install', name: /(install|update|upgrade|uninstall|version|doctor|migrate)/i },
  { category: 'install', text: /\b(install|self-update|migration|auto-?updater)\b/i },

  // --- session / conversation / memory ---
  { category: 'session', name: /(session|resume|continue|chat|history|clear|compact|memory|context|cost|fast|quit|exit|cancel|interrupt|loop)/i },
  { category: 'session', text: /\b(conversation|continue from|resume|context window|memory|history)\b/i },

  // --- files & paths ---
  { category: 'files', name: /(file|dir|directory|path|cwd|add-dir|workdir|workspace|project|init|input|stdin|output-file)/i },
  { category: 'files', text: /\b(directory|file path|working directory|cwd|workspace)\b/i },

  // --- debug / logs ---
  { category: 'debug', name: /(debug|verbose|quiet|silent|log|trace|profile|dry-?run)/i },
  { category: 'debug', text: /\b(verbose|debug|log level|trace|dry run|profil)\b/i },

  // --- config / settings (before output so /config doesn't get caught by
  // an "open settings UI for theme…" summary) ---
  { category: 'config', name: /(^\/config|^--?config|^config$|setting|env|profile|preset|model-?config)/i },
  { category: 'config', text: /\b(config file|setting|environment variable)\b/i },

  // --- output / display ---
  { category: 'output', name: /(output|format|json|yaml|pretty|color|colour|no-?color|theme|ide|markdown|stream|print)/i },
  { category: 'output', text: /\b(format|colou?r|theme|render|display|print|stream)/i },

  // --- help / info ---
  { category: 'help', name: /^(--?help|--?version|--?about|-h|-V|help)$/i },
  { category: 'help', name: /^\/(help|about)$/i },
];

export function categorize(name, summary, _kind) {
  if (!name) return 'other';
  const cleanName = String(name).trim();
  const haystack = `${cleanName} ${summary || ''}`.toLowerCase();

  for (const rule of RULES) {
    if (rule.name && rule.name.test(cleanName)) return rule.category;
    if (rule.text && rule.text.test(haystack)) return rule.category;
  }
  return 'other';
}
