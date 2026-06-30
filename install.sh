#!/usr/bin/env bash
# Voidbunny one-command installer.
#
# Usage:
#   curl -fsSL https://voidbunny.xyz/install.sh | bash
#
# Common overrides:
#   VOIDBUNNY_DOMAIN=app.example.com bash install.sh
#   VOIDBUNNY_DIR=/home/ubuntu/voidbunny-app bash install.sh
#   VOIDBUNNY_INSTALL_CLIS=0 VOIDBUNNY_INSTALL_BROWSER=0 bash install.sh

set -euo pipefail

APP_NAME="Voidbunny"
SERVICE_NAME="${VOIDBUNNY_SERVICE_NAME:-voidbunny}"
REPO_URL="${VOIDBUNNY_REPO_URL:-https://github.com/Ingeniiious/voidbunny-app.git}"
BRANCH="${VOIDBUNNY_BRANCH:-main}"
PORT="${VOIDBUNNY_PORT:-4000}"
DOMAIN="${VOIDBUNNY_DOMAIN:-}"
INSTALL_CLIS="${VOIDBUNNY_INSTALL_CLIS:-1}"
INSTALL_BROWSER="${VOIDBUNNY_INSTALL_BROWSER:-1}"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mERROR\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

if [ "$(uname -s)" != "Linux" ]; then
  die "$APP_NAME installs on Linux hosts with systemd."
fi
if ! have systemctl; then
  die "systemd is required."
fi
if ! have apt-get; then
  die "This installer currently supports Ubuntu/Debian hosts with apt."
fi

if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  SUDO=""
  TARGET_USER="${VOIDBUNNY_USER:-${SUDO_USER:-root}}"
else
  have sudo || die "sudo is required. Re-run as a sudo-capable user."
  sudo -v
  SUDO="sudo"
  TARGET_USER="${VOIDBUNNY_USER:-$(id -un)}"
fi

if [ "$TARGET_USER" = "root" ] && [ -z "${VOIDBUNNY_USER:-}" ]; then
  die "Run as your normal sudo user, not root, or set VOIDBUNNY_USER=<user>."
fi

TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
[ -n "$TARGET_HOME" ] || die "Could not find home directory for $TARGET_USER."
TARGET_GROUP="$(id -gn "$TARGET_USER")"
APP_DIR="${VOIDBUNNY_DIR:-$TARGET_HOME/voidbunny-app}"
UPLOADS_ROOT="${VOIDBUNNY_UPLOADS_ROOT:-$TARGET_HOME/voidbunny-uploads}"

run_as_user() {
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    runuser -u "$TARGET_USER" -- "$@"
  else
    sudo -u "$TARGET_USER" "$@"
  fi
}

install_node() {
  if have node; then
    local major
    major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
    if [ "$major" -ge 20 ]; then
      return
    fi
  fi

  log "Installing Node.js 22"
  $SUDO apt-get update
  $SUDO apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash -
  $SUDO apt-get install -y nodejs
}

install_caddy() {
  if have caddy; then
    return
  fi

  log "Installing Caddy"
  $SUDO apt-get update
  $SUDO apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | $SUDO gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  $SUDO apt-get update
  $SUDO apt-get install -y caddy
}

install_brave() {
  if [ "$INSTALL_BROWSER" != "1" ]; then
    warn "Skipping Brave/Xvfb browser support."
    return
  fi

  log "Installing browser support"
  $SUDO apt-get install -y xvfb x11vnc
  if ! have brave-browser; then
    $SUDO install -d -m 0755 /usr/share/keyrings
    curl -fsSLo /tmp/brave-browser-archive-keyring.gpg \
      https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg
    $SUDO install -m 0644 /tmp/brave-browser-archive-keyring.gpg /usr/share/keyrings/brave-browser-archive-keyring.gpg
    printf '%s\n' \
      "deb [signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg] https://brave-browser-apt-release.s3.brave.com/ stable main" \
      | $SUDO tee /etc/apt/sources.list.d/brave-browser-release.list >/dev/null
    $SUDO apt-get update
    $SUDO apt-get install -y brave-browser
  fi
}

tty_available() {
  [ -r /dev/tty ] && [ -w /dev/tty ]
}

prompt_secret() {
  local prompt="$1"
  local value="${2:-}"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return
  fi
  if tty_available; then
    local first second
    while true; do
      printf '%s: ' "$prompt" >/dev/tty
      IFS= read -r -s first </dev/tty
      printf '\n' >/dev/tty
      printf 'Confirm %s: ' "$prompt" >/dev/tty
      IFS= read -r -s second </dev/tty
      printf '\n' >/dev/tty
      [ -n "$first" ] || { warn "Password cannot be empty."; continue; }
      [ "$first" = "$second" ] || { warn "Passwords did not match."; continue; }
      printf '%s' "$first"
      return
    done
  fi
  openssl rand -base64 18 | tr -d '\n'
}

prompt_text() {
  local prompt="$1"
  local default_value="$2"
  local value="${3:-}"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return
  fi
  if tty_available; then
    printf '%s [%s]: ' "$prompt" "$default_value" >/dev/tty
    IFS= read -r value </dev/tty
    printf '%s' "${value:-$default_value}"
    return
  fi
  printf '%s' "$default_value"
}
write_service() {
  local service_file="/etc/systemd/system/${SERVICE_NAME}.service"
  log "Writing systemd service $SERVICE_NAME"
  $SUDO tee "$service_file" >/dev/null <<EOF
[Unit]
Description=Voidbunny self-hosted coding-agent app
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$TARGET_USER
Group=$TARGET_GROUP
WorkingDirectory=$APP_DIR/backend
Environment=NODE_ENV=production
Environment=PANEL_HOME=$TARGET_HOME
Environment=PANEL_UPLOADS_ROOT=$UPLOADS_ROOT
ExecStart=$(command -v node) --env-file=$APP_DIR/.env $APP_DIR/backend/index.js
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$TARGET_HOME
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now "$SERVICE_NAME"
}

