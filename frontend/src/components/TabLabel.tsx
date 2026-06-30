import { useEffect, useState } from 'react';

// Which agent CLI is running inside this tab. Drives the "working" color so
// the user can tell at a glance which assistant is busy.
export type WorkingCli = 'claude' | 'gemini' | 'codex' | 'cursor' | 'grok';

const CLI_COLOR: Record<WorkingCli, string> = {
  claude: 'rgb(var(--cli-claude))',
  gemini: 'rgb(var(--cli-gemini))',
  codex: 'rgb(var(--cli-codex))',
  cursor: 'rgb(var(--cli-cursor))',
  grok: 'rgb(var(--cli-grok))',
};

// Warm amber for the "needs you" state — same hue across themes since it's a
// signal (read like a turn indicator), not a brand colour.
const ATTENTION_COLOR = 'rgb(var(--panel-attention))';

interface Props {
  name: string;
  working: boolean;
  attention?: boolean;
  unseen: boolean;
  cli?: WorkingCli;
}

// Tab title with state-aware micro-animations:
//   working=true   → crossfade between the cwd name and a "working" indicator
//                    every ~1.8s. Conveys "Claude Code is busy" without losing
//                    the tab's identity.
//   attention=true → same crossfade but in amber with a "needs you" label.
//                    Fires when the CLI is paused on a yes/no prompt that
//                    needs the user (matches the backend's `waiting` phase
//                    in busy.js — same regexes power the push notification).
//   unseen=true    → slow horizontal shimmer over the name. Fires only when a
//                    run *completed* while the user was looking at another
//                    tab — it's the "yo, check this out" cue.
//   none           → plain name.
// Precedence: working > attention > unseen. (`working` and `attention` are
// mutually exclusive by construction — the CLI is either streaming a turn or
// waiting on input, never both — but we still gate explicitly in case the two
// scanners disagree for a frame.)
export default function TabLabel({ name, working, attention, unseen, cli }: Props) {
  // `phase` flips every 1.8s while either crossfade is active, driving the
  // animation. On a false → true transition we snap to phase=1 immediately so
  // the indicator crossfades in right when the state engages — without this
  // the first flip waited a full 1.8s, which felt sluggish.
  const animating = working || (!!attention && !working);
  const [phase, setPhase] = useState<0 | 1>(0);

  useEffect(() => {
    if (!animating) {
      setPhase(0);
      return undefined;
    }
    setPhase(1);
    const id = window.setInterval(() => setPhase((p) => (p === 0 ? 1 : 0)), 1800);
    return () => window.clearInterval(id);
  }, [animating]);

  if (!animating) {
    return <span className={unseen ? 'tab-shimmer' : undefined}>{name}</span>;
  }

  // Working wins over attention if both somehow fire for the same frame —
  // the CLI is actively streaming, the prompt is stale.
  const isWorking = working;
  const color = isWorking
    ? (cli ? CLI_COLOR[cli] : 'rgb(var(--panel-muted))')
    : ATTENTION_COLOR;
  const dotColor = isWorking
    ? (cli ? CLI_COLOR[cli] : 'rgb(var(--panel-accent))')
    : ATTENTION_COLOR;
  const label = isWorking ? 'working' : 'needs you';

  // Grid-stack the two labels in the same cell so the container sizes itself
  // to whichever string is wider, and both fade in/out from the same spot —
  // no layout jump as the tab strip swaps between them.
  return (
    <span className="grid">
      <span
        className="row-start-1 col-start-1 transition-opacity duration-500 ease-in-out"
        style={{ opacity: phase === 0 ? 1 : 0 }}
      >
        {name}
      </span>
      <span
        className="row-start-1 col-start-1 transition-opacity duration-500 ease-in-out flex items-center gap-1.5"
        style={{ opacity: phase === 1 ? 1 : 0, color }}
        aria-hidden={phase !== 1}
      >
        <span
          className="tab-pulse inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: dotColor }}
          aria-hidden="true"
        />
        {label}
      </span>
    </span>
  );
}
