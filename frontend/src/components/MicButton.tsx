import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { toast } from 'sonner';
import { transcribe, TranscribeError } from '../lib/api';
import { getSettings, MIC_AUTOMATIC } from '../lib/settings';

interface Props {
  onText: (text: string) => void;
  variant?: 'default' | 'floating';
}

type State = 'idle' | 'recording' | 'processing';

// Hard cap is a pure runaway-safety net (phone in pocket, mic stuck on); the
// usual stop trigger is the silence-detector below. Opus voice is ~4 KB/s, so
// 10 min ≈ 2.4 MB — comfortably under the backend's 5 MB body cap.
const MAX_RECORD_MS = 10 * 60_000;
// Auto-stop after this much continuous silence once we've heard at least one
// frame of speech. 10 s is loose enough that natural mid-sentence pauses don't
// trip it, tight enough that you don't have to thumb the button on mobile.
const SILENCE_STOP_MS = 10_000;
const VAD_TICK_MS = 100;
// Spend the first half-second measuring the ambient noise floor so the speech
// threshold adapts (subway / café / fan running) instead of using a fixed
// number that fails in noisy rooms.
const VAD_CALIBRATION_MS = 500;
const VAD_MIN_THRESHOLD = 0.015;
const VAD_ADAPTIVE_MULTIPLIER = 2.5;

function pickMime(): string | undefined {
  // Safari (macOS + iOS/iPadOS) lies on isTypeSupported('audio/webm') — it
  // returns true, but the recorder produces an empty 5-byte blob that OpenAI
  // rejects as "Audio file might be corrupted or unsupported". Native Safari
  // recording is mp4/aac, so we put mp4 first on WebKit. Chromium derivatives
  // (Chrome, Edge, Brave, Opera, CriOS, EdgiOS) all include "Chrome"/"Edg"
  // in the UA, so we exclude them — those genuinely support webm/opus.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isSafari =
    /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|CriOS|EdgiOS|FxiOS/.test(ua);
  const candidates = isSafari
    ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mpeg']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(c)) {
      return c;
    }
  }
  return undefined;
}

function fmtTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Minimal shape for the Wake Lock API — TS lib.dom ships this in newer
// versions but we don't want to bump the target just for one feature.
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}
interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

