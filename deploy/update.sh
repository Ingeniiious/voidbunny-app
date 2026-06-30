#!/usr/bin/env bash
# Deploy the panel: build frontend, trigger backend restart.
# Called manually (./deploy/update.sh) or by the post-receive hook in
# ~/panel.git/hooks/post-receive when you `git push prod main`.
#
# Backend restart happens via a systemd path unit watching
# $HOME/.panel-redeploy-trigger — so this script never needs
# sudo, and works fine from inside the panel terminal (which inherits
# NoNewPrivileges from panel.service). See SETUP-PUSH-DEPLOY.txt.
set -euo pipefail

# Ensure node/npm are on PATH when invoked from a minimal hook environment.
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
TRIGGER="${PANEL_REDEPLOY_TRIGGER:-$HOME/.panel-redeploy-trigger}"

echo ">>> [1/3] Building frontend"
cd "$ROOT/frontend"
npm ci
npm run build

echo ">>> [2/3] Triggering backend restart"
OLD_START="$(systemctl show panel -p ActiveEnterTimestamp --value || true)"
date +%s%N > "$TRIGGER"

echo ">>> [3/3] Waiting for panel to restart"
for i in 1 2 3 4 5 6 7 8 9 10; do
  NEW_START="$(systemctl show panel -p ActiveEnterTimestamp --value || true)"
  if [ -n "$NEW_START" ] && [ "$NEW_START" != "$OLD_START" ]; then
    echo "Restart confirmed at: $NEW_START"
    break
  fi
  sleep 1
  if [ "$i" = "10" ]; then
    echo "WARNING: panel did not restart within 10s."
    echo "Check that panel-redeploy.path is enabled (see SETUP-PUSH-DEPLOY.txt)."
  fi
done

systemctl status panel --no-pager | head -8

echo ">>> Deploy complete."
