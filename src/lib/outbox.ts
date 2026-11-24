import { supabase } from '@/lib/supabaseClient';
import { canClearResetQuarantine, isStaleOutboxEntry, summarizeResetQuarantine, type ResetQuarantineEntry } from '@/lib/resetQuarantine';
import { mirrorOfflineEntries } from '@/lib/offlineBackup';

const DB_NAME = 'tablet-kasse-sync';
const STORE = 'outbox';
const QUARANTINE_STORE = 'resetQuarantine';
export const RESET_QUARANTINE_EVENT = 'woodmo-reset-quarantine-updated';
const BATCH_SIZE = 100;

export type CloudTable = 'pos_transactions' | 'pos_cash_sessions';

export interface OutboxEntry {
  table: CloudTable;
  row: { id: string; booking_generation: number } & Record<string, unknown>;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let flushing: Promise<number> | null = null;
// During a remote generation switch, new queue writes from a late React
// effect must also be archived. The fence prevents an in-flight checkout from
// re-adding obsolete receipts after the first quarantine transaction commits.
let resetFenceGeneration = -1;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { autoIncrement: true });
      }
      if (!request.result.objectStoreNames.contains(QUARANTINE_STORE)) {
        request.result.createObjectStore(QUARANTINE_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(
      'Offline-Archiv kann nicht geöffnet werden: Bitte andere WOODMO-Tabs auf diesem Gerät schließen und die App neu öffnen.'
    ));
  });
  return dbPromise;
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function enqueueEntries(entries: OutboxEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await openDb();
  const fence = resetFenceGeneration;
  const hasStale = entries.some(entry => fence >= 0 && isStaleOutboxEntry(entry, fence));
  const tx = db.transaction(hasStale ? [STORE, QUARANTINE_STORE] : STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const quarantine = hasStale ? tx.objectStore(QUARANTINE_STORE) : null;
  const when = Date.now();
  for (const entry of entries) {
    if (quarantine && isStaleOutboxEntry(entry, fence)) {
      quarantine.put({
        key: 'late:' + crypto.randomUUID(),
        archivedAt: when, targetGeneration: fence, kind: 'pending-outbox', entry,
      } satisfies ResetQuarantineEntry);
    } else store.add(entry);
  }
  await transactionDone(tx);
  if (hasStale) window.dispatchEvent(new Event(RESET_QUARANTINE_EVENT));
  void mirrorPendingEntries(entries.filter(entry => !hasStale || !isStaleOutboxEntry(entry, fence)));
}

async function mirrorPendingEntries(entries: readonly OutboxEntry[]): Promise<void> {
  try { await mirrorOfflineEntries(entries); }
  catch { /* The durable browser queue remains available if the folder fails. */ }
}

export async function backUpPendingOutbox(): Promise<void> {
  await mirrorPendingEntries(await readPendingOutbox());
}

// A confirmed backup restore replaces the booking snapshot.  Queued changes
// from before that restore must not be uploaded afterwards.
export async function clearOutbox(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await transactionDone(tx);
}

// An older-generation queue is never silently deleted. Moving records to a
// durable local archive and deleting their old upload requests happen in ONE
// IndexedDB transaction; if archiving fails, the queue is unchanged and the
// generation switch must fail closed. Old records cannot be uploaded into the
// new generation without a separate administrator recovery procedure.
export async function quarantineEntriesBeforeGeneration(
  generation: number,
  localSnapshot?: { transactions: readonly unknown[]; cashSessions: readonly unknown[] },
): Promise<void> {
  if (!Number.isInteger(generation) || generation < 0) throw new Error('Ungültige Buchungsgeneration.');
  resetFenceGeneration = Math.max(resetFenceGeneration, generation);
  const db = await openDb();
  const tx = db.transaction([STORE, QUARANTINE_STORE], 'readwrite');
  const outbox = tx.objectStore(STORE);
  const quarantine = tx.objectStore(QUARANTINE_STORE);
  const archivedAt = Date.now();

  // Protect against a React-state/outbox enqueue race: the complete local
  // snapshot is additionally retained, even when no pending queue row exists.
  if (localSnapshot && (localSnapshot.transactions.length || localSnapshot.cashSessions.length)) {
    const record: ResetQuarantineEntry = {
      key: 'snapshot:generation-' + generation,
      archivedAt, targetGeneration: generation, kind: 'local-snapshot',
      transactions: [...localSnapshot.transactions],
      cashSessions: [...localSnapshot.cashSessions],
    };
    quarantine.put(record);
  }

  const req = outbox.openCursor();
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    const entry = cursor.value as OutboxEntry;
    if (isStaleOutboxEntry(entry, generation)) {
      const record: ResetQuarantineEntry = {
        key: 'outbox:' + String(cursor.primaryKey),
        archivedAt, targetGeneration: generation,
        kind: 'pending-outbox', entry,
      };
      quarantine.put(record);
      cursor.delete();
    }
    cursor.continue();
  };
  req.onerror = () => tx.abort();
  await transactionDone(tx);
  window.dispatchEvent(new Event(RESET_QUARANTINE_EVENT));
}

