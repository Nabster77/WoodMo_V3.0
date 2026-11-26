/**
 * Ersetzt window.alert durch ein Meldungsfenster im Graphit-Design (nur Optik).
 * Mehrere Meldungen werden nacheinander angezeigt. Rückgabe wie bei alert: keine.
 * window.confirm bleibt unverändert (braucht synchrone Antwort).
 */
const queue: string[] = [];
let showing = false;

function showNext(): void {
  const message = queue.shift();
  if (message === undefined) { showing = false; return; }
  showing = true;
  const previousFocus = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  const panel = document.createElement('div');
  panel.className = 'gx-panel w-full max-w-sm rounded-3xl p-5';
  const title = document.createElement('p');
  title.className = 'gx-heading mb-2 text-xs font-bold uppercase tracking-[.12em]';
  title.textContent = 'WOODMO';
  const text = document.createElement('p');
  text.className = 'gx-text max-h-[60vh] overflow-y-auto whitespace-pre-line text-base font-semibold';
  text.textContent = message;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gx-btn gx-btn-pri mt-5 min-h-12 w-full rounded-xl px-4 text-base font-bold';
  button.textContent = 'OK';
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    previousFocus?.focus?.();
    showNext();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  };
  button.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  panel.append(title, text, button);
  overlay.append(panel);
  document.body.append(overlay);
  button.focus();
}

export function installStyledAlert(): void {
  if (typeof window === 'undefined') return;
  window.alert = (message?: unknown) => {
    queue.push(String(message ?? ''));
    if (!showing) showNext();
  };
}
