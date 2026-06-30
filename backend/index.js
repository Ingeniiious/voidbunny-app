import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRouter, { requireAuth } from './auth.js';
import filesRouter from './files.js';
import sessionsRouter from './sessions.js';
import statsRouter from './stats.js';
import transcribeRouter from './transcribe.js';
import browserRouter, { attachBrowser } from './browser.js';
import ticketsRouter from './tickets.js';
import pushRouter from './push.js';
import voidbunnyVerifyRouter from './voidbunny-verify.js';
import panelOpenRouter from './panel-open.js';
import activityRouter from './activity.js';
import { attachTerminal } from './terminal.js';
import { attachWatch } from './watch.js';
import { startBusyPoller } from './busy.js';
import { startTokenScanner } from './tokenScan.js';
import { scanAndPersistCliHelp } from './cliHelpScan.js';
import { refreshClaudeUsage } from './claudeUsageFetch.js';
import { PANEL_HOME, PANEL_UPLOADS_ROOT } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_DIST = path.resolve(__dirname, '../frontend/dist');

const app = express();
app.disable('x-powered-by');
// Caddy on the same box fronts us — trust X-Forwarded-For only from the
// loopback hop so req.ip is the real client and not 127.0.0.1.
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '64kb' }));

app.use('/api/auth', authRouter);
// Public — the site server fetches this during subdomain claim. No auth.
app.use('/api', voidbunnyVerifyRouter);
// Loopback-only in practice: CLIs inside tmux sessions POST here as their
// $BROWSER / xdg-open shim. Auth is the per-session token instead of the
// cookie/header used by the requireAuth-gated routes — see panel-open.js.
app.use('/api', panelOpenRouter);
app.use('/api', requireAuth, filesRouter);
app.use('/api', requireAuth, sessionsRouter);
app.use('/api', requireAuth, statsRouter);
app.use('/api', requireAuth, transcribeRouter);
app.use('/api', requireAuth, browserRouter);
app.use('/api', requireAuth, ticketsRouter);
app.use('/api/push', requireAuth, pushRouter);
app.use('/api/activity', requireAuth, activityRouter);

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/api/config', requireAuth, (_req, res) => {
  res.json({
    home: PANEL_HOME,
    uploadsRoot: PANEL_UPLOADS_ROOT,
  });
});

if (process.env.NODE_ENV === 'production') {
  // Cache discipline matters for the iOS/iPadOS PWA: Express's default
  // `Cache-Control: public, max-age=0` lets WebKit serve a stale HTML shell
  // for *days* inside an installed PWA without revalidating, which strands
  // users on an old JS bundle (we shipped fixes they never see). Split:
  //   - /assets/* are content-hashed by Vite → safe to cache for a year.
  //   - sw.js, manifest, index.html must always revalidate so a new deploy
  //     reaches the device on the next request.
  app.use(express.static(FRONTEND_DIST, {
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      const rel = path.relative(FRONTEND_DIST, filePath);
      if (rel.startsWith('assets' + path.sep)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  }));
  app.get(/^\/(?!api|terminal|healthz).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

const server = http.createServer(app);
attachTerminal(server);
attachBrowser(server);
attachWatch(server);
startBusyPoller();
startTokenScanner();

// Populate the CLI Help Center catalog. Deferred so boot isn't blocked by
// spawning `which` / `--help` for every supported CLI; re-runs every 6h to
// pick up new versions when CLIs are upgraded out-of-band.
setTimeout(() => {
  try { scanAndPersistCliHelp({ logger: console }); }
  catch (err) { console.warn('[cliHelpScan] initial scan failed:', err?.message); }
}, 4000);
setInterval(() => {
  try { scanAndPersistCliHelp({ logger: console }); }
  catch (err) { console.warn('[cliHelpScan] periodic scan failed:', err?.message); }
}, 6 * 60 * 60 * 1000);

// Refresh Claude Code's /usage panel snapshot. Deferred long enough that
// the help-scan finishes first (spawning two claude PTYs back-to-back can
// fight over the trust-dialog file). 30-minute cadence after that.
setTimeout(() => {
  refreshClaudeUsage({ logger: console }).catch((err) =>
    console.warn('[claudeUsage] initial fetch failed:', err?.message));
}, 30 * 1000);
setInterval(() => {
  refreshClaudeUsage({ logger: console }).catch((err) =>
    console.warn('[claudeUsage] periodic fetch failed:', err?.message));
}, 30 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`[panel] listening on http://127.0.0.1:${PORT}`);
});
