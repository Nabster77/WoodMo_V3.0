// Tablet: Die Bildschirmtastatur soll nur erscheinen, wenn der Nutzer ein Eingabefeld selbst antippt.
// Wird ein Feld automatisch fokussiert (z. B. Anmeldefenster), bleibt die Tastatur zu, bis das Feld angetippt wird.
const TEXTLIKE = new Set(['text', 'password', 'search', 'email', 'tel', 'url', 'number', '']);

export function installKeyboardOnTap(): () => void {
  let lastUser = 0;
  const mark = () => { lastUser = Date.now(); };
  const onFocusIn = (event: FocusEvent) => {
    const el = event.target as HTMLElement | null;
    if (!el) return;
    const isInput = el instanceof HTMLInputElement ? TEXTLIKE.has(el.type) : el instanceof HTMLTextAreaElement;
    if (!isInput) return;
    if (Date.now() - lastUser < 800) return; // vom Nutzer angetippt oder per Taste
    const original = el.getAttribute('inputmode');
    el.setAttribute('inputmode', 'none');
    const release = () => {
      if (original === null) el.removeAttribute('inputmode'); else el.setAttribute('inputmode', original);
      el.removeEventListener('pointerdown', release);
      el.removeEventListener('blur', onBlur);
      window.setTimeout(() => { el.blur(); el.focus(); }, 0);
    };
    const onBlur = () => {
      if (original === null) el.removeAttribute('inputmode'); else el.setAttribute('inputmode', original);
      el.removeEventListener('pointerdown', release);
      el.removeEventListener('blur', onBlur);
    };
    el.addEventListener('pointerdown', release);
    el.addEventListener('blur', onBlur);
  };
  document.addEventListener('pointerdown', mark, true);
  document.addEventListener('touchstart', mark, true);
  document.addEventListener('keydown', mark, true);
  document.addEventListener('focusin', onFocusIn);
  return () => {
    document.removeEventListener('pointerdown', mark, true);
    document.removeEventListener('touchstart', mark, true);
    document.removeEventListener('keydown', mark, true);
    document.removeEventListener('focusin', onFocusIn);
  };
}
