import {
  tmux,
  readProcs,
  findCliInTree,
  SESSION_PREFIX,
} from './sessions.js';
import { sendPush } from './push.js';
import {
  upsertSession,
  getOpenRun,
  openRun,
  closeRun,
  addBusyMs,
  bumpTurns,
  logEvent,
  closeStaleRuns,
  getRepo,
} from './db.js';
import { enrichRepo } from './repoEnrich.js';

// Polls the tmux pane of every panel session at POLL_MS and pushes a
// notification on state transitions. Three phases per session:
//
//   busy    — the CLI is mid-turn (its "esc to interrupt" hint is visible)
//   waiting — the CLI is paused on a yes/no prompt that needs the user
//   idle    — neither of the above (between turns, or session just opened)
//
// Detection is buffer-scan only. None of the supported CLIs emit structured
// events we can subscribe to, and a per-CLI hook system would only cover
// Claude. The marker table below is the single place that needs editing when
// a CLI's prompt copy changes.

const POLL_MS = 750;
const IDLE_AFTER_MS = 1000;

// Per-CLI label used in notification titles ("✓ Claude finished", etc.).
const CLI_LABEL = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  cursor: 'Cursor',
  grok: 'Grok',
};

// Markers we scan the pane buffer for. `busy` is a single regex; `waiting`
// is an array because each CLI shows several different yes/no prompts and
// we want any of them to count. Codex/Cursor/Grok `waiting` patterns are
// first-pass guesses — easy to tune later by inspecting an actual buffer.
const CLI_MARKERS = {
  claude: {
    // Claude renders a spinner row like "✻ Synthesizing… (4m 52s · …)" or
    // "✶ Adding listing column… (24m 25s · …)" while generating. The ellipsis
    // can come several words after the gerund (e.g. "Extending notices
    // backend + attachment upload…", "Beboppin'…"), so matching gerund-
    // immediately-followed-by-ellipsis misses most frames. The reliable
    // signal is the ellipsis followed by the timer in parens: "(9m 39s" or
    // "(37s" — that combination only appears on the active spinner row.
    // Idle/finished rows are past tense without an ellipsis ("Worked for
    // 20m 28s"). Plan-mode's status row has an ellipsis but no timer
    // ("plan mode on … · esc to interrupt"). Tool-result summaries like
    // "Searching for 2 patterns… (ctrl+o to expand)" don't start the
    // parenthetical with a digit. None of those match.
    busy: /…\s*\(\d+[ms]/,
    waiting: [
      /Do you want to proceed\?/i,
      /Do you want to make this edit/i,
      /Do you want to create/i,
      /Ready to code\?/i,
      /Would you like to/i,
      /\bauto-accept edits\b/i,
      // "Interview" prompts — multi-option (AskUserQuestion) and single-option
      // pickers. Without these, the push notification never fires while
      // Claude is blocked waiting on the user to pick. Hint strings are exact
      // copy from the CLI binary so over-matching is unlikely.
      /Space to toggle.*Enter to confirm/i,
      /Tab\/Arrow keys to navigate/i,
      /\bEnter to select\b/i,
    ],
  },
  codex: {
    busy: /esc to interrupt/i,
    waiting: [
      /\bpress\s+enter\s+to\s+(confirm|continue|apply)/i,
      /\(y\/n\)/i,
    ],
  },
  gemini: {
    busy: /\(esc to cancel,\s*\d/i,
    waiting: [
      /\bApply\s+changes\?/i,
      /\(y\/n\)/i,
    ],
  },
  cursor: {
    busy: /esc to interrupt/i,
    waiting: [/\(y\/n\)/i],
  },
  grok: {
    busy: /esc to interrupt/i,
    waiting: [/\(y\/n\)/i],
  },
};

// sid -> { phase, cli, cwd, name, lastBusy, busyStartedAt, seeded, lastNotif,
//          runId }
//   phase:         'busy' | 'waiting' | 'idle' — last confirmed phase
//   lastBusy:      ms timestamp of the most recent "busy seen" sample, used
//                  to debounce a busy→idle flip across a single missed scan
//   busyStartedAt: ms timestamp of the start of the current busy stretch,
//                  used to compute the duration shown in the "finished" push
//   seeded:        false until the first post-startup sample establishes a
//                  baseline — suppresses a spurious push for a session that
//                  was already mid-turn or already waiting when the panel
//                  started up
//   lastNotif:     tag of the most recent push for this session, used to
//                  avoid resending the same notification on every poll while
//                  the same prompt is still on screen
//   runId:         row id in activity DB's cli_runs table for the currently
//                  open (sid, cli, cwd) interval. Null when no run is open.
const state = new Map();

// On panel start, close any cli_runs left dangling from the previous run so
// fresh busy_ms doesn't get added to a stale interval.
closeStaleRuns(Date.now());

function basename(p) {
  if (!p || typeof p !== 'string') return null;
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1) || null;
}

async function listAgentSessions() {
  let stdout = '';
  try {
    const r = await tmux([
      'list-sessions',
      '-F',
      '#{session_name}|#{pane_pid}|#{pane_current_path}',
    ]);
    stdout = r.stdout;
  } catch {
    return [];
  }
  const rows = stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|');
      const [id, pid] = parts;
      const cwd = parts.slice(2).join('|') || null;
      return { id, panePid: Number(pid) || 0, cwd };
    })
    .filter((s) => s.id.startsWith(SESSION_PREFIX));
  if (rows.length === 0) return [];
  const procs = await readProcs();
  if (!procs) return [];
  return rows
    .map((s) => ({ ...s, cli: s.panePid ? findCliInTree(procs, s.panePid) : null }))
    .filter((s) => s.cli);
}