// Kept as a compatibility alias for existing reset/restore callers.
// It now archives stale rows atomically instead of destroying them.
export async function discardEntriesBeforeGeneration(generation: number): Promise<void> {
  await quarantineEntriesBeforeGeneration(generation);
}

export async function readResetQuarantine(): Promise<ResetQuarantineEntry[]> {
  const db = await openDb();
  const tx = db.transaction(QUARANTINE_STORE, 'readonly');
  const request = tx.objectStore(QUARANTINE_STORE).getAll();
  await transactionDone(tx);
  return request.result as ResetQuarantineEntry[];
}

export async function readResetQuarantineSummary() {
  return summarizeResetQuarantine(await readResetQuarantine());
}

/** No automatic deletion of quarantined records. The operator can download
 * the original queued rows and full local snapshots for an audited review.
 * Returns the keys of the exported records (needed before any deletion). */
export async function exportResetQuarantine(): Promise<string[]> {
  const entries = await readResetQuarantine();
  if (!entries.length) throw new Error('Keine archivierten Offline-Buchungen gefunden.');
  const json = JSON.stringify({
    type: 'woodmo-v3-offline-reset-quarantine',
    version: 1, exportedAt: new Date().toISOString(),
    summary: summarizeResetQuarantine(entries),
    entries,
  }, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'woodmo-offline-quarantaene-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return entries.map(record => record.key);
}

/** Operator-confirmed deletion of the local reset archive (never automatic).
 * Touches ONLY the quarantine store; the upload queue (`outbox`) with
 * not-yet-sent bookings is never opened for writing here. The rule is
 * re-checked inside the same IndexedDB transaction that deletes. */
export async function clearResetQuarantine(exportedKeys: readonly string[]): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(QUARANTINE_STORE, 'readwrite');
  const store = tx.objectStore(QUARANTINE_STORE);
  let refusal: string | null = null;
  let deleted = 0;
  const request = store.getAll();
  // Check and delete synchronously inside the success callback, so the
  // transaction is guaranteed to still be active in every browser.
  request.onsuccess = () => {
    const entries = request.result as ResetQuarantineEntry[];
    const verdict = canClearResetQuarantine(entries, exportedKeys);
    if (!verdict.ok) {
      refusal = verdict.reason;
      tx.abort();
      return;
    }
    for (const record of entries) store.delete(record.key);
    deleted = entries.length;
  };
  request.onerror = () => tx.abort();
  try {
    await transactionDone(tx);
  } catch (cause) {
    if (refusal) throw new Error(refusal);
    throw cause instanceof Error ? cause : new Error('Offline-Quarantäne konnte nicht gelöscht werden.');
  }
  window.dispatchEvent(new Event(RESET_QUARANTINE_EVENT));
  return deleted;
}

// Uploads the oldest queued entries and removes them once the cloud has them.
// Returns how many queue entries were processed; throws when the upload fails.
export function flushOutbox(): Promise<number> {
  if (!flushing) {
    const upload = navigator.locks
      ? navigator.locks.request('woodmo-outbox-upload', uploadQueuedBatch)
      : uploadQueuedBatch();
    flushing = upload.finally(() => { flushing = null; });
  }
  return flushing;
}

