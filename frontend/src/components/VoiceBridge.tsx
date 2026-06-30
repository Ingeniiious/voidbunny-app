import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, X, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getWsTicket } from '../lib/api';

// VoiceBridge — streams the device's microphone over WebSocket to the panel
// backend, which writes it into a snd-aloop virtual mic on the server. Once
// the bridge is live, Claude Code's `/voice` reads this phone as if it were
// a local USB microphone.
//
// Wire format on the WS: binary frames, raw PCM s16le, 16 kHz, 1 channel.
// 20 ms per frame (320 samples = 640 bytes). The server pipes them straight
// into `aplay -D hw:Loopback,0,0`.

interface Props {
  open: boolean;
  onClose: () => void;
}

// Minimal WakeLock shape — lib.dom has it in newer versions, but we target
// older typings to keep tsconfig lean.
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}
interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

type Status = 'idle' | 'requesting-mic' | 'connecting' | 'streaming' | 'error';

// Inline AudioWorklet — keeps the worklet alongside the component so the
// build stays a single Vite-bundled SPA with no extra public-folder asset
// to keep in sync. Loaded via Blob URL at runtime.
//
// What it does:
//   1. Reads the input as Float32 at the AudioContext's native rate (~48 kHz
//      on phones).
//   2. Decimates to 16 kHz by averaging every (inputRate/16000) input samples
//      into one output sample — cheap anti-alias + downsample in one pass.
//      Voice STT doesn't need a fancy polyphase filter; averaging is fine.
//   3. Clamps to [-1, 1] and converts to Int16 little-endian.
//   4. Emits a buffer every 20 ms (320 samples = 640 bytes) plus the RMS of
//      that chunk for the UI level meter.
const WORKLET_SOURCE = `
class PCMDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.outputRate = 16000;
    this.inputRate = opts.inputRate || sampleRate;
    this.ratio = this.inputRate / this.outputRate;
    this.chunkSamples = 320;
    this.outBuffer = new Int16Array(this.chunkSamples);
    this.outFill = 0;
    this.accum = 0;
    this.accumN = 0;
    this.consumed = 0;
    this.sqSum = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const ch = input[0];
    for (let i = 0; i < ch.length; i++) {
      this.accum += ch[i];
      this.accumN += 1;
      this.consumed += 1;
      if (this.consumed >= this.ratio) {
        const avg = this.accumN > 0 ? this.accum / this.accumN : 0;
        const clipped = avg < -1 ? -1 : (avg > 1 ? 1 : avg);
        this.outBuffer[this.outFill++] = clipped < 0
          ? Math.round(clipped * 0x8000)
          : Math.round(clipped * 0x7FFF);
        this.sqSum += clipped * clipped;
        this.accum = 0;
        this.accumN = 0;
        // Carry the fractional remainder so the rate stays exact over time
        // instead of drifting (rounds to whole input-sample counts otherwise).
        this.consumed -= this.ratio;
        if (this.outFill >= this.chunkSamples) {
          const rms = Math.sqrt(this.sqSum / this.chunkSamples);
          // Copy the Int16Array so subsequent mutations don't race the main thread.
          const out = new Int16Array(this.outBuffer);
          this.port.postMessage({ pcm: out.buffer, rms }, [out.buffer]);
          this.outFill = 0;
          this.sqSum = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-downsampler', PCMDownsampler);
`;

