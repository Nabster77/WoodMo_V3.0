// Schrittweiser Fortschritt für Backup-Import. Die Datenbank liefert beim
// großen atomaren Schreiben keinen Zwischenstand; deshalb zählt der Balken
// ABGESCHLOSSENE Schritte und zeigt den laufenden Schritt ehrlich an.
export const RESTORE_STEPS = [
  'Backup prüfen',
  'Cloud-Stand prüfen',
  'Buchungen, Sitzungen und Stornos schreiben',
  'Gegenprüfung der geschriebenen Daten',
  'Mitarbeiter, Artikel, Einstellungen und Archiv',
] as const;

export type RestoreProgress = { done: number; total: number; label: string; failed?: string } | null;

let current: RestoreProgress = null;
const listeners = new Set<(p: RestoreProgress) => void>();

function emit(next: RestoreProgress) {
  current = next;
  listeners.forEach(fn => fn(next));
}
/** Schritt `index` (0-basiert) läuft jetzt; alle davor sind abgeschlossen. */
export function restoreStepRunning(index: number) {
  emit({ done: index, total: RESTORE_STEPS.length, label: RESTORE_STEPS[index] });
}
export function restoreFinished() {
  emit({ done: RESTORE_STEPS.length, total: RESTORE_STEPS.length, label: 'Fertig' });
  window.setTimeout(() => { if (current?.done === RESTORE_STEPS.length) emit(null); }, 800);
}
export function restoreFailed(message: string) {
  emit({ done: current?.done ?? 0, total: RESTORE_STEPS.length, label: current?.label ?? '', failed: message });
}
export function restoreClear() { emit(null); }
export function subscribeRestoreProgress(fn: (p: RestoreProgress) => void) {
  listeners.add(fn); fn(current);
  return () => { listeners.delete(fn); };
}
