import { supabase } from '@/lib/supabaseClient';
import { fetchCatalogRows, pushCatalogRows, commitCatalogImport } from '@/lib/catalogCloud';
import {
  buildLocalEntries,
  stableStringify,
  computePending,
  keyOf,
  rowToEntry,
  type CatalogEntry,
  type CatalogRow,
  type CatalogSyncState,
  type LocalCatalog,
} from '@/lib/catalogSync';
import { SHOT_CATEGORY_ID } from '@/lib/shotCatalog';
import { loadJSON, saveJSON, STORAGE_KEYS } from '@/lib/storage';

export type ConflictChoice = 'cloud' | 'local';

export type CatalogImportSession = { base: LocalCatalog; cloud: CatalogRow[] };

export interface CatalogEngine {
  prepareImport: () => Promise<CatalogImportSession>;
  commitImport: (session: CatalogImportSession, next: LocalCatalog) => Promise<void>;
  sync: () => Promise<CatalogSyncResult>;
  localChanged: () => void;
  resolveConflict: (choice: ConflictChoice) => void;
}

export interface CatalogSyncResult {
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

export interface CatalogEngineDeps {
  getLocal: () => LocalCatalog;
  applyRows: (rows: CatalogRow[], skipKeys: Set<string>, replaceLocal?: boolean) => void;
  setConflict: (rows: CatalogRow[] | null) => void;
  isEnabled: () => boolean;
}

function loadState(): CatalogSyncState {
  return loadJSON<CatalogSyncState | null>(STORAGE_KEYS.catalogSync, null) ?? { initialized: false, synced: {}, pending: {} };
}

// True when the cloud holds a different version of any record, or records this device lacks.
function differsFromCloud(local: Map<string, CatalogEntry>, rows: CatalogRow[]): boolean {
  const remote = new Map(rows.map((r) => [keyOf(r.kind, r.id), rowToEntry(r).json]));
  for (const [key, entry] of local) {
    if (remote.get(key) !== entry.json) return true;
  }
  for (const [key, json] of remote) {
    if (json !== null && !local.has(key)) return true;
  }
  return false;
}

export function createCatalogEngine(deps: CatalogEngineDeps): CatalogEngine {
  const state = loadState();
  let importing = false;
  let conflictRows: CatalogRow[] | null = null;
  let inFlight: Promise<CatalogSyncResult> | null = null;

  const persist = () => saveJSON(STORAGE_KEYS.catalogSync, state);

  function initialize(choice: ConflictChoice, rows: CatalogRow[]) {
    state.synced = Object.fromEntries(rows.map((r) => [keyOf(r.kind, r.id), rowToEntry(r)]));
    state.pending = {};
    const local = buildLocalEntries(deps.getLocal(), Date.now());
    // CLOUD TAKEOVER must not enqueue demo/local-only entries for upload.
    // 'Cloud übernehmen' means a true authoritative copy, not a merge.
    if (choice === 'local') {
      for (const [key, entry] of local) {
        const remote = state.synced[key];
        if (!remote || remote.json !== entry.json) state.pending[key] = entry;
      }
    }
    state.initialized = true;
    persist();
    if (rows.length > 0) deps.applyRows(rows, new Set(Object.keys(state.pending)), choice === 'cloud');
  }

  async function pushPending() {
    const entries = Object.entries(state.pending);
    if (entries.length === 0) return;
    const rows: CatalogRow[] = entries.map(([key, entry]) => ({
      kind: entry.kind,
      id: entry.id,
      data: JSON.parse(entry.json ?? state.synced[key]?.json ?? '{}'),
      updated_at: entry.updatedAt,
      deleted: entry.json === null,
    }));
    await pushCatalogRows(rows);
    for (const [key, entry] of entries) {
      const current = state.pending[key];
      if (current && current.updatedAt === entry.updatedAt && current.json === entry.json) {
        delete state.pending[key];
        state.synced[key] = entry;
      }
    }
    persist();
  }

  async function pullRows() {
    const rows = await fetchCatalogRows();
    let storeChanged = false;
    for (const row of rows) {
      const key = keyOf(row.kind, row.id);
      if (state.pending[key]) continue;
      const next = rowToEntry(row);
      if (state.synced[key]?.json !== next.json) storeChanged = true;
      state.synced[key] = next;
    }
    persist();
    if (storeChanged) deps.applyRows(rows, new Set(Object.keys(state.pending)));
  }

  async function step(): Promise<boolean> {
    if (!state.initialized) {
      if (conflictRows) return false;
      const rows = await fetchCatalogRows();
      const local = deps.getLocal();
      saveJSON(`${STORAGE_KEYS.catalogBackupPrefix}${Date.now()}`, local);
      if (rows.length > 0 && differsFromCloud(buildLocalEntries(local, Date.now()), rows)) {
        conflictRows = rows;
        deps.setConflict(rows);
        return false;
      }
      initialize('local', rows);
    }
    await pushPending();
    await pullRows();
    return true;
  }

  function sync(): Promise<CatalogSyncResult> {
    if (importing) return Promise.resolve({ ok: false, error: 'Katalogimport läuft.' });
    if (!deps.isEnabled() || !supabase) return Promise.resolve({ ok: false, error: 'Artikel-Synchronisierung ist nicht konfiguriert.' });
    inFlight ??= step()
      .then((complete) => complete ? ({ ok: true }) : ({ ok: false, error: 'Bitte zuerst den Katalogkonflikt auflösen.' }))
      .catch((err) => {
        console.warn('Artikel-Synchronisierung pausiert, neuer Versuch folgt automatisch.', err);
        return { ok: false, error: errorMessage(err) };
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function localChanged() {
    if (!deps.isEnabled() || !state.initialized) return;
    if (computePending(buildLocalEntries(deps.getLocal(), Date.now()), state, Date.now())) {
      persist();
      void sync();
    }
  }

  function resolveConflict(choice: ConflictChoice) {
    if (!conflictRows) return;
    const rows = conflictRows;
    conflictRows = null;
    deps.setConflict(null);
    initialize(choice, rows);
    void sync();
  }

  async function prepareImport(): Promise<CatalogImportSession> {
    const result = await sync();
    if (!result.ok) throw new Error(result.error);
    if (!state.initialized || conflictRows || Object.keys(state.pending).length) throw new Error('Bitte zuerst alle Katalogänderungen synchronisieren.');
    const cloud = await fetchCatalogRows();
    const base = structuredClone(deps.getLocal());
    if (differsFromCloud(buildLocalEntries(base, Date.now()), cloud)) throw new Error('Katalog wird aktualisiert. Bitte Vorschau erneut erstellen, sobald die Synchronisierung abgeschlossen ist.');
    return { base, cloud };
  }

  async function commitImport(session: CatalogImportSession, next: LocalCatalog): Promise<void> {
    if (!deps.isEnabled() || !supabase) throw new Error('Import nur im aktiven Modus mit konfigurierter Test-Cloud möglich.');
    if (importing) throw new Error('Ein Import läuft bereits.');
    importing = true;
    try {
      if (inFlight) await inFlight;
      if (stableStringify(deps.getLocal()) !== stableStringify(session.base) || Object.keys(state.pending).length || conflictRows) {
        throw new Error('Lokaler Katalog wurde seit der Vorschau geändert. Bitte Vorschau neu erstellen.');
      }
      const before = buildLocalEntries(session.base, 0);
      const changes = [...buildLocalEntries(next, Date.now()).entries()]
        .filter(([key, entry]) => before.get(key)?.json !== entry.json)
        .map(([, entry]): CatalogRow => ({kind: entry.kind, id: entry.id, data: JSON.parse(entry.json!), updated_at: entry.updatedAt, deleted: false}));
      // Entries that exist in the old catalog but not in the new one are deleted afterwards
      // as tombstones (the database never hard-deletes). Shot settings and the SCHUSS group are never removed.
      const after = buildLocalEntries(next, 0);
      const removals = [...before.entries()].filter(([key, entry]) => !after.has(key) && entry.kind !== 'setting' && entry.id !== SHOT_CATEGORY_ID).map(([, entry]) => entry);
      if (!changes.length && !removals.length) return;
      let accepted = session.cloud;
      if (changes.length) {
        accepted = await commitCatalogImport(session.cloud, changes);
        state.synced = Object.fromEntries(accepted.map(row => [keyOf(row.kind, row.id), rowToEntry(row)]));
        state.pending = {};
      }
      const now = Date.now();
      const tombstones: CatalogRow[] = removals.map(entry => ({ kind: entry.kind, id: entry.id, data: JSON.parse(state.synced[keyOf(entry.kind, entry.id)]?.json ?? entry.json ?? '{}'), updated_at: now, deleted: true }));
      for (const row of tombstones) state.pending[keyOf(row.kind, row.id)] = { kind: row.kind, id: row.id, json: null, updatedAt: now };
      persist();
      deps.applyRows([...accepted, ...tombstones], new Set());
      // If this upload fails, the tombstones stay pending and the normal sync retries them.
      if (tombstones.length) { try { await pushPending(); } catch (err) { console.warn('Löschungen werden später synchronisiert.', err); } }
    } finally { importing = false; }
  }
  return { sync, localChanged, resolveConflict, prepareImport, commitImport };
}
