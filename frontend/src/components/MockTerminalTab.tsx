import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

interface Props {
  content: string;
  cursorBlink?: boolean;
}

// Same xterm setup as TerminalTab, minus the WebSocket / clipboard / select-mode
// plumbing. Used only by MockApp for the `?mock=1` showcase route — writes a
// pre-baked buffer into a real xterm so the rendered output, font, and colors
// match production exactly.
export default function MockTerminalTab({ content, cursorBlink = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const themeFor = (dark: boolean) =>
      dark
        ? {
            background: '#0a0a0d',
            foreground: '#f5f5f7',
            cursor: '#f5f5f7',
            cursorAccent: '#0a0a0d',
            selectionBackground: '#2a2a30',
          }
        : {
            background: '#ffffff',
            foreground: '#0a0a0d',
            cursor: '#0a0a0d',
            cursorAccent: '#ffffff',
            selectionBackground: '#e0e0e6',
          };

    const term = new Terminal({
      theme: themeFor(document.documentElement.classList.contains('dark')),
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      cursorBlink,
      allowProposedApi: true,
      scrollback: 1000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    term.write(content);

    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* ignore */ }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
    };
  }, [content, cursorBlink]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
