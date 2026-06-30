import { Toaster as SonnerToaster } from 'sonner';

// Wraps sonner's <Toaster /> with the panel theme. We don't use next-themes
// (that's a Next.js-only package); the project toggles `.dark` on <html>
// directly, and the panel-* CSS vars do the rest.
//
// mobileOffset adds `env(safe-area-inset-top)` so the toast clears the iOS
// status bar / dynamic island when the PWA runs in standalone mode —
// without it the toast renders behind the system chrome and is invisible.
// Tablets and desktop keep the regular 16px offset via `offset`.
export default function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      closeButton
      richColors={false}
      offset={16}
      mobileOffset={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      style={{ zIndex: 9999 }}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            'group toast !bg-panel-surface !text-panel-text !border-panel-border !rounded-lg !shadow-lg !font-sans',
          description: '!text-panel-muted',
          actionButton: '!bg-panel-text !text-panel-bg',
          cancelButton: '!bg-panel-border !text-panel-text',
          closeButton: '!bg-panel-surface !border-panel-border !text-panel-muted',
          success: '!border-emerald-500/40',
          error: '!border-red-500/40',
        },
      }}
    />
  );
}
