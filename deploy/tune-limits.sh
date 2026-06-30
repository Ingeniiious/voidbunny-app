#!/usr/bin/env bash
# Detect host specs and generate a systemd resource-limit drop-in
# so panel + its tmux/claude/MCP children can't pin the box on cold start.
#
# Run once at install, and again any time the hardware changes. Requires sudo
# unless invoked as root. Pass --dry-run to print the file without writing.
#
# Profiles:
#   x86_64-server   : standard server/VPS (Intel, AMD)        - CPU factor 50%
#   aarch64-server  : ARM server/VPS (Graviton, Ampere, etc.) - CPU factor 50%
#   aarch64-sbc     : Raspberry Pi / Jetson / Rock / similar  - CPU factor 35%,
#                     extra RAM headroom, lower TasksMax, smaller fork bombs.
#   generic         : any other arch (armv7, riscv64, etc.)   - CPU factor 40%
#
# Policy:
#   CPUQuota   ~ (factor × cores)%, floor 75% (1-core), ceiling (cores-1)×100%
#                so the host always keeps at least one core for other services.
#   CPUWeight  = 50 (default 100) — panel yields to other services under load.
#   MemoryMax  ~ 50% of RAM, leaving RESERVED MB for the OS. Skipped on hosts
#                where any cap would OOM-kill panel itself.
#   MemoryHigh = 75% of MemoryMax — soft throttle before the hard ceiling.
#   TasksMax   = 512 normally, 256 on SBCs (Pi-class boxes fork-bomb easily).
#   IOWeight   = 50 — only effective on SBC profile (SD-card / eMMC bottleneck).
#
# Overrides (export before running, or pass on the command line):
#   PANEL_PROFILE=x86_64-server|aarch64-server|aarch64-sbc|generic
#   PANEL_CPU_QUOTA=300%
#   PANEL_CPU_WEIGHT=50
#   PANEL_MEMORY_MAX=4G
#   PANEL_MEMORY_HIGH=3G
#   PANEL_TASKS_MAX=512
#   PANEL_IO_WEIGHT=50
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# --- Detection -----------------------------------------------------------------
ARCH="$(uname -m)"
CORES=$(nproc)
MEM_KB=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
MEM_MB=$(( MEM_KB / 1024 ))
MEM_GB=$(( MEM_MB / 1024 ))
VIRT="$(systemd-detect-virt 2>/dev/null || echo unknown)"

detect_sbc() {
  # Common SBC fingerprints. Order matters; we stop at the first hit.
  local model=""
  if [ -r /sys/firmware/devicetree/base/model ]; then
    model="$(tr -d '\0' < /sys/firmware/devicetree/base/model 2>/dev/null || true)"
  fi
  if [ -z "$model" ] && [ -r /proc/device-tree/model ]; then
    model="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)"
  fi
  if [ -n "$model" ]; then
    case "$model" in
      *Raspberry*|*"Rock "*|*"Orange Pi"*|*Jetson*|*BananaPi*|*ODROID*|*Khadas*|*Pine*)
        echo "$model"; return 0 ;;
    esac
  fi
  # Fallback: low-clock Cortex-A on tiny RAM is almost certainly an SBC.
  if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "armv7l" ]; then
    if [ "$MEM_GB" -le 8 ] && grep -qiE 'cortex-a(53|55|72|76)' /proc/cpuinfo 2>/dev/null; then
      echo "${ARCH} SBC (Cortex-A class, ${MEM_MB} MB RAM)"; return 0
    fi
  fi
  return 1
}

if [ -n "${PANEL_PROFILE:-}" ]; then
  PROFILE="$PANEL_PROFILE"
  SBC_MODEL=""
else
  if SBC_MODEL=$(detect_sbc); then
    PROFILE="aarch64-sbc"
  else
    case "$ARCH" in
      x86_64|amd64) PROFILE="x86_64-server" ;;
      aarch64|arm64) PROFILE="aarch64-server" ;;
      *)            PROFILE="generic" ;;
    esac
    SBC_MODEL=""
  fi
fi

case "$PROFILE" in
  x86_64-server)    CPU_FACTOR=50; RESERVED_MB=1024; TASKS_DEFAULT=512; IOW=""   ;;
  aarch64-server)   CPU_FACTOR=50; RESERVED_MB=1024; TASKS_DEFAULT=512; IOW=""   ;;
  aarch64-sbc)      CPU_FACTOR=35; RESERVED_MB=512;  TASKS_DEFAULT=256; IOW="50" ;;
  generic|*)        CPU_FACTOR=40; RESERVED_MB=1024; TASKS_DEFAULT=384; IOW=""   ;;
esac

# --- CPU quota -----------------------------------------------------------------
if [ "$CORES" -le 1 ]; then
  CPU_QUOTA_DEFAULT="75%"
