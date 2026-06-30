import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup, type TargetAndTransition } from 'motion/react';
import { Tabs } from '@base-ui-components/react/tabs';
import { X, Mic, Check, Bell, BellOff, BellRing, BellPlus } from 'lucide-react';
import { toast } from 'sonner';
import CliLogo from './CliLogo';
import {
  ALL_CLIS,
  MIC_AUTOMATIC,
  getSettings,
  setLaunchers,
  setMicDeviceId,
} from '../lib/settings';
import {
  getPushState,
  subscribeToPush,
  unsubscribeFromPush,
  sendTestPush,
  type PushState,
} from '../lib/push';
import type { CliKind } from '../lib/api';

// Modal chrome mirrors ConfirmDialog (3D blur entry, click-outside-to-close)
// so the panel only has one visual language for dialogs.
const openState: TargetAndTransition = {
  opacity: 1,
  filter: 'blur(0px)',
  rotateX: 0,
  rotateY: 0,
  z: 0,
  transition: {
    delay: 0.15,
    duration: 0.45,
    ease: [0.17, 0.67, 0.51, 1],
    opacity: { delay: 0.15, duration: 0.4, ease: 'easeOut' },
  },
};

const initialState: TargetAndTransition = {
  opacity: 0,
  filter: 'blur(10px)',
  z: -100,
  rotateY: 25,
  rotateX: 5,
  transformPerspective: 500,
  transition: { duration: 0.25, ease: [0.67, 0.17, 0.62, 0.64] },
};

const CLI_LABELS: Record<CliKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  cursor: 'Cursor',
  grok: 'Grok',
};

function useClickOutside(ref: React.RefObject<HTMLDialogElement | null>, close: () => void) {
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      const { top, left, width, height } = el.getBoundingClientRect();
      if (
        event.clientX < left ||
        event.clientX > left + width ||
        event.clientY < top ||
        event.clientY > top + height
      ) {
        close();
      }
    };
    const t = window.setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('click', handler);
    };
  }, [ref, close]);
}

interface Props {
  onClose: () => void;
}

type TabKey = 'launchers' | 'microphone' | 'notifications';

