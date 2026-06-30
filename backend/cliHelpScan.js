import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isReady,
  upsertCliCatalog,
  replaceCliHelpCommands,
} from './db.js';
import { categorize } from './cliHelpCategorize.js';

// Scans every supported CLI's `--help` output, persists the parsed
// subcommands and flags + the curated slash commands to SQLite. Read by the
// CLI Help Center card on the dashboard.
//
// The scanner is deliberately conservative: anything the parser can't
// confidently classify is dropped. The raw --help is kept in cli_catalog so
// we can debug misses without re-running.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURATED_PATH = path.join(__dirname, 'data', 'cliHelpCurated.json');

// Storage key (matches frontend CliKind) → list of binary names to try in
// order. `cursor` is special because the actual binary is `cursor-agent`.
const SUPPORTED = ['claude', 'codex', 'gemini', 'grok', 'cursor'];
const BIN_NAMES = {
  claude: ['claude'],
  codex: ['codex'],
  gemini: ['gemini'],
  grok: ['grok'],
  cursor: ['cursor-agent', 'cursor'],
};

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s) => (s || '').replace(ANSI_RE, '');

function loadCurated() {
  try {
    return JSON.parse(fs.readFileSync(CURATED_PATH, 'utf8'));
  } catch (err) {
    console.warn('[cliHelpScan] curated JSON missing or invalid:', err?.message);
    return {};
  }
}

function resolveBin(cli) {
  const candidates = BIN_NAMES[cli] || [cli];
  for (const name of candidates) {
    const r = spawnSync('which', [name], { encoding: 'utf8', timeout: 3000 });
    if (r.status === 0) {
      const p = stripAnsi(r.stdout).trim().split('\n')[0];
      if (p) return p;
    }
  }
  return null;
}

function getVersion(binPath) {
  const r = spawnSync(binPath, ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, NO_COLOR: '1', CI: '1' },
  });
  const out = stripAnsi(`${r.stdout || ''}\n${r.stderr || ''}`).trim();
  const first = out.split('\n').find((l) => l.trim().length > 0);
  return first ? first.trim() : null;
}

function getHelp(binPath) {
  const r = spawnSync(binPath, ['--help'], {
    encoding: 'utf8',
    timeout: 8000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', CI: '1', TERM: 'dumb' },
  });
  return stripAnsi(`${r.stdout || ''}\n${r.stderr || ''}`);
}

// Indent-aware --help parser. Walks the text line-by-line, switching between
// section buckets when it sees a header like "Commands:" or "Options:", and
// extracts an array of { name, summary, usage } entries from each.
function parseHelpOutput(text) {
  const lines = (text || '').split('\n');
  const sections = { subcommand: [], flag: [] };
  let current = null;
  let lastEntry = null;
  let lastIndent = 0;

  const HEADERS = [
    { re: /^\s*(Commands|Subcommands|Available\s+Commands)\s*:?\s*$/i, bucket: 'subcommand' },
    { re: /^\s*(Options|Flags|Global\s+Options|Global\s+Flags|Common\s+Options)\s*:?\s*$/i, bucket: 'flag' },
  ];

  const indentOf = (l) => l.match(/^\s*/)[0].length;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) {
      // Blank line ends the current "entry" continuation but keeps the section.
      lastEntry = null;
      continue;
    }
    const matchedHeader = HEADERS.find((h) => h.re.test(raw));
    if (matchedHeader) {
      current = matchedHeader.bucket;
      lastEntry = null;
      lastIndent = 0;
      continue;
    }
    if (!current) continue;
    const indent = indentOf(raw);
    const trimmed = raw.trim();

    // A new entry: usually 2+ spaces of indent and either a flag char or
    // an alpha token at the start. Split on the first 2-space run.
    const isFlagLine = /^-/.test(trimmed);
    const isCommandLine = /^[A-Za-z][A-Za-z0-9_:.-]*/.test(trimmed) && current === 'subcommand';
    const looksLikeEntry = indent >= 2 && (isFlagLine || isCommandLine);

    if (looksLikeEntry) {
      // Split entry name (left) and summary (right) on first 2+ space gap.
      const gap = trimmed.search(/\s{2,}/);
      let name, summary;
      if (gap === -1) {
        name = trimmed;
        summary = '';
      } else {
        name = trimmed.slice(0, gap).trim();
        summary = trimmed.slice(gap).trim();
      }

      // For flags, the name often includes a value placeholder we want to keep
      // in usage but trim to the canonical flag for the `name` key.
      let usage = null;
      if (current === 'flag') {
        usage = name;
        // canonical name = first --long-form, else first -short
        const longMatch = name.match(/(--[A-Za-z0-9][A-Za-z0-9-]*)/);
        const shortMatch = name.match(/(-[A-Za-z])/);
        name = longMatch ? longMatch[1] : shortMatch ? shortMatch[1] : name;
      } else if (current === 'subcommand') {
        // Subcommand name is the first token. Anything after is usage shape.
        const tok = name.split(/\s+/);
        if (tok.length > 1) {
          usage = name;
          name = tok[0];
        }
      }

      const entry = { name, summary, usage, description: null };
      sections[current].push(entry);
      lastEntry = entry;
      lastIndent = indent;
      continue;
    }

    // Continuation: deeper indent than the last entry's name column and
    // we currently have a last entry. Append to its description.
    if (lastEntry && indent > lastIndent) {
      lastEntry.description = lastEntry.description
        ? `${lastEntry.description} ${trimmed}`
        : trimmed;
      continue;
    }

    // Otherwise this line is noise (e.g. preamble between sections) — skip.
  }

  // Dedupe by name (some help outputs repeat aliases). Keep first occurrence.
  const dedupe = (arr) => {
    const seen = new Set();
    const out = [];
    for (const e of arr) {
      if (!e.name || seen.has(e.name)) continue;
      seen.add(e.name);
      out.push(e);
    }
    return out;
  };

  return {
    subcommand: dedupe(sections.subcommand),
    flag: dedupe(sections.flag),
  };
}