function makeWorkletUrl(): string {
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

function wsUrlFor(path: string, ticket: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}?ticket=${encodeURIComponent(ticket)}`;
}

export default function VoiceBridge({ open, onClose }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const workletUrlRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const startedAtRef = useRef(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const wantsStreamingRef = useRef(false); // user toggled on → keep trying

  const acquireWakeLock = useCallback(async () => {
    if (wakeLockRef.current) return;
    const nav = navigator as Navigator & WakeLockNavigator;
    if (!nav.wakeLock) return;
    try {
      const lock = await nav.wakeLock.request('screen');
      wakeLockRef.current = lock;
      lock.addEventListener('release', () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = null;
      });
    } catch { /* permission denied or unsupported */ }
  }, []);

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLockRef.current;
    if (!lock) return;
    wakeLockRef.current = null;
    lock.release().catch(() => { /* already released */ });
  }, []);

  const teardown = useCallback(() => {
    wantsStreamingRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    try { workletRef.current?.disconnect(); } catch { /* ignore */ }
    workletRef.current = null;
    try { sourceRef.current?.disconnect(); } catch { /* ignore */ }
    sourceRef.current = null;
    audioCtxRef.current?.close().catch(() => { /* already closed */ });
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    streamRef.current = null;
    if (wsRef.current) {
      try { wsRef.current.close(1000, 'client done'); } catch { /* ignore */ }
      wsRef.current = null;
    }
    if (workletUrlRef.current) {
      URL.revokeObjectURL(workletUrlRef.current);
      workletUrlRef.current = null;
    }
    releaseWakeLock();
    setLevel(0);
    setStatus('idle');
    setElapsed(0);
    reconnectAttemptsRef.current = 0;
  }, [releaseWakeLock]);

  const openWs = useCallback(async (): Promise<WebSocket> => {
    // Single-use ticket so the JWT never appears in the URL / Caddy logs.
    const ticket = await getWsTicket();
    const ws = new WebSocket(wsUrlFor('/audio-bridge', ticket));
    ws.binaryType = 'arraybuffer';
    return ws;
  }, []);

  const start = useCallback(async () => {
    if (status === 'streaming' || status === 'connecting' || status === 'requesting-mic') return;
    setError(null);
    wantsStreamingRef.current = true;

    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      setError('browser missing getUserMedia / AudioWorklet');
      setStatus('error');
      return;
    }

    setStatus('requesting-mic');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          // Request 16k natively so the worklet decimator becomes a no-op on
          // devices that honor the hint. iOS Safari typically ignores this
          // and gives us 48 kHz anyway — the worklet handles either case.
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      setError(name === 'NotAllowedError' ? 'mic permission denied' : 'cannot open mic');
      setStatus('error');
      wantsStreamingRef.current = false;
      return;
    }
    streamRef.current = stream;

    const Ctor: typeof AudioContext = window.AudioContext
      || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    audioCtxRef.current = ctx;

    const workletUrl = makeWorkletUrl();
    workletUrlRef.current = workletUrl;
    try {
      await ctx.audioWorklet.addModule(workletUrl);
    } catch (err) {
      setError('audio worklet load failed');
      console.error('worklet load failed', err);
      setStatus('error');
      teardown();
      return;
    }

    const node = new AudioWorkletNode(ctx, 'pcm-downsampler', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { inputRate: ctx.sampleRate },
    });
    workletRef.current = node;
    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;
    source.connect(node);

    setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = await openWs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'cannot mint ws ticket');
      setStatus('error');
      teardown();
      return;
    }
    wsRef.current = ws;

    // Pipe worklet chunks into the WS. We drop frames when the socket isn't
    // open yet so the very first 1–2 chunks don't error during the connecting
    // handshake.
    node.port.onmessage = (ev) => {
      const data = ev.data as { pcm: ArrayBuffer; rms: number };
      setLevel(data.rms);
      if (ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(data.pcm); } catch { /* socket dying */ }
    };

    ws.addEventListener('open', () => {
      setStatus('streaming');
      reconnectAttemptsRef.current = 0;
      startedAtRef.current = Date.now();
      setElapsed(0);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = setInterval(() => {
        setElapsed(Date.now() - startedAtRef.current);
      }, 500);
      void acquireWakeLock();
    });

    ws.addEventListener('close', (ev) => {
      // Tolerate temporary drops while the user still wants to stream
      // (subway tunnels, Wi-Fi handoff, screen-off micro-lapses). Exponential
      // backoff capped at 10s. Stop retrying after 5 attempts so we don't
      // burn battery on a permanently broken bridge.
      if (!wantsStreamingRef.current) return;
      if (ev.code === 1008 || ev.code === 4401) {
        setError('unauthorized — try toggling the mic off and back on');
        setStatus('error');
        wantsStreamingRef.current = false;
        return;
      }
      const attempt = ++reconnectAttemptsRef.current;
      if (attempt > 5) {
        setError('lost connection — tap again to retry');
        setStatus('error');
        wantsStreamingRef.current = false;
        return;
      }
      const delay = Math.min(10_000, 500 * Math.pow(2, attempt - 1));
      setStatus('connecting');
      reconnectTimerRef.current = setTimeout(async () => {
        try {
          const next = await openWs();
          wsRef.current = next;
          next.binaryType = 'arraybuffer';
          // Rebind handlers via recursion — simplest way to share retry logic.
          // We swap in the worklet's existing port.onmessage by capturing `next`
          // closed-over here.
          next.addEventListener('open', () => {
            setStatus('streaming');
            reconnectAttemptsRef.current = 0;
            startedAtRef.current = Date.now();
            void acquireWakeLock();
          });
          next.addEventListener('close', (e) => ws.dispatchEvent(new CloseEvent('close', e)));
          next.addEventListener('error', () => {/* close event will follow */});
          node.port.onmessage = (ev2) => {
            const d = ev2.data as { pcm: ArrayBuffer; rms: number };
            setLevel(d.rms);
            if (next.readyState !== WebSocket.OPEN) return;
            try { next.send(d.pcm); } catch { /* dying */ }
          };
        } catch (err) {
          setError(err instanceof Error ? err.message : 'reconnect failed');
          setStatus('error');
        }
      }, delay);
    });

    ws.addEventListener('error', () => {
      // The close event fires right after with details. Don't double-handle.
    });
  }, [status, openWs, teardown, acquireWakeLock]);

  const stop = useCallback(() => {
    teardown();
  }, [teardown]);

  // Always release everything when the modal closes — no background streaming.
  useEffect(() => {
    if (!open) teardown();
    return () => { /* teardown runs in the !open branch above and on unmount via the next effect */ };
  }, [open, teardown]);

  useEffect(() => () => teardown(), [teardown]);

  // Re-acquire wake lock when the page comes back into view (browsers
  // auto-release it on hide).
  useEffect(() => {
    if (status !== 'streaming') return;
    const onVis = () => {
      if (document.visibilityState === 'visible') void acquireWakeLock();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [status, acquireWakeLock]);

  const handleToggle = () => {
    if (status === 'streaming' || status === 'connecting' || status === 'requesting-mic') stop();
    else void start();
  };

  if (!open) return null;

  // RMS of voiced speech is typically ~0.05–0.3 in the worklet's normalized
  // float range. Scale to [0,1] with a soft ceiling so the bar saturates on
  // shouting instead of clipping at quiet talking.
  const meterPct = Math.min(100, Math.round(Math.min(1, level / 0.3) * 100));
  const elapsedSec = Math.floor(elapsed / 1000);
  const elapsedStr = `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')}`;

  const statusLabel =
    status === 'idle' ? 'tap the mic to start'
    : status === 'requesting-mic' ? 'requesting microphone…'
    : status === 'connecting' ? 'connecting…'
    : status === 'streaming' ? `streaming — ${elapsedStr}`
    : status === 'error' ? (error ?? 'error')
    : '';

  const StatusIcon =
    status === 'streaming' ? CheckCircle2
    : status === 'error' ? AlertCircle
    : Loader2;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-[3px] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <motion.div
          className="relative w-full max-w-md rounded-2xl border border-panel-border bg-panel-surface text-panel-text shadow-2xl overflow-hidden"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 p-1 rounded text-panel-muted hover:text-panel-text"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="p-5 pb-4 border-b border-panel-border">
            <h2 className="font-mono text-sm font-semibold pr-6">Native voice bridge</h2>
            <p className="mt-1 text-xs text-panel-muted leading-relaxed">
              Streams this device's mic into a virtual microphone on the server, so
              <code className="mx-1 px-1 py-0.5 rounded bg-panel-bg border border-panel-border text-[11px]">claude /voice</code>
              can hear it as a local input.
            </p>
          </div>

          <div className="p-6 flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={handleToggle}
              aria-label={status === 'streaming' ? 'Stop bridge' : 'Start bridge'}
              disabled={status === 'requesting-mic' || status === 'connecting'}
              className={`relative w-24 h-24 rounded-full border-2 flex items-center justify-center transition-all active:scale-95 ${
                status === 'streaming'
                  ? 'bg-panel-danger text-white border-panel-danger animate-pulse shadow-[0_0_32px_-4px_rgba(248,113,113,0.5)]'
                  : status === 'error'
                  ? 'bg-panel-bg text-panel-danger border-panel-danger'
                  : status === 'idle'
                  ? 'bg-orange-400 text-white border-orange-400 shadow-[0_8px_28px_-6px_rgba(251,146,60,0.55)] hover:bg-orange-300'
                  : 'bg-panel-bg text-panel-muted border-panel-border cursor-wait'
              }`}
            >
              {status === 'streaming'
                ? <Square className="w-7 h-7 fill-current" />
                : (status === 'requesting-mic' || status === 'connecting')
                ? <Loader2 className="w-8 h-8 animate-spin" />
                : <Mic className="w-9 h-9" />}
            </button>

            <div className="w-full">
              <div className="h-2 rounded-full bg-panel-bg border border-panel-border overflow-hidden">
                <div
                  className={`h-full transition-[width] duration-75 ${
                    status === 'streaming' ? 'bg-orange-400' : 'bg-panel-border'
                  }`}
                  style={{ width: `${status === 'streaming' ? meterPct : 0}%` }}
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-xs font-mono text-panel-muted">
              <StatusIcon
                className={`w-3.5 h-3.5 ${
                  status === 'connecting' || status === 'requesting-mic' ? 'animate-spin' : ''
                } ${status === 'streaming' ? 'text-emerald-400' : status === 'error' ? 'text-panel-danger' : ''}`}
              />
              <span>{statusLabel}</span>
            </div>
          </div>

          <div className="px-5 pb-5">
            <ol className="text-[11px] text-panel-muted font-mono leading-relaxed space-y-1 list-decimal list-inside">
              <li>Tap the mic above and grant permission.</li>
              <li>In any terminal tab, run <code className="px-1 py-0.5 rounded bg-panel-bg border border-panel-border">claude</code>, then type <code className="px-1 py-0.5 rounded bg-panel-bg border border-panel-border">/voice</code>.</li>
              <li>Speak. Transcripts appear in the CLI in real time.</li>
            </ol>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