elif [ "$CORES" -le 2 ]; then
  # 2-core hosts: factor would underutilize; lift to 100% for x86/ARM server,
  # 75% for SBCs where we really do want headroom.
  if [ "$PROFILE" = "aarch64-sbc" ]; then
    CPU_QUOTA_DEFAULT="75%"
  else
    CPU_QUOTA_DEFAULT="100%"
  fi
else
  PCT=$(( CORES * CPU_FACTOR ))
  CEIL=$(( (CORES - 1) * 100 ))
  [ "$PCT" -gt "$CEIL" ] && PCT=$CEIL
  CPU_QUOTA_DEFAULT="${PCT}%"
fi

# --- Memory caps ---------------------------------------------------------------
MIN_RAM_FOR_CAP=2
[ "$PROFILE" = "aarch64-sbc" ] && MIN_RAM_FOR_CAP=1   # cap aggressively on SBCs

if [ "$MEM_GB" -lt "$MIN_RAM_FOR_CAP" ]; then
  MEM_MAX_DEFAULT=""
  MEM_HIGH_DEFAULT=""
else
  HALF=$(( MEM_MB / 2 ))
  RESERVED=$(( MEM_MB - RESERVED_MB ))
  CAP=$HALF
  [ "$CAP" -gt "$RESERVED" ] && CAP=$RESERVED
  [ "$CAP" -lt 512 ] && CAP=512
  MEM_MAX_DEFAULT="${CAP}M"
  HIGH=$(( CAP * 3 / 4 ))
  MEM_HIGH_DEFAULT="${HIGH}M"
fi

CPU_QUOTA="${PANEL_CPU_QUOTA:-$CPU_QUOTA_DEFAULT}"
CPU_WEIGHT="${PANEL_CPU_WEIGHT:-50}"
MEM_MAX="${PANEL_MEMORY_MAX:-$MEM_MAX_DEFAULT}"
MEM_HIGH="${PANEL_MEMORY_HIGH:-$MEM_HIGH_DEFAULT}"
TASKS_MAX="${PANEL_TASKS_MAX:-$TASKS_DEFAULT}"
IO_WEIGHT="${PANEL_IO_WEIGHT:-$IOW}"

SERVICE_NAME="${SERVICE_NAME:-panel}"
case "$SERVICE_NAME" in
  *.service) SERVICE_UNIT="$SERVICE_NAME" ;;
  *) SERVICE_UNIT="$SERVICE_NAME.service" ;;
esac
DROPIN_DIR="/etc/systemd/system/$SERVICE_UNIT.d"
DROPIN_FILE="$DROPIN_DIR/limits.conf"

echo "Detected:"
echo "  arch       = $ARCH"
echo "  cores      = $CORES"
echo "  memory     = ${MEM_MB} MB"
echo "  virt       = $VIRT"
[ -n "$SBC_MODEL" ] && echo "  sbc        = $SBC_MODEL"
echo "  profile    = $PROFILE"
echo
echo "Applying:"
echo "  CPUQuota=$CPU_QUOTA"
echo "  CPUWeight=$CPU_WEIGHT"
[ -n "$MEM_MAX"   ] && echo "  MemoryMax=$MEM_MAX"
[ -n "$MEM_HIGH"  ] && echo "  MemoryHigh=$MEM_HIGH"
echo "  TasksMax=$TASKS_MAX"
[ -n "$IO_WEIGHT" ] && echo "  IOWeight=$IO_WEIGHT"
echo

TMP=$(mktemp)
{
  echo "# Generated by deploy/tune-limits.sh on $(date -u +%FT%TZ)"
  echo "# Host: arch=$ARCH cores=$CORES memory=${MEM_MB}MB virt=$VIRT"
  [ -n "$SBC_MODEL" ] && echo "# SBC:  $SBC_MODEL"
  echo "# Profile: $PROFILE"
  echo "# Re-run tune-limits.sh after migrating hardware to regenerate."
  echo "[Service]"
  echo "CPUQuota=$CPU_QUOTA"
  echo "CPUWeight=$CPU_WEIGHT"
  [ -n "$MEM_MAX"   ] && echo "MemoryMax=$MEM_MAX"
  [ -n "$MEM_HIGH"  ] && echo "MemoryHigh=$MEM_HIGH"
  echo "TasksMax=$TASKS_MAX"
  [ -n "$IO_WEIGHT" ] && echo "IOWeight=$IO_WEIGHT"
} > "$TMP"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "--- $DROPIN_FILE (dry-run) ---"
  cat "$TMP"
  rm -f "$TMP"
  exit 0
fi

if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  install -d -m 0755 "$DROPIN_DIR"
  install -m 0644 "$TMP" "$DROPIN_FILE"
  systemctl daemon-reload
else
  sudo install -d -m 0755 "$DROPIN_DIR"
  sudo install -m 0644 "$TMP" "$DROPIN_FILE"
  sudo systemctl daemon-reload
fi
rm -f "$TMP"

echo "Wrote $DROPIN_FILE and reloaded systemd."
echo "Apply with: sudo systemctl restart $SERVICE_UNIT"
