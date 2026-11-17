/**
 * Update-Zentrale: zeigt die installierte und die online bereitliegende Version,
 * prüft vor dem Update den Zustand dieses Geräts und hält einen Vorher-Stand fest,
 * damit nach dem Neustart ein Prüfbericht entstehen kann.
 *
 * Der eigentliche Update-Weg bleibt der bewährte des Service-Workers: Die neue
 * Version wird vollständig im Hintergrund geladen und erst danach aktiv. Bricht
 * die Verbindung ab, bleibt die bisherige Version unverändert in Betrieb.
 * Es werden keine Kassendaten verändert und nichts in die Cloud geschrieben.
 */
import type { CashSession, Transaction } from '@/types';

export interface BuildInfo { commit: string; builtAt: string; title: string; notes: string[] }

const FALLBACK: BuildInfo = { commit: 'unbekannt', builtAt: '', title: '', notes: [] };
export const INSTALLED_BUILD: BuildInfo =
  typeof __WOODMO_BUILD__ !== 'undefined' ? __WOODMO_BUILD__ : FALLBACK;

export const LAST_BACKUP_KEY = 'woodmo_last_backup_export_v1';
export const UPDATE_CHECK_KEY = 'woodmo_update_check_v1';

export function sameBuild(a: BuildInfo, b: BuildInfo): boolean {
  return a.commit === b.commit && a.builtAt === b.builtAt;
}

export function buildLabel(info: BuildInfo): string {
  if (!info.builtAt) return info.commit;
  const at = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(info.builtAt));
  return `${at} Uhr · ${info.commit}`;
}

/** Liest version.json direkt vom Server, am Zwischenspeicher vorbei. */
export async function fetchOnlineBuild(timeoutMs = 10_000): Promise<BuildInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const base = import.meta.env?.BASE_URL ?? '/';
    const response = await fetch(`${base}version.json?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json() as Partial<BuildInfo>;
    if (typeof data.commit !== 'string' || typeof data.builtAt !== 'string') return null;
    return { commit: data.commit, builtAt: data.builtAt, title: String(data.title ?? ''),
      notes: Array.isArray(data.notes) ? data.notes.map(String) : [] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function lastBackupExport(): number | null {
  try {
    const value = Number(localStorage.getItem(LAST_BACKUP_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function markBackupExported(at = Date.now()): void {
  try { localStorage.setItem(LAST_BACKUP_KEY, String(at)); } catch { /* nur Hinweis, nie blockierend */ }
}

/** Datenstand dieses Geräts, für den Vorher/Nachher-Vergleich. */
export interface DataFingerprint {
  receipts: number;
  sessions: number;
  closedSessions: number;
  totalCents: number;
}

export function fingerprint(transactions: readonly Transaction[], sessions: readonly CashSession[]): DataFingerprint {
  return {
    receipts: transactions.length,
    sessions: sessions.length,
    closedSessions: sessions.filter((session) => session.closed).length,
    totalCents: transactions.reduce((sum, tx) => sum + Math.round((Number(tx.total) || 0) * 100), 0),
  };
}

export function sameFingerprint(a: DataFingerprint, b: DataFingerprint): boolean {
  return a.receipts === b.receipts && a.sessions === b.sessions &&
    a.closedSessions === b.closedSessions && a.totalCents === b.totalCents;
}

export interface UpdateCheck { from: BuildInfo; startedAt: number; before: DataFingerprint; expectUpdate: boolean }

export function saveUpdateCheck(check: UpdateCheck): void {
  try { localStorage.setItem(UPDATE_CHECK_KEY, JSON.stringify(check)); } catch { /* Bericht ist optional */ }
}

export function readUpdateCheck(): UpdateCheck | null {
  try {
    const raw = localStorage.getItem(UPDATE_CHECK_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as UpdateCheck;
    if (!value?.from || !value.before || typeof value.startedAt !== 'number') return null;
    return { ...value, expectUpdate: value.expectUpdate !== false };
  } catch {
    return null;
  }
}

export function clearUpdateCheck(): void {
  try { localStorage.removeItem(UPDATE_CHECK_KEY); } catch { /* egal */ }
}

export type UpdateStep = 'suchen' | 'laden' | 'neustart';

function waitForActivation(worker: ServiceWorker, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (worker.state === 'activated') { resolve(); return; }
    const timer = setTimeout(() => {
      worker.removeEventListener('statechange', onChange);
      reject(new Error('Zeitüberschreitung beim Laden der neuen Version.'));
    }, timeoutMs);
    function onChange() {
      if (worker.state === 'activated') { clearTimeout(timer); worker.removeEventListener('statechange', onChange); resolve(); }
      if (worker.state === 'redundant') {
        clearTimeout(timer); worker.removeEventListener('statechange', onChange);
        reject(new Error('Das Laden der neuen Version wurde abgebrochen.'));
      }
    }
    worker.addEventListener('statechange', onChange);
  });
}

/**
 * Lädt die neue Version über den Service-Worker vollständig und startet die App neu.
 * Wirft bei Abbruch einen Fehler; die bisherige Version bleibt dann aktiv.
 */
export async function installUpdate(onStep: (step: UpdateStep) => void, reload: () => void = () => window.location.reload()): Promise<void> {
  onStep('suchen');
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (registration) {
    await registration.update();
    const worker = registration.installing ?? registration.waiting;
    if (worker) {
      onStep('laden');
      if (worker.state === 'installed') worker.postMessage({ type: 'SKIP_WAITING' });
      await waitForActivation(worker, 180_000);
    }
  }
  onStep('neustart');
  await new Promise((resolve) => setTimeout(resolve, 600));
  reload();
}
