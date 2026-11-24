import type { OutboxEntry } from '@/lib/outbox';

export type ResetQuarantineEntry = {
  key: string;
  archivedAt: number;
  targetGeneration: number;
  /** superseded-session (24.11.): offener Kassenstand, den die Cloud bereits
   * abgeschlossen hat. Reine Kopie, kein nicht übertragener Beleg. */
  kind: 'pending-outbox' | 'local-snapshot' | 'superseded-session';
  entry?: OutboxEntry;
  transactions?: unknown[];
  cashSessions?: unknown[];
};

/** A reset generation supersedes ALL earlier queued writes, even those with
 * a local device timestamp later than the server reset. Missing generations
 * are legacy entries and must also be preserved rather than discarded. */
export function isStaleOutboxEntry(entry: OutboxEntry, generation: number): boolean {
  return !Number.isInteger(entry.row.booking_generation) ||
    entry.row.booking_generation < generation;
}

/** When may the operator delete the local reset archive?
 * - Only local snapshots: copies of data that was already in the Cloud when
 *   the reset happened (the Cloud reset keeps old generations, it deletes
 *   nothing). A `pending-outbox` record may be the ONLY copy of a receipt that
 *   never reached the Cloud, so its presence always blocks deletion.
 * - Only exactly the records the operator exported before. A record archived
 *   after the export must not disappear unseen. */
export function canClearResetQuarantine(
  entries: readonly ResetQuarantineEntry[],
  exportedKeys: readonly string[] | null,
): { ok: true } | { ok: false; reason: string } {
  if (entries.length === 0) return { ok: false, reason: 'Die Offline-Quarantäne ist bereits leer.' };
  if (entries.some(record => record.kind === 'pending-outbox')) {
    return { ok: false, reason: 'Löschen gesperrt: Die Quarantäne enthält nicht übertragene Bons oder Kassensitzungen. Diese zuerst prüfen lassen.' };
  }
  if (!exportedKeys) {
    return { ok: false, reason: 'Bitte zuerst „Offline-Quarantäne sichern“ ausführen und die Datei aufbewahren.' };
  }
  const exported = new Set(exportedKeys);
  if (exported.size !== entries.length || entries.some(record => !exported.has(record.key))) {
    return { ok: false, reason: 'Seit dem letzten Sichern hat sich die Quarantäne geändert. Bitte erneut sichern.' };
  }
  return { ok: true };
}

export function summarizeResetQuarantine(entries: readonly ResetQuarantineEntry[]) {
  const pendingReceiptIds = new Set<string>();
  const pendingSessionIds = new Set<string>();
  let localSnapshotCount = 0;
  let localReceiptCount = 0;
  for (const record of entries) {
    if (record.kind === 'pending-outbox' && record.entry) {
      if (record.entry.table === 'pos_transactions') pendingReceiptIds.add(record.entry.row.id);
      if (record.entry.table === 'pos_cash_sessions') pendingSessionIds.add(record.entry.row.id);
    }
    if (record.kind === 'local-snapshot') {
      localSnapshotCount++;
      localReceiptCount += record.transactions?.length ?? 0;
    }
  }
  return {
    pendingReceipts: pendingReceiptIds.size,
    pendingSessions: pendingSessionIds.size,
    localSnapshots: localSnapshotCount,
    localReceipts: localReceiptCount,
    archivedEntries: entries.length,
  };
}
