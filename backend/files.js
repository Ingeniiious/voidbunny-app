import { Router } from 'express';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { PANEL_HOME, PANEL_UPLOADS_ROOT } from './config.js';

const router = Router();

const ROOT = PANEL_HOME;
const MAX_FILE_BYTES = 500 * 1024;
const MAX_UPLOAD_BYTES = 1024 * 1024; // 1 MB — comfortable cap for .env / config files
const UPLOADS_ROOT = PANEL_UPLOADS_ROOT;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB — phone screenshots / photos / PDFs
const MAX_COLLISION_TRIES = 50;
const PROJECT_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SEARCH_TIMEOUT_MS = 5000;
const SEARCH_MAX_RESULTS = 200;
const SEARCH_IGNORE_GLOBS = [
  '!node_modules', '!.git', '!dist', '!build', '!.next', '!.cache',
  '!*.lock', '!package-lock.json', '!yarn.lock', '!pnpm-lock.yaml',
];

function resolveSafe(input) {
  if (typeof input !== 'string' || !input) return null;
  const resolved = path.resolve(input);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return resolved;
}

function isValidFilename(name) {
  if (typeof name !== 'string' || !name || name.length > 255) return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false;
  return true;
}

function sanitizeProjectName(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return null;
  if (!PROJECT_NAME_RE.test(trimmed)) return null;
  return trimmed;
}

async function pickUniqueName(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 0; i <= MAX_COLLISION_TRIES; i++) {
    const target = path.join(dir, candidate);
    try {
      await fs.access(target);
      // exists → try next suffix
      candidate = `${base}-${i + 1}${ext}`;
    } catch {
      return candidate;
    }
  }
  return null;
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        const err = new Error('payload too large');
        err.status = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

router.get('/files', async (req, res) => {
  const dir = resolveSafe(req.query.path);
  if (!dir) return res.status(400).json({ error: 'invalid path' });

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = err.code === 'ENOENT' ? 404 : err.code === 'EACCES' ? 403 : 500;
    return res.status(code).json({ error: err.code ?? 'read failed' });
  }

  const results = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      return null;
    }
    return {
      name: entry.name,
      type: entry.isDirectory() ? 'dir' : 'file',
      path: full,
      size: stat.size,
      modified: stat.mtime.toISOString(),
    };
  }));

  const filtered = results.filter(Boolean).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  res.json(filtered);
});

router.get('/file', async (req, res) => {
  const filePath = resolveSafe(req.query.path);
  if (!filePath) return res.status(400).json({ error: 'invalid path' });

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    const code = err.code === 'ENOENT' ? 404 : err.code === 'EACCES' ? 403 : 500;
    return res.status(code).json({ error: err.code ?? 'stat failed' });
  }

  if (!stat.isFile()) return res.status(400).json({ error: 'not a file' });
  if (stat.size > MAX_FILE_BYTES) return res.status(413).json({ error: 'file too large', maxBytes: MAX_FILE_BYTES });

  try {
    const content = await fs.readFile(filePath, 'utf8');
    res.json({ content, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.code ?? 'read failed' });
  }
});

// GET /api/file/raw?path=...
// Streams the file with a Content-Type sniffed from the extension so that
// images, video, audio, PDFs etc. render in the browser instead of coming
// back as garbled UTF-8 from /api/file. Supports Range requests via sendFile.
router.get('/file/raw', async (req, res) => {
  const filePath = resolveSafe(req.query.path);
  if (!filePath) return res.status(400).json({ error: 'invalid path' });

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    const code = err.code === 'ENOENT' ? 404 : err.code === 'EACCES' ? 403 : 500;
    return res.status(code).json({ error: err.code ?? 'stat failed' });
  }
  if (!stat.isFile()) return res.status(400).json({ error: 'not a file' });

  res.sendFile(filePath, {
    headers: {
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  }, (err) => {
    if (err && !res.headersSent) {
      const code = err.code === 'ENOENT' ? 404 : err.code === 'EACCES' ? 403 : 500;
      res.status(code).json({ error: err.code ?? 'send failed' });
    }
  });
});

