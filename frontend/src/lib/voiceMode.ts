// Voice mode controls which path the panel uses for dictation.
//
//   third-party  — record locally, POST blob to /api/transcribe (OpenAI Whisper),
//                  paste the returned text into the active terminal. Works for any
//                  CLI you've opened in a tab (claude, codex, gemini, plain bash).
//                  This is the default and the recommended primary mode.
//
//   native       — stream phone-mic audio over WebSocket to /audio-bridge, which
//                  pipes it into a snd-aloop virtual mic on the server. Then
//                  Claude Code's built-in `/voice` records that virtual mic and
//                  streams it to Deepgram for transcription. Lower latency with
//                  interim results, but only useful when you're using `claude /voice`
//                  specifically.
//
// Stored in localStorage so the choice survives reloads; default is third-party.

const KEY = 'panel.voiceMode';

export type VoiceMode = 'third-party' | 'native';

export function getVoiceMode(): VoiceMode {
  if (typeof localStorage === 'undefined') return 'third-party';
  const v = localStorage.getItem(KEY);
  return v === 'native' ? 'native' : 'third-party';
}

export function setVoiceMode(mode: VoiceMode): void {
  try { localStorage.setItem(KEY, mode); } catch { /* private mode / quota */ }
  // Cross-component sync: other listeners (MicButton, the floating shell)
  // subscribe to `storage` for cross-tab AND to `panel.voiceMode` custom
  // events for same-tab changes (the storage event doesn't fire in the tab
  // that performed the write).
  try { window.dispatchEvent(new CustomEvent('panel.voiceMode', { detail: mode })); }
  catch { /* SSR-ish env */ }
}

export function subscribeVoiceMode(cb: (mode: VoiceMode) => void): () => void {
  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent<VoiceMode>).detail;
    cb(detail === 'native' ? 'native' : 'third-party');
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cb(e.newValue === 'native' ? 'native' : 'third-party');
  };
  window.addEventListener('panel.voiceMode', onCustom as EventListener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('panel.voiceMode', onCustom as EventListener);
    window.removeEventListener('storage', onStorage);
  };
}

// Lightweight event bus so the native-bridge button can live anywhere in the
// tree (sidebar, mobile keybar, desktop floater) without prop-drilling the
// modal handle through every intermediate component. Layout owns the modal
// state and listens for this event.
const OPEN_EVENT = 'panel.openVoiceBridge';

export function openVoiceBridge(): void {
  try { window.dispatchEvent(new Event(OPEN_EVENT)); } catch { /* SSR */ }
}

export function subscribeOpenVoiceBridge(cb: () => void): () => void {
  window.addEventListener(OPEN_EVENT, cb);
  return () => window.removeEventListener(OPEN_EVENT, cb);
}
