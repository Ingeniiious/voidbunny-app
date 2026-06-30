# Claude-Server (Panel)

Self-hosted, mobile-first server control panel. Multiple real PTY terminal sessions in parallel browser tabs, gated by JWT, deployable behind Caddy.

## Stack

- **Backend:** Node 20+, Express, `ws`, `node-pty`, `jsonwebtoken`, `bcryptjs`
- **Frontend:** Vite + React + TypeScript, Tailwind, `xterm.js`
- **Deploy:** systemd + Caddy (already on this box) for TLS termination

## Layout

```
backend/    Express API on :4000, JWT auth, WebSocket/PTY bridge
frontend/   Vite React app, xterm.js terminals, file tree, theme toggle
deploy/     Caddy site block + systemd unit
.env        Local secrets (not committed) — copy from .env.example
```

## Local dev

```bash
# 1. Backend deps
cd backend && npm install && cd ..

# 2. Frontend deps
cd frontend && npm install && cd ..

# 3. Configure env
cp .env.example .env
# edit .env — set JWT_SECRET (e.g. `openssl rand -hex 48`) and PANEL_PASSWORD

# 4. Run both (separate terminals)
cd backend && npm run dev      # backend on :4000
cd frontend && npm run dev     # frontend on :5173 with proxy to :4000
```

Open http://127.0.0.1:5173, log in with `PANEL_USERNAME` / `PANEL_PASSWORD`.

## Production deploy (this Hetzner box)

### 1. Prerequisites (already installed on this box)

Node 22, build tools (python3, make, g++), and Caddy are already
running. Confirm with `node -v`, `which caddy`.

**For the in-app browser feature** (optional — terminals work without it):

```bash
sudo apt update
sudo apt install -y xvfb x11vnc curl

# Brave Browser APT repo + Brave itself
sudo curl -fsSLo /usr/share/keyrings/brave-browser-archive-keyring.gpg \
  https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg] https://brave-browser-apt-release.s3.brave.com/ stable main" \
  | sudo tee /etc/apt/sources.list.d/brave-browser-release.list
sudo apt update && sudo apt install -y brave-browser
```

Override the default binary by setting `PANEL_BROWSER_BIN` in `.env`
(e.g. `/usr/bin/chromium`). Cap concurrent instances with
`PANEL_BROWSER_MAX_INSTANCES` (default `3`, ~250 MB each).

**Coding-agent CLIs** (optional, but the panel's whole point — pick whichever
you have credits/subscriptions for, or install all three and A/B them from
different tabs):

```bash
sudo npm install -g @anthropic-ai/claude-code   # Claude Code (Anthropic)
sudo npm install -g @openai/codex               # Codex CLI (OpenAI)
sudo npm install -g @google/gemini-cli          # Gemini CLI (Google)
```

Run each one once (`claude`, `codex`, `gemini`) to walk through its
first-run auth. See `SETUP-CLI-AGENTS.txt` for sudo-free install, env-var
auth, and config-dir details.

### 2. Install + build

```bash
cd /opt/voidbunny
git pull

cd backend && npm install --omit=dev && cd ..
cd frontend && npm ci && npm run build && cd ..

cp .env.example .env   # if not done yet
# edit .env — set JWT_SECRET and PANEL_PASSWORD (the password env var
# accepts either plaintext or a bcrypt $2a$/$2b$ hash)
```

### 3. systemd service

```bash
sudo cp deploy/panel.service /etc/systemd/system/panel.service
sudo systemctl daemon-reload
sudo systemctl enable --now panel.service
sudo systemctl status panel
# logs:
journalctl -u panel -f
```

### 4. Caddy site block

The panel is served at **`app.voidbunny.xyz`**.

```bash
# Append the block to the system Caddyfile, swapping the placeholder
sudo bash -c "sed 's/YOUR_SUBDOMAIN/app.voidbunny.xyz/' /opt/voidbunny/deploy/panel.caddy >> /etc/caddy/Caddyfile"
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy auto-provisions a TLS cert on first request. Make sure
`app.voidbunny.xyz` has an A record pointing at this server's public
IP before reloading.

### 5. Verify

```bash
# health check (HTTP through Caddy)
curl https://app.voidbunny.xyz/healthz

# in a browser
open https://app.voidbunny.xyz
# log in, open a terminal tab, confirm WebSocket stays connected
```

## Updating

```bash
cd /opt/voidbunny
git pull
cd backend && npm install --omit=dev && cd ..
cd frontend && npm ci && npm run build && cd ..
sudo systemctl restart panel
```

## In-app browser (Brave via noVNC)

Each "browser" tab spawns a dedicated `Xvfb + brave-browser + x11vnc`
stack on the server and streams the framebuffer into the panel via
noVNC. Cookies/profile are isolated per instance under
`/tmp/panel-browser-<id>`.

Each instance also exposes a Chrome DevTools Protocol port on
loopback (starting at `9222`, returned in the `POST /api/browser`
response as `cdpPort` / `cdpUrl`). To drive a tab from Playwright MCP:

```js
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
```

Known limitations (v1):
- No audio (VNC doesn't carry audio).
- Browser instances die when the panel backend restarts (Brave isn't
  daemonized the way tmux is — restart the panel and you'll need to
  re-open browser tabs).
- Display geometry is fixed at startup (default `1280x800x24`,
  overridable via `PANEL_BROWSER_GEOMETRY`).

## Security notes

- All `/api/*` routes require a Bearer JWT (issued by `POST /api/auth`,
  7-day expiry).
- The WebSocket at `/terminal` requires the JWT in a `?token=` query
  parameter, validated **before** node-pty spawns the shell.
- File API rejects any path that resolves outside `/home/void` — `..`
  traversal and absolute paths to `/etc`, `/root`, etc. all return 400.
- File API is **read-only**. Use the terminal for any mutations.
- The systemd unit runs as the `void` user (not root). The PTY
  inherits that uid. To run privileged commands inside a session, use
  `sudo` from the terminal as you normally would.
- `ProtectHome=read-only` + `ReadWritePaths=/home/void` keep the
  Node process from accidentally clobbering other users' files.
