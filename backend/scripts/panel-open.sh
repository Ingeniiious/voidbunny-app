#!/bin/sh
# Panel browser-open shim. Spawned by CLIs inside tmux panes as $BROWSER /
# xdg-open / chrome / firefox / etc. — POSTs the URL to the panel backend
# so it can open in the in-app Brave instead of the system browser (the
# panel runs headless).
#
# Auth: per-session token. Looked up in this order:
#   1) $PANEL_SESSION_ID + $PANEL_OPEN_TOKEN env vars (set by tmux at
#      session-create time — fast path for new panes)
#   2) $TMUX_PANE → tmux session_name → /tmp/panel-shim/<sid>/token (fallback
#      for panes whose env was stale because they spawned before the shim
#      was provisioned, e.g. older sessions across a panel restart)
#
# Exit 0 = URL delivered to the panel. Non-zero = caller should fall back to
# its own URL-printing behaviour so the user can still copy-paste manually.
#
# stderr: one line per outcome. The user sees this in their terminal, so the
# message has to be short and informative — "→ opened in panel browser: …"
# beats silence when the OAuth flow takes 30 seconds and the user is staring
# at a frozen-looking shell wondering whether anything happened.

url="$1"

case "$url" in
  http://*|https://*) ;;
  *)
    # Some CLIs (gh, npm-login, etc.) pass --help or a path here when the user
    # mis-invokes the shim. Don't try to "open" those — fall through so the
    # caller can complain instead.
    exit 1
    ;;
esac

: "${PANEL_PORT:=4000}"

sid="$PANEL_SESSION_ID"
token="$PANEL_OPEN_TOKEN"

# Fallback path: figure out the session from $TMUX_PANE and read the token
# file. Useful when an existing shell that predated shim provisioning tries
# to open a URL — it'll still route correctly.
if [ -z "$sid" ] || [ -z "$token" ]; then
  if [ -n "$TMUX_PANE" ] && command -v tmux >/dev/null 2>&1; then
    sid_resolved=$(tmux -L panel display-message -p -t "$TMUX_PANE" '#{session_name}' 2>/dev/null)
    if [ -n "$sid_resolved" ]; then
      sid="$sid_resolved"
      token_file="/tmp/panel-shim/${sid}/token"
      if [ -r "$token_file" ]; then
        token=$(cat "$token_file" 2>/dev/null)
      fi
    fi
  fi
fi

if [ -z "$sid" ] || [ -z "$token" ]; then
  echo "panel-open: no session token — URL not routed: $url" >&2
  exit 1
fi

# JSON-escape the URL minimally — strip CR/LF and escape backslashes + quotes.
esc_url=$(printf '%s' "$url" | tr -d '\r\n' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')

body="{\"sid\":\"$sid\",\"token\":\"$token\",\"url\":\"$esc_url\"}"

if curl --fail --silent --show-error \
     --max-time 5 \
     -H 'Content-Type: application/json' \
     -d "$body" \
     "http://127.0.0.1:${PANEL_PORT}/api/panel-open" >/dev/null 2>&1; then
  # Trim the URL for display so an enormous OAuth state= blob doesn't wrap
  # 40 lines in the user's terminal. Show scheme://host plus the first 60
  # characters of the path — enough for the user to recognise the target.
  short=$(printf '%s' "$url" | sed -E 's#^(https?://[^/]+)(/[^?#]{0,60}).*#\1\2#')
  echo "→ opened in panel browser: $short" >&2
  exit 0
fi

echo "panel-open: backend rejected URL — falling back. $url" >&2
exit 1