write_caddy() {
  local site_label=":80"
  if [ -n "$DOMAIN" ]; then
    site_label="$DOMAIN"
  else
    warn "VOIDBUNNY_DOMAIN not set; configuring plain HTTP on port 80."
  fi

  log "Configuring Caddy for $site_label"
  local block
  block="$(mktemp)"
  cat >"$block" <<EOF
# BEGIN VOIDBUNNY
$site_label {
    encode zstd gzip
    reverse_proxy 127.0.0.1:$PORT {
        transport http {
            read_timeout 24h
            write_timeout 24h
        }
    }
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "microphone=(self), camera=(self), clipboard-read=(self), clipboard-write=(self), interest-cohort=()"
        -Server
    }
}
# END VOIDBUNNY
EOF

  local current
  current="$(mktemp)"
  if [ -f /etc/caddy/Caddyfile ]; then
    $SUDO awk '
      /^# BEGIN VOIDBUNNY$/ { skip=1; next }
      /^# END VOIDBUNNY$/ { skip=0; next }
      skip != 1 { print }
    ' /etc/caddy/Caddyfile >"$current"
  fi
  cat "$block" >>"$current"
  $SUDO install -m 0644 "$current" /etc/caddy/Caddyfile
  rm -f "$block" "$current"
  $SUDO caddy validate --config /etc/caddy/Caddyfile
  $SUDO systemctl reload caddy
}

install_agent_clis() {
  if [ "$INSTALL_CLIS" != "1" ]; then
    warn "Skipping agent CLI installation."
    return
  fi
  log "Installing Claude Code, Codex, and Gemini CLIs"
  $SUDO npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli
}

log "Installing prerequisites"
$SUDO apt-get update
$SUDO apt-get install -y git curl ca-certificates openssl build-essential python3 make g++ tmux ripgrep
install_node
install_caddy
install_brave

log "Fetching $APP_NAME source"
$SUDO install -d -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0755 "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  run_as_user git -C "$APP_DIR" fetch origin "$BRANCH"
  run_as_user git -C "$APP_DIR" checkout "$BRANCH"
  run_as_user git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  run_as_user git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

log "Installing app dependencies"
run_as_user npm --prefix "$APP_DIR/backend" install --omit=dev
run_as_user npm --prefix "$APP_DIR/frontend" ci
run_as_user npm --prefix "$APP_DIR/frontend" run build

PANEL_USERNAME="$(prompt_text 'Panel username' "${USER:-voidbunny}" "${PANEL_USERNAME:-}")"
AUTO_GENERATED_PASSWORD=0
if [ -z "${PANEL_PASSWORD:-}" ] && ! tty_available; then
  AUTO_GENERATED_PASSWORD=1
fi
PANEL_PASSWORD_PLAIN="$(prompt_secret 'Panel password' "${PANEL_PASSWORD:-}")"
JWT_SECRET="$(openssl rand -hex 48)"
PANEL_PASSWORD_HASH="$(printf '%s' "$PANEL_PASSWORD_PLAIN" | (cd "$APP_DIR/backend" && node -e "const fs=require('fs'); const bcrypt=require('bcryptjs'); const password=fs.readFileSync(0,'utf8'); console.log(bcrypt.hashSync(password,12));"))"

log "Writing app environment"
umask 077
tmp_env="$(mktemp)"
cat >"$tmp_env" <<EOF
JWT_SECRET=$JWT_SECRET
PANEL_USERNAME=$PANEL_USERNAME
PANEL_PASSWORD=$PANEL_PASSWORD_HASH
PORT=$PORT
SHELL=${SHELL:-/bin/bash}
PANEL_HOME=$TARGET_HOME
PANEL_UPLOADS_ROOT=$UPLOADS_ROOT
OPENAI_API_KEY=${OPENAI_API_KEY:-}
EOF
$SUDO install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0600 "$tmp_env" "$APP_DIR/.env"
rm -f "$tmp_env"
$SUDO install -d -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0700 "$UPLOADS_ROOT"

install_agent_clis
write_service
write_caddy

if [ -x "$APP_DIR/deploy/tune-limits.sh" ]; then
  log "Applying systemd resource limits"
  SERVICE_NAME="$SERVICE_NAME" "$APP_DIR/deploy/tune-limits.sh" || warn "Resource limit tuning failed; continuing."
fi

PUBLIC_IP="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
if [ -n "$DOMAIN" ]; then
  URL="https://$DOMAIN"
else
  URL="http://$PUBLIC_IP"
fi

cat <<EOF

$APP_NAME is installed.

URL:      $URL
Username: $PANEL_USERNAME
$(if [ "$AUTO_GENERATED_PASSWORD" = "1" ]; then printf 'Password: %s\n' "$PANEL_PASSWORD_PLAIN"; fi)Service:  sudo systemctl status $SERVICE_NAME
Logs:     sudo journalctl -u $SERVICE_NAME -f

Open a terminal in Voidbunny and run each CLI once to finish OAuth:
  claude
  codex
  gemini

EOF