async function uploadQueuedBatch(): Promise<number> {
  if (!supabase) return 0;
  const db = await openDb();

  const readTx = db.transaction(STORE, 'readonly');
  const store = readTx.objectStore(STORE);
  const keysRequest = store.getAllKeys(null, BATCH_SIZE);
  const entriesRequest = store.getAll(null, BATCH_SIZE);
  await transactionDone(readTx);

  const keys = keysRequest.result;
  const entries = entriesRequest.result as OutboxEntry[];
  if (keys.length === 0) return 0;
  await mirrorPendingEntries(entries);

  const latestByTable = new Map<CloudTable, Map<string, OutboxEntry['row']>>();
  for (const entry of entries) {
    let rows = latestByTable.get(entry.table);
    if (!rows) {
      rows = new Map();
      latestByTable.set(entry.table, rows);
    }
    rows.set(entry.row.id, entry.row);
  }

  // Never upload a new active till if the cloud already holds a different
  // active till at that location. Prevent partial uploads of sales first.
  // Conflicting offline records remain queued for explicit reconciliation.
  const queuedSessions = [...(latestByTable.get('pos_cash_sessions')?.values() ?? [])];
  const active = (row: OutboxEntry['row']) => {
    const session = row.data as Record<string, unknown> | undefined;
    return session && session.closed !== true && session.discarded !== true &&
      !session.closedAt && !session.dailyCloseFinalizedAt && !session.dailyCloseSnapshot;
  };
  const openingSessions = queuedSessions.filter(active);
  // 24.11.: Ein offener Kassenstand, den die Cloud für DIESELBE Kasse bereits
  // abgeschlossen hat, ist überholt (z. B. alter Browser-Tab). Er darf die
  // Warteschlange nicht blockieren: ins Archiv („überholt“), nicht löschen,
  // nicht hochladen. Buchungen dieser Kasse werden normal weiter hochgeladen.
  if (openingSessions.length) {
    const { data: sameCloud, error: sameError } = await supabase
      .from('pos_cash_sessions')
      .select('id,data')
      .in('id', openingSessions.map((row) => row.id));
    if (sameError) throw sameError;
    const closedInCloud = new Set((sameCloud ?? [])
      .filter((row) => !active({ id: row.id, booking_generation: 0, location: '', data: row.data }))
      .map((row) => row.id as string));
    if (closedInCloud.size) {
      const tx = db.transaction([STORE, QUARANTINE_STORE], 'readwrite');
      const store = tx.objectStore(STORE);
      const quarantine = tx.objectStore(QUARANTINE_STORE);
      const when = Date.now();
      entries.forEach((entry, index) => {
        if (entry.table !== 'pos_cash_sessions' || !closedInCloud.has(entry.row.id) || !active(entry.row)) return;
        quarantine.put({
          key: 'superseded:' + crypto.randomUUID(), archivedAt: when,
          targetGeneration: Number(entry.row.booking_generation) || 0, kind: 'superseded-session', entry,
        } satisfies ResetQuarantineEntry);
        store.delete(keys[index]);
      });
      await transactionDone(tx);
      window.dispatchEvent(new Event(RESET_QUARANTINE_EVENT));
      // Diesen Durchlauf neu beginnen, damit nur die verbliebenen Einträge zählen.
      return uploadQueuedBatch();
    }
  }
  if (openingSessions.length) {
    const locations = [...new Set(openingSessions.map((row) => String(row.location)))];
    const generation = openingSessions[0].booking_generation;
    if (openingSessions.some((row) => row.booking_generation !== generation)) {
      throw new Error('Unterschiedliche Buchungs-Generationen in der Offline-Warteschlange. Reset-Abgleich erforderlich.');
    }
    const { data: cloudSessions, error: readError } = await supabase
      .from('pos_cash_sessions')
      .select('id,location,data')
      .eq('booking_generation', generation)
      .in('location', locations)
      .eq('data->>closed', 'false');
    if (readError) throw readError;
    for (const opening of openingSessions) {
      const otherLocal = openingSessions.find((row) => row.id !== opening.id && row.location === opening.location);
      if (otherLocal) {
        throw new Error(`Zwei verschiedene lokale Kassenöffnungen für ${opening.location}. Keine Daten wurden verworfen.`);
      }
      // Only a different open till at the SAME location is a conflict. Friedrichshafen
      // and Bregenz are open at the same time; the cloud query covers all queued locations.
      const otherCloud = (cloudSessions ?? []).find((row) =>
        row.id !== opening.id && row.location === opening.location &&
        active({ id: row.id, booking_generation: generation, location: row.location, data: row.data }));
      if (otherCloud) {
        // A queued close of the old cloud till can legitimately precede the
        // new opening. The close is uploaded first, then the new opening.
        const queuedClose = queuedSessions.find((row) => row.id === otherCloud.id && !active(row));
        if (!queuedClose) {
          throw new Error(`Kassenkonflikt in ${opening.location}: Cloud-Kasse ${otherCloud.id} ist noch offen. Die neue lokale Kasse ${opening.id} bleibt offline gespeichert. Bitte nicht löschen; bestehenden Kassenstatus abgleichen.`);
        }
      }
    }
  }

  // Sessions must be acknowledged before their sales (and before a new
  // session can be safely used on another device).
  for (const table of ['pos_cash_sessions', 'pos_transactions'] as const) {
    const rows = latestByTable.get(table);
    if (!rows?.size) continue;
    const { data, error } = await supabase.from(table).upsert([...rows.values()], { onConflict: 'id' }).select('id');
    if (error) throw error;
    const confirmed = new Set(data?.map(row => row.id));
    if ([...rows.keys()].some(id => !confirmed.has(id))) {
      throw new Error('Die KassenCloud hat nicht alle übertragenen Vorgänge bestätigt.');
    }
    const deleteTx = db.transaction(STORE, 'readwrite');
    const deleteStore = deleteTx.objectStore(STORE);
    entries.forEach((entry, index) => { if (entry.table === table) deleteStore.delete(keys[index]); });
    await transactionDone(deleteTx);
  }

  return keys.length;
}