export default function SettingsDialog({ onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const initial = getSettings();
  const [launchers, setLaunchersState] = useState<CliKind[]>(initial.launchers);
  const [micDeviceId, setMicState] = useState<string>(initial.micDeviceId);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micError, setMicError] = useState<string | null>(null);
  const [enumerating, setEnumerating] = useState(false);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  // Which tab is showing. Settings grow over time — splitting them into
  // tabs keeps the dialog from becoming a long scroll. Defaults to the
  // launcher chips since that's the most common edit.
  const [currentTab, setCurrentTab] = useState<TabKey>('launchers');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.showModal();
    return () => { try { el.close(); } catch { /* already closed */ } };
  }, []);

  useClickOutside(ref, onClose);

  // Enumerate audio inputs. The spec hides device labels until the page has
  // active mic permission, so if labels come back empty we briefly request a
  // stream to unlock them, then enumerate again. The stream is stopped right
  // away — we only need it to satisfy the labels gate.
  const refreshMics = async () => {
    setEnumerating(true);
    setMicError(null);
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setMicError('Device enumeration not supported in this browser.');
        setMics([]);
        return;
      }
      let devices = await navigator.mediaDevices.enumerateDevices();
      let inputs = devices.filter((d) => d.kind === 'audioinput');
      const labelsHidden = inputs.length > 0 && inputs.every((d) => !d.label);
      if (labelsHidden) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          devices = await navigator.mediaDevices.enumerateDevices();
          inputs = devices.filter((d) => d.kind === 'audioinput');
        } catch (e) {
          // Permission denied or no mic. Show whatever the browser handed back
          // (deviceIds without labels) so the user can still pick blindly.
          setMicError(
            e instanceof Error && e.name === 'NotAllowedError'
              ? 'Allow microphone access to see device names.'
              : 'Couldn’t access microphone for device names.',
          );
        }
      }
      setMics(inputs);
    } finally {
      setEnumerating(false);
    }
  };

  useEffect(() => {
    void refreshMics();
    // Hot-plugging an AirPod or USB mic fires `devicechange`; refresh so the
    // list stays current while the dialog is open.
    const onChange = () => { void refreshMics(); };
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
  }, []);

  const toggleLauncher = (cli: CliKind) => {
    setLaunchersState((prev) => {
      const next = prev.includes(cli) ? prev.filter((c) => c !== cli) : [...prev, cli];
      setLaunchers(next);
      return next;
    });
  };

  const pickMic = (deviceId: string) => {
    setMicState(deviceId);
    setMicDeviceId(deviceId);
  };

  // Push notification state — fetched once when the dialog opens, and refreshed
  // whenever the user toggles. PushManager.getSubscription doesn't emit events
  // so a visibilitychange listener is the only way to catch the iOS-Settings
  // round-trip (user leaves the PWA → flips the permission → returns).
  const refreshPushState = async () => {
    try { setPushState(await getPushState()); } catch { /* swallow */ }
  };
  useEffect(() => {
    void refreshPushState();
    const onVis = () => { if (document.visibilityState === 'visible') void refreshPushState(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', refreshPushState);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', refreshPushState);
    };
  }, []);

  const handleEnablePush = async () => {
    setPushBusy(true);
    try {
      const r = await subscribeToPush();
      if (r.ok) {
        toast.success('Notifications on — sending a test ping…');
        try { await sendTestPush(); } catch { /* non-fatal */ }
      } else if (r.reason === 'denied') {
        toast.error('Permission denied. Re-enable in your browser/OS settings.');
      } else if (r.reason === 'unsupported') {
        toast.error('Push not supported on this browser.');
      } else {
        toast.error(r.message || 'Could not enable notifications');
      }
    } finally {
      setPushBusy(false);
      await refreshPushState();
    }
  };
  const handleDisablePush = async () => {
    setPushBusy(true);
    try {
      await unsubscribeFromPush();
      toast.success('Notifications off');
    } finally {
      setPushBusy(false);
      await refreshPushState();
    }
  };

  return (
    <>
      <motion.div
        className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-[3px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.dialog
        ref={ref}
        open={false}
        initial={initialState}
        animate={openState}
        exit={initialState}
        onCancel={(event) => { event.preventDefault(); onClose(); }}
        onClose={onClose}
        style={{ transformPerspective: 500 }}
        className="z-[10000] w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] rounded-xl border border-panel-border bg-panel-surface shadow-2xl text-panel-text backdrop:hidden overflow-hidden p-0"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-panel-border">
          <h2 className="font-mono text-sm font-semibold tracking-wide uppercase text-panel-text">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1 -mr-1 rounded text-panel-muted hover:text-panel-text"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <LayoutGroup>
          <Tabs.Root
            value={currentTab}
            onValueChange={(v) => setCurrentTab(v as TabKey)}
            className="flex flex-col"
          >
            {/* Tab strip. Three pills along the bottom border of the header
                row, with a single shared brand-orange underline that uses
                motion's layoutId to slide between tabs (no individual fade —
                one indicator hops over). */}
            <Tabs.List className="flex border-b border-panel-border px-2">
              <TabTrigger value="launchers" currentTab={currentTab}>Launchers</TabTrigger>
              <TabTrigger value="microphone" currentTab={currentTab}>Microphone</TabTrigger>
              <TabTrigger value="notifications" currentTab={currentTab}>Notifications</TabTrigger>
            </Tabs.List>

            {/* Tab body. Each panel keeps its own scroll so a long mic list
                doesn't push the launcher chips around. AnimatePresence with
                mode="wait" crossfades+blurs the panels — content swap feels
                like a film cut rather than a hard pop. */}
            <div className="relative overflow-y-auto px-5 py-4" style={{ maxHeight: 'calc(100dvh - 12rem)' }}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={currentTab}
                  initial={{ opacity: 0, filter: 'blur(5px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, filter: 'blur(5px)', transition: { duration: 0.15 } }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  layout="position"
                  style={{ willChange: 'opacity, filter' }}
                >
                  {currentTab === 'launchers' && (
                    <section>
                      <header className="mb-3">
                        <h3 className="font-mono text-xs uppercase tracking-wider text-panel-muted">
                          Floating menu shortcuts
                        </h3>
                        <p className="text-xs text-panel-muted/80 mt-1 leading-relaxed">
                          Pick which CLIs appear as one-tap chips next to the Send button.
                          The toolbar fits as many as the row has room for.
                        </p>
                      </header>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {ALL_CLIS.map((cli) => {
                          const on = launchers.includes(cli);
                          return (
                            <button
                              key={cli}
                              type="button"
                              onClick={() => toggleLauncher(cli)}
                              aria-pressed={on}
                              className={`flex items-center gap-2 px-2.5 py-2 rounded-md border font-mono text-xs transition-colors ${
                                on
                                  ? 'bg-panel-bg border-panel-text/40 text-panel-text'
                                  : 'bg-panel-bg/40 border-panel-border text-panel-muted hover:text-panel-text hover:border-panel-text/40'
                              }`}
                            >
                              <CliLogo cli={cli} className="w-4 h-4 flex-shrink-0" />
                              <span className="flex-1 text-left">{CLI_LABELS[cli]}</span>
                              {on && <Check className="w-3.5 h-3.5 text-orange-400" />}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {currentTab === 'microphone' && (
                    <section>
                      <header className="mb-3 flex items-baseline justify-between gap-2">
                        <div>
                          <h3 className="font-mono text-xs uppercase tracking-wider text-panel-muted">
                            Microphone
                          </h3>
                          <p className="text-xs text-panel-muted/80 mt-1 leading-relaxed">
                            Used for voice transcription. Automatic follows whatever the
                            OS hands us (usually your latest connected device).
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void refreshMics()}
                          disabled={enumerating}
                          className="font-mono text-[10px] uppercase tracking-wider text-panel-muted hover:text-panel-text disabled:opacity-50"
                        >
                          {enumerating ? 'refreshing…' : 'refresh'}
                        </button>
                      </header>
                      <div className="flex flex-col gap-1">
                        <MicRow
                          label="Automatic"
                          hint="System default"
                          selected={micDeviceId === MIC_AUTOMATIC}
                          onClick={() => pickMic(MIC_AUTOMATIC)}
                        />
                        {mics.map((m, i) => (
                          <MicRow
                            key={m.deviceId || `mic-${i}`}
                            label={m.label || `Microphone ${i + 1}`}
                            hint={m.deviceId ? m.deviceId.slice(0, 12) + '…' : undefined}
                            selected={micDeviceId === m.deviceId}
                            onClick={() => pickMic(m.deviceId)}
                          />
                        ))}
                        {mics.length === 0 && !enumerating && (
                          <div className="text-xs text-panel-muted px-2 py-2 font-mono">
                            No microphones detected.
                          </div>
                        )}
                        {micError && (
                          <div className="text-xs text-panel-danger px-2 py-1 leading-relaxed">
                            {micError}
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {currentTab === 'notifications' && (
                    <section>
                      <header className="mb-3">
                        <h3 className="font-mono text-xs uppercase tracking-wider text-panel-muted">
                          Notifications
                        </h3>
                        <p className="text-xs text-panel-muted/80 mt-1 leading-relaxed">
                          Web Push pings your phone or desktop when an agent needs you —
                          even with the app closed. iOS requires Add to Home Screen first.
                        </p>
                      </header>
                      <NotifRow
                        state={pushState}
                        busy={pushBusy}
                        onEnable={handleEnablePush}
                        onDisable={handleDisablePush}
                      />
                    </section>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </Tabs.Root>
        </LayoutGroup>

        <div className="px-5 py-3 border-t border-panel-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-mono rounded-md bg-panel-bg border border-panel-border text-panel-text hover:border-panel-text/60"
          >
            Done
          </button>
        </div>
      </motion.dialog>
    </>
  );
}

// Tab button with the shared sliding underline. The indicator is a single
// motion.div with a stable `layoutId` so motion animates ONE element across
// the tabs instead of fading individual underlines in and out — gives the
// pill the springy "tracking" feel from the reference pattern.
function TabTrigger({
  value,
  currentTab,
  children,
}: {
  value: string;
  currentTab: string;
  children: React.ReactNode;
}) {
  const selected = currentTab === value;
  return (
    <Tabs.Tab
      value={value}
      render={
        <button
          type="button"
          className={`relative flex-1 h-10 px-4 font-mono text-xs uppercase tracking-wider transition-colors select-none ${
            selected ? 'text-panel-text' : 'text-panel-muted hover:text-panel-text'
          }`}
        >
          {children}
          {selected && (
            <motion.div
              layoutId="settings-tabs-indicator"
              className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-orange-500"
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            />
          )}
        </button>
      }
    />
  );
}

function NotifRow({
  state, busy, onEnable, onDisable,
}: {
  state: PushState | null;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  // Still fetching — keep a stable placeholder so the section doesn't pop.
  if (!state) {
    return (
      <div className="px-3 py-2 rounded-md border border-panel-border bg-panel-bg/40 text-xs text-panel-muted font-mono">
        Checking permission…
      </div>
    );
  }

  // The five reachable states map to fixed copy + a single action button.
  // We pull the case-specific bits into locals so the markup below stays one
  // shape (icon · label/hint · action) for every state.
  let Icon = Bell;
  let label = 'Not enabled';
  let hint: string | null = 'Notifications are off — you won’t get pinged when the agent needs you.';
  let action: { onClick: () => void; text: string; disabled?: boolean; tone?: 'default' | 'danger' } | null = {
    onClick: onEnable, text: busy ? 'Enabling…' : 'Enable', disabled: busy,
  };
  let iconTone = 'text-panel-muted';

  if (!state.supported) {
    Icon = BellOff;
    label = 'Not supported';
    hint = 'This browser doesn’t support Web Push.';
    action = null;
    iconTone = 'text-panel-muted';
  } else if (state.isIOS && !state.isStandalone) {
    Icon = BellPlus;
    label = 'Add to Home Screen first';
    hint = 'On iPhone/iPad, tap Share → Add to Home Screen, then open the app from its icon to enable notifications.';
    action = null;
    iconTone = 'text-orange-400';
  } else if (state.permission === 'denied') {
    Icon = BellOff;
    label = 'Blocked by browser';
    hint = 'Re-enable notifications for this site in your browser or OS settings, then come back.';
    action = null;
    iconTone = 'text-panel-danger';
  } else if (state.subscribed && state.permission === 'granted') {
    Icon = BellRing;
    label = 'Notifications on';
    hint = null;
    action = { onClick: onDisable, text: busy ? 'Disabling…' : 'Turn off', disabled: busy, tone: 'danger' };
    iconTone = 'text-green-400';
  }

  const actionClass = action?.tone === 'danger'
    ? 'border-panel-border text-panel-muted hover:text-panel-danger hover:border-panel-danger'
    : 'border-orange-400/40 text-orange-300 bg-orange-500/10 hover:bg-orange-500/20';

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-md border border-panel-border bg-panel-bg/40">
      <Icon className={`w-4 h-4 flex-shrink-0 ${iconTone}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono text-panel-text">{label}</div>
        {hint && (
          <div className="text-[11px] text-panel-muted/80 mt-0.5 leading-relaxed">
            {hint}
          </div>
        )}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className={`flex-shrink-0 px-3 py-1.5 text-xs font-mono rounded-md border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${actionClass}`}
        >
          {action.text}
        </button>
      )}
    </div>
  );
}

function MicRow({
  label, hint, selected, onClick,
}: { label: string; hint?: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex items-center gap-3 px-3 py-2 rounded-md border text-left transition-colors ${
        selected
          ? 'bg-panel-bg border-orange-400/50 text-panel-text'
          : 'bg-panel-bg/40 border-panel-border text-panel-muted hover:text-panel-text hover:border-panel-text/40'
      }`}
    >
      <Mic className={`w-3.5 h-3.5 flex-shrink-0 ${selected ? 'text-orange-400' : ''}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono truncate">{label}</div>
        {hint && (
          <div className="text-[10px] text-panel-muted/80 font-mono truncate">{hint}</div>
        )}
      </div>
      {selected && <Check className="w-4 h-4 text-orange-400 flex-shrink-0" />}
    </button>
  );
}