// Scan only the bottom slice of the buffer for `waiting` markers. Prompts
// scroll off as soon as the user answers, so anything further up is stale.
const WAITING_TAIL_LINES = 20;

function detectPhase(buf, cli) {
  const markers = CLI_MARKERS[cli];
  if (!markers) return 'idle';

  if (markers.busy.test(buf)) return 'busy';

  // Slice the last ~20 lines for waiting-prompt detection. The 50-line
  // capture upstream gives us enough headroom; we just want to ignore the
  // top of that window so an already-answered prompt doesn't keep firing.
  const lines = buf.split('\n');
  const tail = lines.slice(-WAITING_TAIL_LINES).join('\n');
  for (const re of markers.waiting) {
    if (re.test(tail)) return 'waiting';
  }
  return 'idle';
}

async function capturePhase(sid, cli) {
  try {
    // -S -50 grabs the last 50 lines of history + visible viewport. Wide
    // enough that a busy hint anywhere on the agent's status row is caught
    // even when the terminal is taller than the default 24 rows.
    const { stdout } = await tmux(['capture-pane', '-p', '-S', '-50', '-t', sid]);
    return detectPhase(stdout, cli);
  } catch {
    return 'idle';
  }
}

// Pure builder — given the event kind and session metadata, return the push
// payload. Same shape the service worker expects (title/body/url/tag,
// optional requireInteraction).
function buildNotification({ kind, cli, name, durationSec, sid }) {
  const label = CLI_LABEL[cli] || cli || 'CLI';
  const where = name || 'session';
  switch (kind) {
    case 'finished': {
      const dur = durationSec >= 60
        ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
        : durationSec > 0
          ? `${durationSec}s`
          : '';
      return {
        title: `✓ ${label} finished`,
        body: dur ? `${where} · ${dur}` : where,
        url: '/',
        tag: `done-${sid}`,
      };
    }
    case 'waiting':
      return {
        title: `${label} needs your input`,
        body: `${where} is waiting`,
        url: '/',
        tag: `wait-${sid}`,
        // Keep the notification on screen until the user dismisses it —
        // the whole point of a "waiting" alert is that work is parked.
        requireInteraction: true,
      };
    default:
      return null;
  }
}

function fire(kind, prev, sid, now) {
  const payload = buildNotification({
    kind,
    cli: prev.cli,
    name: prev.name,
    sid,
    durationSec: prev.busyStartedAt
      ? Math.round((now - prev.busyStartedAt) / 1000)
      : 0,
  });
  if (!payload) return;
  // Suppress immediate dupes for the same session+kind. Tag differs by
  // kind already, so a transition from waiting→finished still pushes; only
  // a poll-cycle repeat of the same tag is squashed.
  if (prev.lastNotif === payload.tag) return;
  prev.lastNotif = payload.tag;
  sendPush(payload).catch((err) => console.warn('[busy] push failed:', err?.message));
}