// Three bars rising/falling in phase to signal "voice being transcribed".
// Replaces a generic spinner so the indicator stays inside the audio
// metaphor. Bars use scaleY (not height) so the button row never reflows.
// Animation + reduced-motion fallback live in index.css (.voice-wave-bar).
function Waveform({ size }: { size: 'sm' | 'md' }) {
  const dims =
    size === 'md'
      ? { box: 'h-4 gap-[3px]', bar: 'w-[3px]' }
      : { box: 'h-3 gap-[2px]', bar: 'w-[2.5px]' };
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center ${dims.box}`}
    >
      <span className={`voice-wave-bar ${dims.bar} h-full rounded-full bg-current`} />
      <span className={`voice-wave-bar ${dims.bar} h-full rounded-full bg-current`} />
      <span className={`voice-wave-bar ${dims.bar} h-full rounded-full bg-current`} />
    </span>
  );
}

export default function MicButton({ onText, variant = 'default' }: Props) {
  const [state, setState] = useState<State>('idle');
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  // Touch-device only. On a laptop the screen never auto-dims mid-dictation
  // anyway, and a desktop wake lock would just be an unhelpful no-op risk.
  const isTouch = typeof window !== 'undefined'
    && !!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;

  // Wake-lock helpers. The API is best-effort: not available on iOS Safari
  // < 16.4, and the browser can revoke at will (e.g. on tab background).
  // We swallow failures — losing the lock just means the OS may dim again,
  // which is the pre-fix behavior.
  const acquireWakeLock = async () => {
    if (!isTouch || wakeLockRef.current) return;
    const nav = navigator as Navigator & WakeLockNavigator;
    if (!nav.wakeLock) return;
    try {
      const lock = await nav.wakeLock.request('screen');
      wakeLockRef.current = lock;
      lock.addEventListener('release', () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = null;
      });
    } catch { /* permission denied or unavailable — fall through */ }
  };
  const releaseWakeLock = () => {
    const lock = wakeLockRef.current;
    if (!lock) return;
    wakeLockRef.current = null;
    lock.release().catch(() => { /* already released */ });
  };

  useEffect(() => () => {
    // Cleanup on unmount: stop any open mic stream and timers.
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    if (vadTimerRef.current) clearInterval(vadTimerRef.current);
    audioCtxRef.current?.close().catch(() => { /* already closed */ });
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
    releaseWakeLock();
  }, []);

  // Drive the wake lock from recording state. Browsers auto-release the lock
  // when the page is hidden, so when we come back into view mid-recording we
  // need to re-acquire — otherwise the screen would dim on app switch.
  useEffect(() => {
    if (state === 'recording') {
      void acquireWakeLock();
      const onVis = () => {
        if (document.visibilityState === 'visible') void acquireWakeLock();
      };
      document.addEventListener('visibilitychange', onVis);
      return () => {
        document.removeEventListener('visibilitychange', onVis);
        releaseWakeLock();
      };
    }
    releaseWakeLock();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // We route mic errors through the global toaster (sonner) instead of an
  // inline tooltip — the KeyBar's outer card has `overflow-hidden`, which
  // clips any `absolute` tooltip rendered from inside MicButton. Toast lives
  // at document body so it escapes the clip and shows up the same on
  // phone, iPad, and desktop. Pass the underlying Error so the description
  // shows the actual name/message — critical for diagnosing iOS Safari
  // permission failures where the title alone ("mic error") is useless.
  const flashError = (title: string, err?: unknown) => {
    let description: string | undefined;
    if (err instanceof Error) {
      description = err.name ? `${err.name}: ${err.message}` : err.message;
    } else if (typeof err === 'string') {
      description = err;
    }
    toast.error(title, description ? { description } : undefined);
  };

  const stop = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    try { recorder.stop(); } catch { /* ignore */ }
  };

  const start = async () => {
    if (state !== 'idle') return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      // Surface enough detail to tell apart the three real failure modes on
      // iOS Safari: insecure context (http://), missing MediaRecorder (old
      // iPadOS), or a webview that hides mediaDevices entirely (in-app
      // browser). Without this, "not supported" is unactionable.
      const reasons: string[] = [];
      if (!window.isSecureContext) reasons.push('insecure context');
      if (!navigator.mediaDevices) reasons.push('no mediaDevices');
      else if (!navigator.mediaDevices.getUserMedia) reasons.push('no getUserMedia');
      if (typeof MediaRecorder === 'undefined') reasons.push('no MediaRecorder');
      flashError('mic not supported', reasons.join(', ') || undefined);
      return;
    }

    // Honour the user's saved mic choice from Settings. `automatic` (default)
    // = no deviceId hint, letting the OS pick — typically the most recently
    // connected device. A specific deviceId uses `exact:` so the browser
    // doesn't silently substitute another mic; if the saved device is gone
    // (e.g. AirPods disconnected after the user picked them manually), we
    // catch OverconstrainedError and retry with the default so dictation
    // still works instead of hard-failing.
    const { micDeviceId } = getSettings();
    let stream: MediaStream;
    const constraints: MediaStreamConstraints = micDeviceId && micDeviceId !== MIC_AUTOMATIC
      ? { audio: { deviceId: { exact: micDeviceId } } }
      : { audio: true };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      const isMissingDevice = e instanceof Error && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError');
      if (isMissingDevice && constraints.audio !== true) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          flashError('saved mic unavailable — using default');
        } catch (e2) {
          flashError(e2 instanceof Error && e2.name === 'NotAllowedError' ? 'mic denied' : 'mic error', e2);
          return;
        }
      } else {
        flashError(e instanceof Error && e.name === 'NotAllowedError' ? 'mic denied' : 'mic error', e);
        return;
      }
    }

    streamRef.current = stream;
    const mimeType = pickMime();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      flashError('recorder error', e);
      return;
    }
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    recorder.onstop = async () => {
      if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
      if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
      if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null; }
      audioCtxRef.current?.close().catch(() => { /* already closed */ });
      audioCtxRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
      chunksRef.current = [];
      if (blob.size === 0) {
        setState('idle');
        return;
      }

      setState('processing');
      try {
        const text = (await transcribe(blob)).trim();
        if (text) onText(text);
        setState('idle');
      } catch (e) {
        setState('idle');
        // Build a detailed diagnostic blob — only one of our devices fails
        // at a time and the toast description is the only context we get
        // back from a phone/iPad. Includes the candidate MIME support
        // matrix so we can tell which container the recorder actually
        // produced, plus the server's echo of what it forwarded to OpenAI.
        const supportMatrix = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg']
          .map((c) => `${c}=${typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(c) ? 'y' : 'n'}`)
          .join(' ');
        const lines = [
          `blob.type=${blob.type || '(empty)'}`,
          `blob.size=${blob.size}`,
          `recorder.mimeType=${recorder.mimeType || '(empty)'}`,
          `picked=${mimeType ?? '(default)'}`,
          `support: ${supportMatrix}`,
          `ua=${navigator.userAgent}`,
        ];
        if (e instanceof TranscribeError) {
          lines.push(`server.status=${e.status}`);
          lines.push(`server.body=${e.openaiBody}`);
          if (e.diagnostics) {
            lines.push(`server.forwarded=${e.diagnostics.baseContentType} (raw=${e.diagnostics.rawContentType}, ext=${e.diagnostics.ext}, bytes=${e.diagnostics.bytes})`);
          }
        } else if (e instanceof Error) {
          lines.push(`error=${e.name}: ${e.message}`);
        } else {
          lines.push(`error=${String(e)}`);
        }
        const debug = lines.join('\n');
        // Stash to console too — visible in Safari Web Inspector if the
        // user tethers an iPad to a Mac with Develop enabled.
        console.error('[transcribe] failed\n' + debug);
        // Sticky toast with Copy so the user can paste the whole report
        // from any device. Short description shows the first line of the
        // server's error reply since that's the most useful single hint.
        const headline = e instanceof TranscribeError && e.openaiBody
          ? e.openaiBody.split('\n')[0].slice(0, 140)
          : e instanceof Error ? `${e.name}: ${e.message}` : 'transcribe failed';
        toast.error('Transcribe failed', {
          description: headline,
          duration: 12_000,
          action: {
            label: 'Copy details',
            onClick: () => {
              navigator.clipboard?.writeText(debug)
                .then(() => toast.success('Diagnostic copied'))
                .catch(() => toast.error('Clipboard blocked'));
            },
          },
        });
      }
    };

    recorder.start();
    startedAtRef.current = Date.now();
    setElapsed(0);
    setState('recording');

    safetyTimerRef.current = setTimeout(stop, MAX_RECORD_MS);
    tickTimerRef.current = setInterval(() => {
      setElapsed(Date.now() - startedAtRef.current);
    }, 250);

    // Silence detector. Wrapped in try/catch because the Web Audio API can
    // be unavailable (very old browsers / strict autoplay policies); on
    // failure we silently fall back to the MAX_RECORD_MS-only behavior.
    try {
      const Ctor = window.AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);

        const vadStartedAt = Date.now();
        let noiseSum = 0;
        let noiseN = 0;
        let calibrated = false;
        let threshold = VAD_MIN_THRESHOLD;
        let speechSeen = false;
        let lastSpeechAt = Date.now();

        vadTimerRef.current = setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          let sq = 0;
          for (let i = 0; i < buf.length; i++) sq += buf[i] * buf[i];
          const rms = Math.sqrt(sq / buf.length);
          const now = Date.now();

          if (now - vadStartedAt < VAD_CALIBRATION_MS) {
            noiseSum += rms;
            noiseN += 1;
            return;
          }
          if (!calibrated) {
            const floor = noiseN > 0 ? noiseSum / noiseN : 0;
            threshold = Math.max(VAD_MIN_THRESHOLD, floor * VAD_ADAPTIVE_MULTIPLIER);
            calibrated = true;
            lastSpeechAt = now;
          }
          if (rms >= threshold) {
            speechSeen = true;
            lastSpeechAt = now;
            return;
          }
          if (speechSeen && now - lastSpeechAt >= SILENCE_STOP_MS) {
            stop();
          }
        }, VAD_TICK_MS);
      }
    } catch { /* VAD best-effort */ }
  };

  const handleClick = () => {
    if (state === 'recording') stop();
    else if (state === 'idle') void start();
  };

  if (variant === 'floating') {
    return (
      <div className="relative flex items-center justify-center">
        {state === 'recording' && (
          <div className="absolute bottom-full mb-2 px-2 py-0.5 rounded-full bg-panel-danger text-white text-[10px] font-mono tabular-nums shadow whitespace-nowrap animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
            {fmtTime(elapsed)}
          </div>
        )}
        <button
          type="button"
          onPointerDown={(e) => { e.preventDefault(); }}
          onClick={handleClick}
          disabled={state === 'processing'}
          aria-label={
            state === 'recording'
              ? 'Stop recording'
              : state === 'processing'
              ? 'Transcribing'
              : 'Start dictation'
          }
          title={state === 'recording' ? 'Stop recording' : state === 'processing' ? 'Transcribing…' : 'Start dictation'}
          className={`w-12 h-12 rounded-full border backdrop-blur flex items-center justify-center touch-manipulation select-none transition-all hover:scale-105 active:scale-95 ${
            state === 'recording'
              ? 'bg-panel-danger text-white border-panel-danger animate-pulse shadow-lg'
              : state === 'processing'
              ? 'bg-panel-surface/90 text-panel-muted border-panel-border cursor-wait shadow-lg'
              : 'bg-orange-400 hover:bg-orange-300 text-white border-orange-400 shadow-[0_8px_24px_-6px_rgba(251,146,60,0.55)]'
          }`}
        >
          {state === 'recording' ? (
            <Square className="w-4 h-4 fill-current" />
          ) : state === 'processing' ? (
            <Waveform size="md" />
          ) : (
            <Mic className="w-5 h-5" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onPointerDown={(e) => { e.preventDefault(); }}
        onClick={handleClick}
        disabled={state === 'processing'}
        aria-label={
          state === 'recording'
            ? 'Stop recording'
            : state === 'processing'
            ? 'Transcribing'
            : 'Start dictation'
        }
        // Fixed width across all three states so the button never reflows
        // between idle ("Voice") → recording ("0:05") → processing (waveform).
        // The old approach pulse-dimmed the whole button while recording,
        // which let the parent surface ghost through the side-padding when
        // width was locked — so we drive recording-state liveness via an
        // outside glow ring (mic-rec-glow) instead of dipping opacity.
        className={`h-9 px-2.5 w-[5.5rem] justify-center rounded-md border font-mono text-xs whitespace-nowrap touch-manipulation select-none flex items-center gap-1.5 transition-colors ${
          state === 'recording'
            ? 'bg-panel-danger text-white border-panel-danger mic-rec-glow'
            : state === 'processing'
            ? 'bg-panel-surface text-panel-muted border-panel-border cursor-wait'
            : 'bg-panel-bg text-panel-text border-panel-border'
        }`}
      >
        {state === 'recording' ? (
          <>
            <Square className="w-3 h-3 fill-current" />
            <span className="tabular-nums">{fmtTime(elapsed)}</span>
          </>
        ) : state === 'processing' ? (
          <Waveform size="sm" />
        ) : (
          <>
            <Mic className="w-3.5 h-3.5" />
            <span>Voice</span>
          </>
        )}
      </button>
      {/* Polite SR announcement when transcription kicks in so screen-reader
          users get an audible "Transcribing" without the button having to be
          re-focused. Empty when idle/recording so it doesn't speak on mount. */}
      <span className="sr-only" aria-live="polite">
        {state === 'processing' ? 'Transcribing' : ''}
      </span>
    </div>
  );
}
