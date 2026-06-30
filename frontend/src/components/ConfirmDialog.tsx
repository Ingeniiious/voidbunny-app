import { useEffect, useRef, type ReactNode } from 'react';
import { motion, type TargetAndTransition } from 'motion/react';

// Deep brand orange — same hex the KeyBar Send button uses as its gradient
// anchor (see KeyBar.tsx). Keeping the confirm CTA on the brand color makes
// destructive actions read as "primary brand action," not "Tailwind orange."
const BRAND_ORANGE = '#c2410c';

// Shared confirm dialog. Used by LogoutDialog (Sidebar) and the tab-close
// flow (Layout). One source of truth for the modal chrome — 3D blur entry,
// click-outside-to-close, equal-width Cancel / Confirm row, no X button.
//
// Layout choices the user asked for:
//   - readable body type (text-sm, not text-xs)
//   - Cancel and Confirm share the bottom row 50/50 via grid-cols-2
//   - no close (X) — Cancel covers that intent

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
    // Defer so the click that *opens* the dialog doesn't immediately close it.
    const t = window.setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('click', handler);
    };
  }, [ref, close]);
}

interface Props {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.showModal();
    return () => { try { el.close(); } catch { /* already closed */ } };
  }, []);

  useClickOutside(ref, onClose);

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
        className="z-[10000] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-panel-border bg-panel-surface p-6 shadow-2xl text-panel-text backdrop:hidden"
      >
        <h2 className="font-mono text-base font-semibold text-panel-text">
          {title}
        </h2>
        <p className="mt-3 text-sm text-panel-muted leading-relaxed break-words">
          {description}
        </p>
        <div className="mt-6 pt-4 border-t border-panel-border grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-mono rounded-md bg-panel-bg border border-panel-border text-panel-muted hover:text-panel-text"
          >
            Cancel
          </button>
          <motion.button
            type="button"
            onClick={onConfirm}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            className="px-4 py-2.5 text-sm font-mono rounded-md text-white shadow-[0_4px_16px_-4px_rgba(194,65,12,0.55)]"
            style={{ backgroundColor: BRAND_ORANGE }}
          >
            {confirmLabel}
          </motion.button>
        </div>
      </motion.dialog>
    </>
  );
}
