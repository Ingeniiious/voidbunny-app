#!/usr/bin/env bash
#
# One-shot host setup for the panel's native voice bridge.
#
# Creates a virtual microphone (snd-aloop kernel module) and wires it as the
# system's default audio capture device, so Claude Code's built-in `/voice`
# (which calls `rec` / `arecord` on the default mic) can hear audio that the
# panel's WS bridge writes via `aplay`.
#
# Run this once on a fresh server before using the panel's "Native" voice
# mode. Idempotent — safe to re-run after kernel upgrades or fresh boots.
#
# Usage:   sudo deploy/setup-voice-bridge.sh
# Re-run:  sudo deploy/setup-voice-bridge.sh
#
# After running, restart the panel so the systemd unit picks up the audio
# group membership:
#   sudo systemctl daemon-reload
#   sudo systemctl restart panel

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "This script needs root (it apt-installs packages and modprobes a module)." >&2
  echo "Re-run with: sudo $0" >&2
  exit 1
fi

PANEL_USER="${SUDO_USER:-void}"
PANEL_HOME="$(getent passwd "$PANEL_USER" | cut -d: -f6)"
if [[ -z "$PANEL_HOME" || ! -d "$PANEL_HOME" ]]; then
  echo "Could not resolve home directory for user '$PANEL_USER'." >&2
  exit 1
fi

echo "==> [1/5] Installing audio toolchain (sox, alsa-utils)…"
apt-get update -y -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sox alsa-utils

echo "==> [2/5] Loading snd-aloop kernel module…"
if ! lsmod | grep -q '^snd_aloop'; then
  modprobe snd-aloop
fi
# Persist across reboots — Ubuntu reads /etc/modules-load.d/*.conf on boot.
echo "snd-aloop" > /etc/modules-load.d/snd-aloop.conf

echo "==> [3/5] Adding user '$PANEL_USER' to the 'audio' group…"
if ! id -nG "$PANEL_USER" | tr ' ' '\n' | grep -qx audio; then
  usermod -aG audio "$PANEL_USER"
fi

echo "==> [4/5] Writing $PANEL_HOME/.asoundrc (loopback default)…"
# `asym` lets capture and playback resolve to different PCMs. Capture default
# = loopback subdevice (1,0), the *read* side of the virtual cable. Playback
# default = loopback subdevice (0,0), the *write* side. The panel's `aplay`
# writes into Loopback,0,0; the Claude CLI's `rec`/`arecord` reads from
# Loopback,1,0 via this default.
cat > "$PANEL_HOME/.asoundrc" <<'ASOUNDRC'
pcm.!default {
  type asym
  playback.pcm "loopback_out"
  capture.pcm  "loopback_in"
}
pcm.loopback_out { type plug; slave.pcm "hw:Loopback,0,0" }
pcm.loopback_in  { type plug; slave.pcm "hw:Loopback,1,0" }
ctl.!default     { type hw;   card Loopback }
ASOUNDRC
chown "$PANEL_USER:$PANEL_USER" "$PANEL_HOME/.asoundrc"
chmod 644 "$PANEL_HOME/.asoundrc"

echo "==> [5/5] Sanity check (listing loopback devices visible to ALSA)…"
if command -v arecord >/dev/null; then
  if arecord -L 2>/dev/null | grep -qi 'loopback'; then
    echo "    ALSA reports a Loopback device — good."
  else
    echo "    WARNING: ALSA does not see a Loopback device yet. Try rebooting,"
    echo "             or check 'cat /proc/asound/cards' for the Loopback entry." >&2
  fi
fi

cat <<MSG

Done.

Next steps:
  1. Restart the panel so it picks up the new audio group membership:
       sudo systemctl daemon-reload
       sudo systemctl restart panel

  2. In the panel UI, switch the Voice mode to "Native" (sidebar → Voice).

  3. Open https://<your-panel-host>/ on your phone, tap the violet "Live"
     button, grant mic permission, and leave that tab in the foreground.

  4. On the server, run \`claude\` in a terminal tab and type \`/voice\`.
     Speak into your phone — transcripts should appear in the CLI in real time.

If \`/voice\` errors out with "cannot open device":
  - Confirm snd-aloop is loaded:    lsmod | grep snd_aloop
  - Confirm ~/.asoundrc is correct: arecord -L | grep -i loopback
  - Confirm the panel service has 'audio' in its supplementary groups:
      systemctl show panel -p SupplementaryGroups
MSG
