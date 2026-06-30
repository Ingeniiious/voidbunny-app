# Changelog

All notable changes to Panel. Format roughly follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [semver](https://semver.org/): bump **minor** for user-visible features, **patch** for bug fixes, **major** for breaking changes.

Bump workflow:

1. Edit `backend/package.json` and `frontend/package.json` `version` fields together.
2. Add an entry below under a new `## [x.y.z] — YYYY-MM-DD` heading.
3. Commit, then tag: `git tag v$(node -p "require('./backend/package.json').version") && git push --tags`.

The running stats popover shows `ui v…` (build-time) and `api v…` (runtime) so you can spot a stale frontend after deploys.

## [0.5.0] — 2026-05-14

### Added
- **In-app Brave browser tabs.** A new "browser" tab kind lives alongside terminals. Each tab spawns a dedicated `Xvfb + brave-browser + x11vnc` stack on the server; the panel backend authenticates a WebSocket on `/browser` and bridges to x11vnc on loopback. Frontend embeds `@novnc/novnc` (1.7.0). Opens URLs from Claude prompts in-app, lets you hit localhost dev servers from your phone, and exposes a Chrome DevTools Protocol port per instance so Playwright MCP can `connectOverCDP` and visualize runs inside the panel. Concurrency capped at 3 by default (`PANEL_BROWSER_MAX_INSTANCES`); browser binary overridable via `PANEL_BROWSER_BIN`; geometry via `PANEL_BROWSER_GEOMETRY`.
- **Mobile soft-keyboard for the in-app browser.** A floating keyboard button (bottom-right, mobile only) brings up the OS keyboard. Keystrokes — letters, special keys, iOS autocorrect insertions, IME composition — forward to Brave via noVNC's `sendKey`. Without this the address bar and every page input were untypable on a phone, because focusing a `<canvas>` doesn't surface a soft keyboard.
- **Mobile-mode browser instances.** A second "New mobile browser" button appears in the sidebar on touch devices and spawns a Brave instance with a portrait `412×915` framebuffer, a Pixel 7 user-agent, and `--touch-events=enabled` so sites serve their mobile layouts. The original button still spawns the desktop `1280×800` variant. `POST /api/browser` now accepts `{ mode: 'desktop' | 'mobile' }`; geometry and UA are overridable via `PANEL_BROWSER_MOBILE_GEOMETRY` and `PANEL_BROWSER_MOBILE_UA`.
- **Media-aware file preview.** Images, video, audio, and PDFs now render in the file preview modal (previously only text was supported — opening a PNG showed raw bytes). New `GET /api/file/raw` endpoint streams the file with the right Content-Type and supports HTTP Range so video can scrub. Preview header gained a download button that works for any binary file.
- **PixelSnow auth backdrop.** The login screen now renders a two-layer GPU pixel-snow background — white at moderate density plus an orange accent layer at lower density. Built on `@react-bits/PixelSnow` (three.js fragment shader); both layers absolute-positioned behind the auth card with `pointer-events-none` so the form stays interactive. Snow pauses when the page is hidden.

### Hardening
- **Single-use WebSocket tickets.** `/terminal` and `/browser` WS upgrades no longer accept the JWT in the query string (which Caddy access logs would capture). The client first calls `GET /api/ws-ticket` (Bearer-auth'd) to fetch a 32-byte random ticket with a 15-second TTL, then opens the WS with `?ticket=…`. The server consumes the ticket on upgrade — single-use, in-memory, no JWT ever appears in any URL or log.
- **Bcrypt password example in `.env.example`.** The default value is now a `$2b$12$` placeholder with the generation one-liner inline. `backend/auth.js` already detected `$2a$/$2b$/$2y$` prefixes and switched to `bcrypt.compare`; this just nudges new installs toward the hashed path by default. Plain-text values still work as a first-run fallback.
- **Hardened Caddy response headers.** `deploy/panel.caddy` now ships with HSTS preload, `X-Frame-Options: DENY`, and `Permissions-Policy: interest-cohort=()` in addition to the prior `nosniff`/`Referrer-Policy`/`-Server`. Existing deployments: see `SETUP-HARDENING.txt` for the migration.
- **Auth audit log.** Every `/api/auth` attempt now writes one line to `journalctl -u panel`: `[auth] login ok ip=…` on success, `[auth] login fail ip=…` on failure. No passwords or tokens logged.
- **Boot sweep for orphan browser tmp dirs.** `backend/browser.js` reaps stale `/tmp/panel-browser-*` directories at module load — no-op under `PrivateTmp=true` but defensive for non-systemd setups where the panel was killed `-9`.
- **`include=dev` in `.npmrc` (repo root + frontend + backend).** Project-local override so `NODE_ENV=production` in the runtime shell doesn't silently skip devDependencies during local installs / builds. The systemd unit still sets its own `Environment=NODE_ENV=production` for the running service.
- **`SETUP-HARDENING.txt`** at the repo root documents the host-side steps an operator needs to run once (Caddy header migration, bcrypt-hashing the password, optional ufw/fail2ban/unattended-upgrades).

### Known limitations
- Browser instances are ephemeral — `sudo systemctl restart panel` kills all running Brave/Xvfb/x11vnc children (terminals survive because tmux is a daemon; Brave isn't).
- No audio passthrough — VNC doesn't carry audio.
- Display size is fixed at instance startup (geometry can't change once spawned — close the tab and open a new one to switch desktop ↔ mobile mode).

## [0.4.0] — 2026-05-14

### Added
- Mobile long-press to select & copy terminal text. Press-and-hold (500ms) anywhere in the terminal to anchor a row selection, drag to extend, then tap the Copy button. Falls back to `execCommand('copy')` on older WebViews / non-HTTPS contexts. Light haptic on entering select mode; "Copied" toast on success.

### Fixed
- Terminal hyperlinks now open reliably on iOS Safari and inside popup-blocked browsers. The `@xterm/addon-web-links` default activator does `window.open()` + `.location.href` which mobile browsers treat as an indirect open and silently block; we now open the URL in a single `window.open(uri, '_blank', 'noopener,noreferrer')` call so it's recognised as a direct user gesture.

## [0.3.0] — 2026-05-14

### Added
- Mobile mic / dictation button at the start of the KeyBar. Tap to start, tap to stop. Records via `MediaRecorder` (webm/opus on most devices, mp4 on iOS), posts the blob to the new `/api/transcribe` endpoint, and pastes the Whisper-returned text into the active terminal as if typed. 60-second safety cap with a live duration counter.
- `OPENAI_API_KEY` (+ optional `OPENAI_TRANSCRIBE_MODEL`) env support; the endpoint returns 503 with a clear message if the key is missing.

## [0.2.0] — 2026-05-14

### Added
- `/api/stats` endpoint reporting RAM, CPU load, disk usage, uptime, and the running API version.
- Header stats pill (RAM + CPU on desktop, RAM only on mobile) with color thresholds at 70% / 85% and a tap-to-expand details panel including a "close idle terminals" hint when memory is tight.
- Double-tap a folder in the file tree to `cd` into it from the active terminal (mobile drawer closes automatically).
- Mobile touch-scroll for the xterm scrollback buffer (single-finger vertical drag, 8px threshold so taps still flow through to tmux).
- voidbunny logo used on the Auth screen + favicon + apple-touch-icon; page title is now "Panel — voidbunny".
- Build-time `__APP_VERSION__` injection and matching runtime `version` from the backend.

### Changed
- New tmux sessions start in `$HOME` instead of the systemd unit's `WorkingDirectory`.
- KeyBar (mobile shortcut row) now uses tap-vs-scroll detection so horizontal scrolling no longer fires keys.
- Auth screen pinned to `fixed inset-0` with safe-area insets — mobile login no longer scrolls and is dead-centered.
- File preview modal: `dvh` height, iOS momentum scrolling, `overscroll-contain`, explicit `touch-action: pan-y`, safe-area insets.

## [0.1.0] — initial deploy

Scaffolded backend (Express + JWT + node-pty + tmux persistence), frontend (Vite + React + xterm.js), and Caddy / systemd deployment. See git history for the build-up.
