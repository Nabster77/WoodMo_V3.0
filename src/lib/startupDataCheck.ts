import { readPendingOutbox } from './outbox';
import { STORAGE_KEYS } from './storage';
import { stableStringify } from './catalogSync';

function readCollection(key: string, label: string): Array<{ id: string }> {
  const raw = localStorage.getItem(key);
  if (raw === null) return [];
  let data: unknown;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`${label} sind lokal nicht lesbar.`); }
  if (!Array.isArray(data)) throw new Error(`${label} haben ein unerwartetes Format.`);
  const ids = new Set<string>();
  for (const item of data) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) {
      throw new Error(`${label} enthalten fehlende oder doppelte Kennungen.`);
    }
    ids.add(item.id);
  }
  return data;
}

export async function startupCashDigest(): Promise<string> {
  const sortById = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  const bookings = readCollection(STORAGE_KEYS.transactions, 'Buchungen').sort(sortById);
  const sessions = readCollection(STORAGE_KEYS.cashSessions, 'Kassensitzungen').sort(sortById);
  const data = new TextEncoder().encode(stableStringify({ bookings, sessions }));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Local storage and the pending queue are inspected without a cloud sync. */
export async function checkStartupData(): Promise<void> {
  readCollection(STORAGE_KEYS.transactions, 'Buchungen');
  readCollection(STORAGE_KEYS.cashSessions, 'Kassensitzungen');
  readCollection(STORAGE_KEYS.products, 'Artikel');
  readCollection(STORAGE_KEYS.categories, 'Warengruppen');
  readCollection(STORAGE_KEYS.staffUsers, 'Mitarbeitereinträge');

  const queued = await readPendingOutbox().catch(() => {
    throw new Error('Die Warteschlange für noch nicht synchronisierte Vorgänge konnte nicht gelesen werden.');
  });
  if (queued.some(entry => !entry?.row || typeof entry.row.id !== 'string' || !entry.row.id.trim() ||
    (entry.table !== 'pos_transactions' && entry.table !== 'pos_cash_sessions'))) {
    throw new Error('Die Warteschlange enthält einen fehlerhaften Buchungs- oder Kassen­eintrag.');
  }
}