// GET /api/files/search?q=<query>&path=<root>&mode=name|content&limit=N
// Filename or content search powered by ripgrep. Scoped under ROOT.
router.get('/files/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.json({ results: [], truncated: false });
  if (q.length > 200) return res.status(400).json({ error: 'query too long' });

  const rootArg = typeof req.query.path === 'string' && req.query.path ? req.query.path : ROOT;
  const root = resolveSafe(rootArg);
  if (!root) return res.status(400).json({ error: 'invalid path' });

  const mode = req.query.mode === 'content' ? 'content' : 'name';
  const requested = Number.parseInt(typeof req.query.limit === 'string' ? req.query.limit : '', 10);
  const limit = Number.isFinite(requested) && requested > 0 && requested < SEARCH_MAX_RESULTS
    ? requested
    : SEARCH_MAX_RESULTS;

  const ignoreArgs = SEARCH_IGNORE_GLOBS.flatMap((g) => ['-g', g]);

  let args;
  if (mode === 'name') {
    // List files, then we filter by substring in JS so ripgrep doesn't have to
    // interpret the query as a regex (avoids escaping pitfalls).
    args = ['--files', '--hidden', '--no-messages', ...ignoreArgs, root];
  } else {
    args = [
      '--fixed-strings',
      '--ignore-case',
      '--hidden',
      '--no-messages',
      '--with-filename',
      '--line-number',
      '--max-count', '3',
      '--max-columns', '300',
      '--max-filesize', '2M',
      ...ignoreArgs,
      '--', q, root,
    ];
  }

  const child = spawn('rg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => child.kill('SIGKILL'), SEARCH_TIMEOUT_MS);

  let truncated = false;
  let totalBytes = 0;
  const needle = q.toLowerCase();
  const results = [];
  let buf = '';

  const flushLine = (line) => {
    if (!line || results.length >= limit) return;
    if (mode === 'name') {
      const base = line.split('/').pop() || line;
      if (!base.toLowerCase().includes(needle)) return;
      results.push({ kind: 'name', path: line, name: base });
    } else {
      // ripgrep output: path:line:content
      const i1 = line.indexOf(':');
      if (i1 < 0) return;
      const filePath = line.slice(0, i1);
      const rest = line.slice(i1 + 1);
      const i2 = rest.indexOf(':');
      if (i2 < 0) return;
      const lineNum = Number.parseInt(rest.slice(0, i2), 10);
      const preview = rest.slice(i2 + 1);
      const name = filePath.split('/').pop() || filePath;
      results.push({
        kind: 'content',
        path: filePath,
        name,
        line: Number.isFinite(lineNum) ? lineNum : 0,
        preview: preview.length > 280 ? preview.slice(0, 280) + '…' : preview,
      });
    }
    if (results.length >= limit) {
      truncated = true;
      child.kill('SIGTERM');
    }
  };

  child.stdout.on('data', (chunk) => {
    totalBytes += chunk.length;
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      flushLine(line);
      if (results.length >= limit) { buf = ''; break; }
    }
    if (totalBytes > 4 * 1024 * 1024) {
      truncated = true;
      child.kill('SIGTERM');
    }
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    if (!res.headersSent) res.status(500).json({ error: err.code === 'ENOENT' ? 'ripgrep not installed' : 'search failed' });
  });

  child.on('close', (code, signal) => {
    clearTimeout(timer);
    if (buf) flushLine(buf);
    // rg exits 1 when there are no matches — that's fine. Any other non-zero
    // (except our own SIGTERM) is unexpected; still return what we have.
    const killedByUs = signal === 'SIGTERM' || signal === 'SIGKILL';
    const timedOut = signal === 'SIGKILL' && !truncated;
    if (timedOut) truncated = true;
    if (!res.headersSent) {
      res.json({
        results: results.slice(0, limit),
        truncated: truncated || (!killedByUs && code !== 0 && code !== 1) || false,
        mode,
      });
    }
  });
});

// POST /api/upload?path=<dir>&name=<filename>[&force=1]
// Raw request body is the file content. Capped at MAX_UPLOAD_BYTES.
// Writes with mode 0o600 since this is primarily intended for secret files (.env etc).
router.post('/upload', async (req, res) => {
  const dir = resolveSafe(req.query.path);
  if (!dir) return res.status(400).json({ error: 'invalid path' });

  const name = typeof req.query.name === 'string' ? req.query.name : '';
  if (!isValidFilename(name)) return res.status(400).json({ error: 'invalid name' });

  let dirStat;
  try {
    dirStat = await fs.stat(dir);
  } catch (err) {
    const code = err.code === 'ENOENT' ? 404 : err.code === 'EACCES' ? 403 : 500;
    return res.status(code).json({ error: err.code ?? 'stat failed' });
  }
  if (!dirStat.isDirectory()) return res.status(400).json({ error: 'not a directory' });

  const target = path.join(dir, name);
  // Defensive: re-confirm the joined target is still inside ROOT.
  if (target !== path.resolve(target) || (target !== ROOT && !target.startsWith(ROOT + path.sep))) {
    return res.status(400).json({ error: 'invalid name' });
  }

  const force = req.query.force === '1' || req.query.force === 'true';
  if (!force) {
    try {
      await fs.access(target);
      return res.status(409).json({ error: 'exists', path: target });
    } catch {
      // doesn't exist — proceed
    }
  }

  let body;
  try {
    body = await readRawBody(req, MAX_UPLOAD_BYTES);
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message });
  }

  try {
    await fs.writeFile(target, body, { mode: 0o600 });
  } catch (err) {
    return res.status(500).json({ error: err.code ?? 'write failed' });
  }

  res.json({ ok: true, path: target, size: body.length });
});

// POST /api/upload-attachment?project=<bucket>&name=<filename>
// Raw request body is the file content. Capped at MAX_ATTACHMENT_BYTES.
// Writes into UPLOADS_ROOT/<project>/, mkdir -p'd on demand with 0o700.
// Filename collisions get a `-N` suffix so we never silently overwrite.
router.post('/upload-attachment', async (req, res) => {
  const project = sanitizeProjectName(typeof req.query.project === 'string' ? req.query.project : '');
  if (!project) return res.status(400).json({ error: 'invalid project' });

  const name = typeof req.query.name === 'string' ? req.query.name : '';
  if (!isValidFilename(name)) return res.status(400).json({ error: 'invalid name' });

  const targetDir = resolveSafe(path.join(UPLOADS_ROOT, project));
  if (!targetDir) return res.status(400).json({ error: 'invalid project' });

  try {
    await fs.mkdir(targetDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    return res.status(500).json({ error: err.code ?? 'mkdir failed' });
  }

  const unique = await pickUniqueName(targetDir, name);
  if (!unique) return res.status(409).json({ error: 'too many collisions' });

  const target = path.join(targetDir, unique);
  if (target !== path.resolve(target) || !target.startsWith(targetDir + path.sep)) {
    return res.status(400).json({ error: 'invalid name' });
  }

  let body;
  try {
    body = await readRawBody(req, MAX_ATTACHMENT_BYTES);
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message });
  }

  try {
    await fs.writeFile(target, body, { mode: 0o600 });
  } catch (err) {
    return res.status(500).json({ error: err.code ?? 'write failed' });
  }

  res.json({ ok: true, path: target, size: body.length });
});

export default router;
