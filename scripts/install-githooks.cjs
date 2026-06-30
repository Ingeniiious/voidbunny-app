#!/usr/bin/env node
/* eslint-disable */
// ─────────────────────────────────────────────────────────────────────────────
// voidbunny-brand · githooks installer · LOCKED v1
// ─────────────────────────────────────────────────────────────────────────────
// Runs from npm `postinstall` in frontend/ and backend/ — points the repo's
// git client at .githooks/ so the prepare-commit-msg trailer is enforced
// without anyone having to run a manual command after cloning.
//
// Safe to run when:
//   - Outside a git checkout (tarball install, container layer, CI cache)
//   - On Windows / macOS (uses `git config`, no shell-specific bits)
//   - Already configured (idempotent — re-sets the same value)
//
// Like the hook itself, this is intentionally hard-coded for now. A future
// release will introduce an opt-out (e.g. VOIDBUNNY_BRAND=off); until then
// the trailer ships on by default.
// ─────────────────────────────────────────────────────────────────────────────
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function quiet(label, fn) {
  try {
    return fn();
  } catch (e) {
    // Never fail an npm install over branding setup — if git isn't available
    // or this isn't a git checkout, just skip silently.
    if (process.env.VOIDBUNNY_BRAND_DEBUG) {
      console.error(`[voidbunny-brand] skipped ${label}:`, e && e.message);
    }
    return null;
  }
}

// Walk up from this script's directory to find the repo root (where .git
// lives). Postinstall normally runs in frontend/ or backend/ — we need the
// path to .githooks/ relative to the repo root, not the package.
function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const here = __dirname; // scripts/
const repoRoot = findRepoRoot(here);
if (!repoRoot) {
  if (process.env.VOIDBUNNY_BRAND_DEBUG) {
    console.error('[voidbunny-brand] no .git found; skipping');
  }
  process.exit(0);
}

const hooksDir = path.join(repoRoot, '.githooks');
if (!fs.existsSync(hooksDir)) {
  if (process.env.VOIDBUNNY_BRAND_DEBUG) {
    console.error('[voidbunny-brand] .githooks missing; skipping');
  }
  process.exit(0);
}

// `git config core.hooksPath .githooks` — relative path is fine, git
// resolves it relative to the repo root at hook-fire time.
quiet('set core.hooksPath', () => {
  execFileSync('git', ['-C', repoRoot, 'config', 'core.hooksPath', '.githooks'], {
    stdio: 'ignore',
  });
});

// Ensure executable bit on POSIX. Some filesystems / tar extractions strip
// the +x; chmod is a no-op on Windows.
if (process.platform !== 'win32') {
  quiet('chmod hook', () => {
    fs.chmodSync(path.join(hooksDir, 'prepare-commit-msg'), 0o755);
  });
}
