import { useCallback, useEffect, useRef, useState } from 'react';
import type { CashSession, Transaction } from '@/types';
import { supabase } from '@/lib/supabaseClient';
import { quarantineEntriesBeforeGeneration, enqueueEntries, flushOutbox, readPendingOutbox, type OutboxEntry } from '@/lib/outbox';
import { loadJSON, saveJSON, STORAGE_KEYS } from '@/lib/storage';
import { markCloudSyncVerified } from '@/lib/backupCheckpoint';
import { fetchCloudData, type CloudData } from '@/lib/cloudPull';
import { fetchLatestBookingReset, knownBookingReset, rememberBookingReset } from '@/lib/bookingReset';
import type { CatalogSyncResult } from '@/lib/catalogEngine';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const PING_INTERVAL_MS = 15_000;
const PING_TIMEOUT_MS = 5_000;
const FLUSH_INTERVAL_MS = 30_000;

export interface SyncResult {
  ok: boolean;
  error?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export async function isReachable(): Promise<boolean> {
  if (!navigator.onLine) return false;
  if (!SUPABASE_URL) return true;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/settings`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    // A reachable server can still reject a credential; the sync reports that separately.
    return response.status < 500;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

function transactionEntry(t: Transaction): OutboxEntry {
  return { table: 'pos_transactions', row: { id: t.id, booking_generation: knownBookingReset().generation, location: t.location, timestamp: t.timestamp, data: t } };
}

function sessionEntry(s: CashSession): OutboxEntry {
  return { table: 'pos_cash_sessions', row: { id: s.id, booking_generation: knownBookingReset().generation, location: s.location, date: s.date, data: s } };
}

interface Snapshot {
  txIds: Set<string>;
  sessions: Map<string, CashSession>;
}

function snapshotOf(transactions: Transaction[], cashSessions: CashSession[]): Snapshot {
  return {
    txIds: new Set(transactions.map((t) => t.id)),
    sessions: new Map(cashSessions.map((s) => [s.id, s])),
  };
}

// Returns whether the app can reach the cloud. The reset marker is always
// reconciled before upload, so an offline queue cannot revive deleted bookings.
async function uploadPendingChanges(reconcileReset: () => Promise<void>, pullCloudData: () => Promise<void>): Promise<SyncResult> {
  try {
    await reconcileReset();
    let processed = await flushOutbox();
    while (processed > 0) processed = await flushOutbox();
    await pullCloudData();
    return { ok: true };
  } catch (err) {
    console.warn('Cloud-Sync pausiert, neuer Versuch folgt automatisch.', err);
    return { ok: false, error: errorMessage(err) };
  }
}

export function useCloudSync(
  transactions: Transaction[],
  cashSessions: CashSession[],
  testMode: boolean,
  onReconnectSynced: () => void,
  mergeCloudData: (cloud: CloudData) => void,
  syncCatalog: () => Promise<CatalogSyncResult>,
  applyCloudBookingReset: (cutoff: number, generationChanged?: boolean) => void,
  firstSetup: boolean,
): {
  online: boolean;
  syncNow: (duringStartup?: boolean) => Promise<SyncResult>;
  downloadBookings: () => Promise<void>;
  pauseSyncForRestore: () => Promise<void>;
  resumeSyncAfterRestore: () => void;
} {
  const [online, setOnline] = useState(navigator.onLine);
  const inFlightRef = useRef<Promise<SyncResult> | null>(null);
  const offlineSinceRef = useRef(false);
  const snapshotRef = useRef<Snapshot | null>(null);
  const newestPulledRef = useRef<number | null>(null);
  // The latest React state is used when a cloud reset arrives during a sync.
  // A closure captured before the network request may omit recently entered sales.
  const financialSnapshotRef = useRef({ transactions, cashSessions });
  financialSnapshotRef.current = { transactions, cashSessions };
  const restorePausedRef = useRef(false);
  const rebaseAfterRestoreRef = useRef(false);
  const onReconnectSyncedRef = useRef(onReconnectSynced);
  onReconnectSyncedRef.current = onReconnectSynced;

  const pullBookings = useCallback(async (preserveExistingSessions = false) => {
    const generation = knownBookingReset().generation;
    // A full pull includes receipts uploaded by another device after an offline period.
    const cloud = await fetchCloudData(null, generation);
    const pending = await readPendingOutbox();
    if (cloud.generation !== knownBookingReset().generation || restorePausedRef.current || rebaseAfterRestoreRef.current) {
      throw new Error('Der Kassenstand hat sich geändert. Bitte den Download erneut starten.');
    }
    const pendingSessionIds = pending.filter(entry => entry.table === 'pos_cash_sessions' &&
      entry.row.booking_generation === generation).map(entry => entry.row.id);
    if (preserveExistingSessions) {
      pendingSessionIds.push(...financialSnapshotRef.current.cashSessions.map(session => session.id));
    }
    mergeCloudData({ ...cloud, pendingSessionIds });
    if (cloud.newestTransactionTimestamp !== null) {
      newestPulledRef.current = Math.max(newestPulledRef.current ?? 0, cloud.newestTransactionTimestamp);
    }
  }, [mergeCloudData]);

  const downloadBookings = useCallback(async () => {
    if (testMode || !supabase) throw new Error('KassenCloud ist nicht verfügbar.');
    const latestReset = await fetchLatestBookingReset();
    const known = knownBookingReset();
    if (latestReset && (latestReset.generation > known.generation || latestReset.resetAt > known.resetAt)) {
      if (!firstSetup || financialSnapshotRef.current.transactions.length || financialSnapshotRef.current.cashSessions.length ||
        (await readPendingOutbox()).length > 0) {
        throw new Error('Der Kassenstand wird noch abgeglichen. Bitte den Download später erneut starten.');
      }
      rememberBookingReset(latestReset);
    }
    // A clean device is downloading rows that the cloud already has. Do not
    // treat them as legacy offline bookings that need an initial upload.
    if (firstSetup && !financialSnapshotRef.current.transactions.length && !financialSnapshotRef.current.cashSessions.length) {
      saveJSON(STORAGE_KEYS.cloudBackfilled, true);
    }
    await pullBookings();
  }, [testMode, firstSetup, pullBookings]);

  const flush = useCallback((duringStartup = false): Promise<SyncResult> => {
    if (firstSetup && !duringStartup) return Promise.resolve({ ok: false, error: 'Bitte zuerst das Geräte-Setup abschließen.' });
    if (!supabase) return Promise.resolve({ ok: false, error: 'Cloud ist nicht konfiguriert.' });
    if (restorePausedRef.current || rebaseAfterRestoreRef.current) {
      return Promise.resolve({ ok: true });
    }
    inFlightRef.current ??= (async () => {
      const catalogResult = await syncCatalog();
      const bookingResult = await uploadPendingChanges(async () => {
      if (testMode) return;
      const latestReset = await fetchLatestBookingReset();
      if (latestReset !== null) {
        const known = knownBookingReset();
        const generationChanged = latestReset.generation > known.generation;
        const resetChanged = generationChanged || latestReset.resetAt > known.resetAt;
        if (resetChanged) {
          // Fix 22.11.: Ein Tablet mit alten, aber vollständig übertragenen Daten
          // (Warteschlange leer, Erst-Upload erledigt) darf den berechtigten Reset
          // übernehmen. Seine lokalen Daten werden unten vorher dauerhaft archiviert
          // (Quarantäne) und NICHT erneut hochgeladen; in der Cloud liegen sie in der
          // alten Generation. Nur echte, noch nicht übertragene Daten blockieren.
          const unsent = (await readPendingOutbox()).length;
          const hasLocal = financialSnapshotRef.current.transactions.length > 0 ||
            financialSnapshotRef.current.cashSessions.length > 0;
          const fullyUploaded = loadJSON<boolean>(STORAGE_KEYS.cloudBackfilled, false);
          if (unsent > 0 || (hasLocal && !fullyUploaded)) {
            throw new Error(unsent > 0
              ? `Der Cloud-Kassenstand wurde zurückgesetzt. Auf diesem Gerät warten noch ${unsent} nicht übertragene Einträge. Sie bleiben erhalten. Bitte zuerst ein Backup exportieren und den Kassenstand in der Verwaltung klären.`
              : 'Der Cloud-Kassenstand wurde zurückgesetzt. Lokale Buchungen und offene Kassen bleiben erhalten. Bitte den Kassenstand in der Verwaltung klären.');
          }
        }
        // Apply even when already known: it repairs stale local state written by
        // a cloud request that began before a completed reset. A new generation
        // clears every local booking, including entries created offline after the
        // reset timestamp but before this device learned about the reset.
        // Restored bookings retain their original dates but belong to the
        // current generation. Reapplying the cutoff would remove them on
        // every sync, only for the following pull to add them again.
        if (generationChanged) {
          // Complete local state and ALL old queued writes are durably archived
          // BEFORE React state or the known generation is changed. If browser
          // storage fails, abort sync and keep old records visible.
          await quarantineEntriesBeforeGeneration(
            latestReset.generation, financialSnapshotRef.current,
          );
        }
        if (generationChanged || latestReset.resetAt > known.resetAt) {
          applyCloudBookingReset(latestReset.resetAt, generationChanged);
        }
        if (generationChanged || latestReset.resetAt > known.resetAt) {
          rememberBookingReset(latestReset);
        }
        newestPulledRef.current = null;
      }
      }, () => testMode ? Promise.resolve() : pullBookings(duringStartup));
      if (!bookingResult.ok) return bookingResult;
      if (!catalogResult.ok) {
        return { ok: false, error: `Artikel-Synchronisierung: ${catalogResult.error ?? 'Unbekannter Fehler.'}` };
      }
      if (!testMode) {
        try {
          markCloudSyncVerified(Date.now());
        } catch (checkpointError) {
          // A full/confirmed cloud sync is not undone by unavailable browser
          // storage. Never claim a local Backup 1/2 succeeded here.
          console.warn('Cloud synchronisiert; Zeitstempel konnte nicht gespeichert werden.', checkpointError);
        }
      }
      return bookingResult;
    })().finally(() => {
      inFlightRef.current = null;
    });
    return inFlightRef.current;
  }, [testMode, firstSetup, pullBookings, syncCatalog, applyCloudBookingReset]);

  const pauseSyncForRestore = useCallback(async () => {
    restorePausedRef.current = true;
    const activeSync = inFlightRef.current;
    if (activeSync) await activeSync.catch(() => undefined);
  }, []);

  const resumeSyncAfterRestore = useCallback(() => {
    rebaseAfterRestoreRef.current = true;
    restorePausedRef.current = false;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const ok = await isReachable();
      if (!cancelled) setOnline(ok);
    };
    void check();
    const id = window.setInterval(check, PING_INTERVAL_MS);
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
    };
  }, []);

  useEffect(() => {
    if (firstSetup) return;
    if (!online) {
      offlineSinceRef.current = true;
      return;
    }
    let cancelled = false;
    const syncAfterReconnect = async () => {
      const result = await flush();
      if (result.ok && offlineSinceRef.current && !cancelled) {
        offlineSinceRef.current = false;
        onReconnectSyncedRef.current();
      }
    };
    void syncAfterReconnect();
    const id = window.setInterval(() => {
      void flush();
    }, FLUSH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [online, flush, syncCatalog, firstSetup]);

  useEffect(() => {
    if (firstSetup || testMode || !supabase) return;

    if (restorePausedRef.current || rebaseAfterRestoreRef.current) {
      snapshotRef.current = snapshotOf(transactions, cashSessions);
      rebaseAfterRestoreRef.current = false;
      return;
    }

    const previous = snapshotRef.current;
    if (!previous) {
      snapshotRef.current = snapshotOf(transactions, cashSessions);
      if (loadJSON<boolean>(STORAGE_KEYS.cloudBackfilled, false)) return;
      const everything = [...transactions.map(transactionEntry), ...cashSessions.map(sessionEntry)];
      enqueueEntries(everything)
        .then(() => saveJSON(STORAGE_KEYS.cloudBackfilled, true))
        .then(() => flush())
        .catch((err) => console.error('Cloud-Übertragung der bestehenden Daten fehlgeschlagen.', err));
      return;
    }

    const newTransactions = transactions.filter((t) => !previous.txIds.has(t.id));
    const changedSessions = cashSessions.filter((s) => previous.sessions.get(s.id) !== s);
    snapshotRef.current = snapshotOf(transactions, cashSessions);

    const entries = [...newTransactions.map(transactionEntry), ...changedSessions.map(sessionEntry)];
    if (entries.length === 0) return;
    enqueueEntries(entries)
      .then(() => flush())
      .catch((err) => console.error('Speichern in der Warteschlange fehlgeschlagen.', err));
  }, [transactions, cashSessions, testMode, firstSetup, flush]);

  return { online, syncNow: flush, downloadBookings, pauseSyncForRestore, resumeSyncAfterRestore };
}
