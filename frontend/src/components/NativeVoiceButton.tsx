import { Radio } from 'lucide-react';
import { openVoiceBridge } from '../lib/voiceMode';

// NativeVoiceButton — opens the native phone-mic bridge modal (VoiceBridge),
// which streams audio over WebSocket to the snd-aloop virtual mic on the
// server so Claude Code's built-in `/voice` can hear it.
//
// Visually distinct from MicButton (third-party transcribe path) so the two
// are easy to tell apart in the same toolbar. Radio-tower icon hints at the
// "live mic streaming over the wire" model.

interface Props {
  variant?: 'default' | 'floating';
  prominent?: boolean; // primary mode in user's settings → louder visual treatment
}

export default function NativeVoiceButton({ variant = 'default', prominent = false }: Props) {
  const handleClick = () => openVoiceBridge();

  if (variant === 'floating') {
    return (
      <button
        type="button"
        onPointerDown={(e) => { e.preventDefault(); }}
        onClick={handleClick}
        aria-label="Open native voice bridge"
        title="Stream phone mic to Claude Code /voice"
        className={`rounded-full border backdrop-blur flex items-center justify-center touch-manipulation select-none transition-all hover:scale-105 active:scale-95 ${
          prominent
            ? 'w-12 h-12 bg-violet-500 hover:bg-violet-400 text-white border-violet-500 shadow-[0_8px_24px_-6px_rgba(139,92,246,0.55)]'
            : 'w-9 h-9 bg-panel-surface/90 text-panel-muted hover:text-panel-text border-panel-border shadow'
        }`}
      >
        <Radio className={prominent ? 'w-5 h-5' : 'w-4 h-4'} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onPointerDown={(e) => { e.preventDefault(); }}
      onClick={handleClick}
      aria-label="Open native voice bridge"
      title="Stream phone mic to Claude Code /voice"
      className={`h-9 rounded-md border font-mono text-xs whitespace-nowrap touch-manipulation select-none flex items-center gap-1.5 transition-colors ${
        prominent
          ? 'px-2.5 bg-violet-500 text-white border-violet-500 hover:bg-violet-400'
          : 'w-9 justify-center bg-panel-bg/70 text-panel-muted border-panel-border/70 hover:text-panel-text'
      }`}
    >
      <Radio className="w-3.5 h-3.5" />
      {prominent && <span>Live</span>}
    </button>
  );
}
