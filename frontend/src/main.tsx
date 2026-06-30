import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import '@xterm/xterm/css/xterm.css';
import { applyTheme, getTheme } from './lib/theme';

applyTheme(getTheme());

// Service worker handles Web Push delivery + notification clicks. Registering
// from `load` (instead of inline) keeps it off the critical-path so a slow
// SW install doesn't stall the first paint.
//
// updateViaCache: 'none' + reg.update() bypasses iOS Safari's aggressive
// "serve the cached SW for days" behaviour — without this, a deploy that
// changes push payload shape silently keeps firing through the old worker.
//
// `controllerchange` reload is gated on `hadController` — i.e. we only force
// a refresh when an *existing* controller was replaced (a real deploy
// update). The first-install case (PWA cold launch with no prior controller,
// which is every iOS launch after the system evicted the SW) also fires
// controllerchange, and reloading there forces iOS WebKit to re-prompt for
// microphone permission since the pre-reload origin grant is discarded.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => reg.update().catch(() => { /* update is best-effort */ }))
      .catch((err) => {
        console.warn('[sw] register failed:', err?.message ?? err);
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
