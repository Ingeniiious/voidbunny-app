// Touch-capable detection that catches iPad too. iPadOS Safari reports a
// "Mac" UA and matchMedia `(hover: none) and (pointer: coarse)` doesn't
// always trip on tablet-class devices — so we combine three signals: a
// coarse pointer query, a non-zero touch-point count, and a phone/tablet
// UA fallback. A laptop with a touchscreen will also match; that's
// intentional — the touch-specific UI (KeyBar, close confirmation) is
// dismissible/collapsible so the trade-off is acceptable.
export function isTouchCapable(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  const nav = window.navigator;
  const points = (nav as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  if (points > 0) return true;
  return /iPad|iPhone|iPod|Android/.test(nav.userAgent || '');
}
