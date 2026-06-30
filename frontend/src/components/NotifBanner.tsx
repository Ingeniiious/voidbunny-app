import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { getPushState, type PushState } from '../lib/push';

// localStorage key for dismissal. Cleared automatically once notifications
// flip on, so the banner doesn't reappear silently if the user re-disables
// without coming back through Settings — they'd see the warning again.
const DISMISSED_KEY = 'panel.notifBanner.dismissed';

// Remix Icon — notification-off-line. Inline so we don't pull a whole icon
// package for one glyph; matches the convention used in KeyBar.tsx.
function BellOffIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M20 17h2v2H7.343l1.99-1.99L20 17zM8.991 6.165A6.99 6.99 0 0 1 12 5a7 7 0 0 1 7 7v3.343L5.343 1.686 6.757.272 22.728 16.243l-1.414 1.414-2.318-2.318C19 15.34 19 15 19 15v-3a7 7 0 0 0-13.434-2.81L8.991 6.165zM4 17v-5a8 8 0 0 1 .362-2.392L4 9.243l1.414-1.415L4 6.414 5.414 5l16.97 16.97L20.97 23.385 17.585 20H10v-1a2 2 0 0 1-4 0v-2H4z" />
    </svg>
  );
}

// Remix Icon — close-line.
function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M12 10.586l4.95-4.95 1.414 1.414L13.414 12l4.95 4.95-1.414 1.414L12 13.414l-4.95 4.95-1.414-1.414L10.586 12l-4.95-4.95L7.05 5.636 12 10.586z" />
    </svg>
  );
}

interface Props {
  onOpenSettings: () => void;
}

// Passive system-status banner that surfaces when the PWA can't deliver push
// notifications. Sits at the top below the header so it doesn't collide with
// KeyBar / iOS home indicator, and uses the panel's `--panel-attention`
// token so light and dark modes stay legible without per-theme overrides.
export default function NotifBanner({ onOpenSettings }: Props) {
  const reduceMotion = useReducedMotion();
  const [state, setState] = useState<PushState | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(DISMISSED_KEY) === '1';
  });

  // PushManager.getSubscription doesn't emit events; same refresh strategy as
  // SettingsDialog so coming back from iOS Settings clears the banner.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await getPushState();
        if (!cancelled) setState(s);
      } catch { /* swallow */ }
    };
    void refresh();
    const onVis = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  // Once notifications are actually on, clear any prior dismissal so the next
  // time they turn off (uninstall PWA, OS reset, etc.) the warning returns
  // rather than staying silent forever.
  useEffect(() => {
    if (state?.subscribed && state.permission === 'granted') {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(DISMISSED_KEY);
    }
  }, [state]);

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof localStorage !== 'undefined') localStorage.setItem(DISMISSED_KEY, '1');
  };

  if (!state) return null;
  if (dismissed) return null;
  if (!state.supported) return null;
  if (state.subscribed && state.permission === 'granted') return null;

  // Tailor the body to the failure mode so the user knows what they need to do.
  let body = 'You won’t get pinged when an agent needs your attention.';
  let cta = 'Open Settings';
  if (state.isIOS && !state.isStandalone) {
    body = 'On iPhone or iPad, tap Share → Add to Home Screen, then open the app from its icon to enable notifications.';
    cta = 'Got it';
  } else if (state.permission === 'denied') {
    body = 'Notifications are blocked. Re-enable them in your browser or OS settings, then come back.';
  }

  // Reduced-motion users get an opacity-only fade. Exit duration is ~60% of
  // enter so dismissal feels responsive (§7 exit-faster-than-enter).
  const anim = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { y: -12, opacity: 0 },
        animate: { y: 0, opacity: 1 },
        exit: { y: -8, opacity: 0 },
      };

  return (
    <AnimatePresence>
      <motion.div
        key="notif-banner"
        {...anim}
        transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
        // Top-anchored: sits below the 3rem header + iOS safe-area inset.
        // pointer-events-none on the wrapper so the empty space around the
        // banner doesn't intercept taps on header / sidebar trigger.
        className="fixed inset-x-0 z-40 px-3 pointer-events-none"
        style={{ top: 'calc(3rem + env(safe-area-inset-top) + 0.5rem)' }}
        role="status"
        aria-live="polite"
      >
        <div
          className="mx-auto w-full max-w-md pointer-events-auto rounded-xl border bg-panel-surface/95 backdrop-blur-md shadow-lg"
          style={{
            // Use the panel's attention token so contrast adapts with the
            // theme (mustard in light, yellow in dark) — no hardcoded yellow.
            borderColor: 'rgb(var(--panel-attention) / 0.45)',
            // Subtle wash on top of the surface so the banner reads as
            // "system status" without overpowering panel content underneath.
            boxShadow: '0 8px 24px -8px rgb(var(--panel-attention) / 0.18)',
          }}
        >
          <div className="flex items-start gap-3 p-3.5 sm:p-4">
            <div
              className="flex-shrink-0 flex items-center justify-center rounded-lg"
              style={{
                width: 36,
                height: 36,
                backgroundColor: 'rgb(var(--panel-attention) / 0.14)',
                color: 'rgb(var(--panel-attention))',
              }}
              aria-hidden
            >
              <BellOffIcon className="w-[18px] h-[18px]" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-wider text-panel-muted">
                Needs attention
              </div>
              <div className="mt-0.5 text-sm font-medium text-panel-text leading-snug">
                Notifications are off
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-panel-muted">
                {body}
              </p>
              <button
                type="button"
                onClick={onOpenSettings}
                // 44pt-tall (h-11) tappable target with semantic attention
                // colouring. Mono type ties the button to the rest of the
                // panel's terminal aesthetic.
                className="mt-3 inline-flex items-center justify-center h-11 px-4 rounded-lg text-sm font-mono font-medium transition-colors"
                style={{
                  backgroundColor: 'rgb(var(--panel-attention) / 0.16)',
                  color: 'rgb(var(--panel-attention))',
                  border: '1px solid rgb(var(--panel-attention) / 0.4)',
                }}
                onPointerDown={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgb(var(--panel-attention) / 0.26)';
                }}
                onPointerUp={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgb(var(--panel-attention) / 0.16)';
                }}
                onPointerLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgb(var(--panel-attention) / 0.16)';
                }}
              >
                {cta}
              </button>
            </div>

            {/* Single dismiss affordance (§4 primary-action). 44×44 hit area
                with a smaller visual glyph — the padding gives the touch
                target while the icon itself stays visually subordinate to
                the primary CTA. */}
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss notifications warning"
              className="flex-shrink-0 flex items-center justify-center w-11 h-11 -mr-1.5 -mt-1.5 rounded-lg text-panel-muted hover:text-panel-text hover:bg-panel-bg/60 transition-colors"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
