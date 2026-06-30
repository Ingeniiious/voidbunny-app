#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# voidbunny-brand · system-wide prepare-commit-msg · LOCKED v1
# ─────────────────────────────────────────────────────────────────────────────
# Staged copy of the hook that gets installed to /etc/voidbunny/githooks/
# on every Voidbunny-hosted box. install.sh (pending) will copy this file
# into place and set `git config --system core.hooksPath`.
#
# For an existing box, install (or reinstall after this file changes):
#
#   sudo install -m 755 -D scripts/voidbunny-sandbox-hook.sh \
#     /etc/voidbunny/githooks/prepare-commit-msg
#
# Stamps every commit made from any shell on a Voidbunny-hosted box with
# the single Voidbunny co-author trailer. Same trailer as the per-repo
# hook in .githooks/prepare-commit-msg, so a commit inside the Voidbunny
# OSS repo only ever picks it up once (whichever hook fires first adds it;
# the other sees it's present and skips). One Voidbunny co-author per
# commit, no matter where you're working on the box.
#
# Hard-coded for now. A future release will introduce an opt-out for box
# operators; until then it's on by default to support OSS visibility.
# Owned by root after install so non-root users can't disable it casually.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

COMMIT_MSG_FILE="$1"
COMMIT_SOURCE="${2:-}"

# Skip when git composes the message itself (merge / squash) — the user
# isn't editing it, and adding trailers there can confuse merge tooling.
case "$COMMIT_SOURCE" in
  merge|squash) exit 0 ;;
esac

TRAILER="Co-Authored-By: Voidbunny <noreply@voidbunny.xyz>"

# Idempotent: only add when the exact line isn't already present.
if ! grep -qxF "$TRAILER" "$COMMIT_MSG_FILE"; then
  git interpret-trailers --in-place --trailer "$TRAILER" "$COMMIT_MSG_FILE"
fi