function applyOverrides(entries, overrides) {
  if (!overrides) return entries;
  return entries.map((e) => {
    const o = overrides[e.name];
    if (!o) return e;
    return {
      ...e,
      summary: o.summary || e.summary,
      description: o.description || e.description,
    };
  });
}

function scanOneCli(cli, curated, logger) {
  const meta = curated[cli] || {};
  const displayName = meta.display_name || cli;
  const homepage = meta.homepage || null;
  const now = Date.now();

  const binPath = resolveBin(cli);
  if (!binPath) {
    upsertCliCatalog({
      cli,
      bin_path: null,
      version: null,
      installed: 0,
      homepage,
      display_name: displayName,
      raw_help: null,
      scan_error: null,
      last_scanned_at: now,
    });
    // Still surface curated slash commands even if not installed? No — the
    // card hides uninstalled CLIs, so wiping their command rows is fine.
    replaceCliHelpCommands(cli, 'subcommand', []);
    replaceCliHelpCommands(cli, 'flag', []);
    replaceCliHelpCommands(cli, 'slash', []);
    return { cli, installed: false };
  }

  let version = null;
  let rawHelp = null;
  let parseError = null;
  let parsed = { subcommand: [], flag: [] };
  try {
    version = getVersion(binPath);
    rawHelp = getHelp(binPath);
    parsed = parseHelpOutput(rawHelp);
  } catch (err) {
    parseError = err?.message || String(err);
    logger?.warn?.(`[cliHelpScan] ${cli} scan failed: ${parseError}`);
  }

  const overrides = meta.overrides || {};
  const sub = applyOverrides(parsed.subcommand, overrides).map((e, i) => ({
    ...e,
    source: 'parsed',
    category: categorize(e.name, e.summary, 'subcommand'),
    sort_order: i,
  }));
  const flag = applyOverrides(parsed.flag, overrides).map((e, i) => ({
    ...e,
    source: 'parsed',
    category: categorize(e.name, e.summary, 'flag'),
    sort_order: i,
  }));
  const slash = (meta.slash_commands || []).map((e, i) => ({
    name: e.name,
    summary: e.summary || null,
    description: e.description || null,
    usage: e.usage || null,
    source: 'curated',
    category: categorize(e.name, e.summary || '', 'slash'),
    sort_order: i,
  }));

  upsertCliCatalog({
    cli,
    bin_path: binPath,
    version,
    installed: 1,
    homepage,
    display_name: displayName,
    raw_help: rawHelp,
    scan_error: parseError,
    last_scanned_at: now,
  });
  replaceCliHelpCommands(cli, 'subcommand', sub);
  replaceCliHelpCommands(cli, 'flag', flag);
  replaceCliHelpCommands(cli, 'slash', slash);

  return {
    cli,
    installed: true,
    version,
    counts: { subcommand: sub.length, flag: flag.length, slash: slash.length },
  };
}

export function scanAndPersistCliHelp({ logger = console } = {}) {
  if (!isReady()) {
    logger?.warn?.('[cliHelpScan] db not ready, skipping');
    return [];
  }
  const curated = loadCurated();
  const results = [];
  for (const cli of SUPPORTED) {
    try {
      results.push(scanOneCli(cli, curated, logger));
    } catch (err) {
      logger?.warn?.(`[cliHelpScan] ${cli} threw: ${err?.message}`);
      results.push({ cli, installed: false, error: err?.message });
    }
  }
  logger?.log?.(
    `[cliHelpScan] scanned ${results.length} CLIs, installed=${results.filter((r) => r.installed).length}`,
  );
  return results;
}

export const SUPPORTED_CLIS = SUPPORTED;