async function tick() {
  let agentSessions;
  try {
    agentSessions = await listAgentSessions();
  } catch {
    return;
  }
  const alive = new Set(agentSessions.map((s) => s.id));

  // Drop state for sessions that no longer exist or no longer run an agent.
  // We treat that as "the session went away," NOT as a phase transition,
  // so we never push for it. We do persist a "cli_end" + close the run
  // though so the dashboard's interval data is complete.
  const goneNow = Date.now();
  for (const sid of [...state.keys()]) {
    if (!alive.has(sid)) {
      const prev = state.get(sid);
      if (prev?.runId) {
        if (prev.phase === 'busy' && prev.busyStartedAt) {
          const busyMs = goneNow - prev.busyStartedAt;
          if (busyMs > 0) addBusyMs(prev.runId, busyMs);
        }
        closeRun(prev.runId, goneNow);
        logEvent(goneNow, 'cli_end', sid, prev.cli, prev.cwd);
      }
      state.delete(sid);
    }
  }

  const now = Date.now();
  await Promise.all(agentSessions.map(async (s) => {
    const observed = await capturePhase(s.id, s.cli);
    let prev = state.get(s.id);
    const name = basename(s.cwd);

    if (!prev) {
      // First sight of this session — seed without firing. Whatever phase
      // we observe right now becomes the baseline.
      upsertSession(s.id, s.cwd, s.cli, name, now);
      const runId = openRun(s.id, s.cli, s.cwd, now);
      logEvent(now, 'cli_start', s.id, s.cli, s.cwd);
      if (s.cwd && !getRepo(s.cwd)) {
        enrichRepo(s.cwd).catch(() => { /* logged inside enrichRepo */ });
      }
      state.set(s.id, {
        phase: observed,
        cli: s.cli,
        cwd: s.cwd,
        name,
        lastBusy: observed === 'busy' ? now : 0,
        busyStartedAt: observed === 'busy' ? now : 0,
        seeded: false,
        lastNotif: null,
        runId,
      });
      return;
    }

    if (observed === 'busy') prev.lastBusy = now;

    // If the CLI swapped (user closed claude and ran codex in the same pane)
    // or the cwd changed (user cd'd elsewhere), close the prior run and
    // open a new one — each interval represents a single (cli, cwd) pair.
    if (prev.cli !== s.cli || prev.cwd !== s.cwd) {
      closeRun(prev.runId, now);
      logEvent(now, 'cli_end', s.id, prev.cli, prev.cwd);
      prev.runId = openRun(s.id, s.cli, s.cwd, now);
      logEvent(now, 'cli_start', s.id, s.cli, s.cwd);
      if (s.cwd && !getRepo(s.cwd)) {
        enrichRepo(s.cwd).catch(() => { /* logged inside enrichRepo */ });
      }
    }
    prev.cli = s.cli;
    prev.cwd = s.cwd;
    prev.name = name;
    upsertSession(s.id, s.cwd, s.cli, name, now);

    // Debounce busy→non-busy across a single missed scan: if we *just* saw
    // busy <IDLE_AFTER_MS ago, keep treating this as busy. Without this
    // the regex flickers off for a frame mid-stream and we'd over-fire.
    let phase = observed;
    if (phase !== 'busy' && now - prev.lastBusy < IDLE_AFTER_MS) {
      phase = 'busy';
    }

    if (!prev.seeded) {
      prev.seeded = true;
      prev.phase = phase;
      if (phase === 'busy') prev.busyStartedAt = now;
      return;
    }

    if (phase === prev.phase) return;

    // Phase transition — decide whether to push.
    const from = prev.phase;
    prev.phase = phase;

    if (phase === 'busy') {
      // Entered busy from idle or from waiting (user answered the prompt).
      // No push: work is back in flight, nothing for the user to do.
      prev.busyStartedAt = now;
      logEvent(now, 'busy_start', s.id, prev.cli, prev.cwd);
      return;
    }

    if (phase === 'waiting') {
      // Reached a yes/no prompt — alert regardless of where we came from.
      logEvent(now, 'waiting', s.id, prev.cli, prev.cwd);
      fire('waiting', prev, s.id, now);
      return;
    }

    // phase === 'idle'
    if (from === 'busy') {
      // Real "task finished" transition. Only push here — a waiting→idle
      // flip (user typed past the prompt or closed it) is intentionally
      // silent, since it doesn't represent completed work.
      const busyMs = prev.busyStartedAt ? now - prev.busyStartedAt : 0;
      if (busyMs > 0) addBusyMs(prev.runId, busyMs);
      bumpTurns(prev.runId);
      logEvent(now, 'busy_end', s.id, prev.cli, prev.cwd);
      fire('finished', prev, s.id, now);
    }
  }));
}

let timer = null;
export function startBusyPoller() {
  if (timer) return;
  const run = () => {
    tick().catch((err) => console.warn('[busy] tick failed:', err?.message));
  };
  timer = setInterval(run, POLL_MS);
  timer.unref?.();
  // Kick a first tick immediately so the seed scan happens at startup
  // instead of POLL_MS later — minimises the window where a session that
  // was already running an agent might be misclassified.
  run();
}
