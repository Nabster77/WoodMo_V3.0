// Doppelklick auf eine freie Fläche der installierten App schaltet zwischen Vollbild und Normalansicht um.
// Nur in der installierten App (Standalone/Fenster-Ansicht) oder wenn schon Vollbild aktiv ist. Doppelklicks auf
// Buttons, Felder, Links, Listen und Dialoge werden ignoriert, damit schnelles Tippen (z. B. Menge +) nie umschaltet.
const INTERACTIVE = 'button, a, input, select, textarea, label, summary, [role="button"], [role="dialog"], [role="menu"], [role="listbox"], [contenteditable="true"], table, [data-no-fullscreen-toggle]';

function installedAppView(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: window-controls-overlay)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

export function installFullscreenToggle(): () => void {
  const onDoubleClick = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const target = event.target as Element | null;
    if (!target || (target.closest && target.closest(INTERACTIVE))) return;
    const active = !!document.fullscreenElement;
    if (!active && !installedAppView()) return;
    try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    if (active) {
      void document.exitFullscreen().catch(() => undefined);
    } else if (document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    }
  };
  document.addEventListener('dblclick', onDoubleClick);
  return () => document.removeEventListener('dblclick', onDoubleClick);
}