/**
 * Explicit recovery of a duplicate, unused local till. This does not touch
 * cloud data and never drops receipts. All queued snapshots of the opening
 * must be financially empty; otherwise recovery is refused.
 * The caller must have archived the snapshot BEFORE calling this function.
 */
export async function removeQueuedUnusedCashSession(
  localSessionId: string,
  location: string,
  openedAt: number,
): Promise<OutboxEntry[]> {
  const db = await openDb();
  const read = db.transaction(STORE, 'readonly');
  const keysRequest = read.objectStore(STORE).getAllKeys();
  const entriesRequest = read.objectStore(STORE).getAll();
  await transactionDone(read);
  const keys = keysRequest.result;
  const entries = entriesRequest.result as OutboxEntry[];
  const relevant = entries.filter((entry) =>
    entry.table === 'pos_cash_sessions' && entry.row.id === localSessionId);

  const unsafeReceipt = entries.some((entry) => entry.table === 'pos_transactions' &&
    (entry.row.data as { cashSessionId?: string; timestamp?: number; location?: string } | undefined)?.cashSessionId === localSessionId);
  if (unsafeReceipt) throw new Error('Es gibt noch nicht hochgeladene Verkäufe zu dieser Kasse. Automatische Übernahme gesperrt.');
  // Legacy sales without a session ID cannot be safely reassigned either.
  const legacyReceipt = entries.some((entry) => {
    if (entry.table !== 'pos_transactions') return false;
    const data = entry.row.data as { cashSessionId?: string; timestamp?: number; location?: string } | undefined;
    return data?.location === location && !data.cashSessionId && typeof data.timestamp === 'number' && data.timestamp >= openedAt;
  });
  if (legacyReceipt) throw new Error('Alte, noch nicht synchronisierte Verkäufe erkannt. Übernahme gesperrt.');

  const hasMovements = (entry: OutboxEntry) => {
    const data = entry.row.data as { entries?: unknown[]; corrections?: unknown[];
      closingWithdrawalAmount?: number; dailyCloseSnapshot?: unknown; closed?: boolean;
      activities?: Array<{ type?: string }> } | undefined;
    return !data || (data.entries?.length ?? 0) > 0 || (data.corrections?.length ?? 0) > 0 ||
      Boolean(data.closingWithdrawalAmount || data.dailyCloseSnapshot || data.closed) ||
      (data.activities ?? []).some((activity) => !['cash_opened', 'login', 'logout'].includes(activity.type ?? ''));
  };
  if (relevant.some(hasMovements)) {
    throw new Error('Die lokale Offline-Warteschlange enthält Kassenbewegungen. Übernahme gesperrt.');
  }
  if (!relevant.length) return [];
  const transaction = db.transaction(STORE, 'readwrite');
  const store = transaction.objectStore(STORE);
  entries.forEach((entry, index) => {
    if (entry.table === 'pos_cash_sessions' && entry.row.id === localSessionId) store.delete(keys[index]);
  });
  await transactionDone(transaction);
  return relevant;
}

/** Read-only snapshot of pending entries for an explicit, verified backup. */
export async function readPendingOutbox(): Promise<OutboxEntry[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const request = tx.objectStore(STORE).getAll();
  await transactionDone(tx);
  return request.result as OutboxEntry[];
}
