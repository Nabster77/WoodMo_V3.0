import { supabase } from '@/lib/supabaseClient';
import { fetchCatalogRows, pushCatalogRows, commitCatalogImport } from '@/lib/catalogCloud';
import {
  buildLocalEntries,
  stableStringify,
  computePending,
  keyOf,
  rowToEntry,
  projectProductOrder,
  type CatalogEntry,
  type CatalogRow,
  type CatalogSyncState,
  type LocalCatalog,
} from '@/lib/catalogSync';
import { SHOT_CATEGORY_ID } from '@/lib/shotCatalog';
import { loadJSON, saveJSON, STORAGE_KEYS } from '@/lib/storage';
import type { Product } from '@/types';

export type CatalogImportSession = { base: LocalCatalog; cloud: CatalogRow[] };

export interface CatalogEngine {
  prepareImport: () => Promise<CatalogImportSession>;
  commitImport: (session: CatalogImportSession, next: LocalCatalog) => Promise<void>;
  sync: () => Promise<CatalogSyncResult>;
  localChanged: () => void;
  downloadCatalog: (replaceOnFirstDownload: boolean) => Promise<boolean>;
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
  let inFlight: Promise<CatalogSyncResult> | null = null;
  let capturedInitialCatalog = false;

  const persist = () => saveJSON(STORAGE_KEYS.catalogSync, state);

  function initializeFromCloud(rows: CatalogRow[], replaceLocal: boolean) {
    const local = deps.getLocal();
    saveJSON(`${STORAGE_KEYS.catalogBackupPrefix}${Date.now()}`, local);
    const pendingKeys = new Set(Object.keys(state.pending));
    const replace = replaceLocal && pendingKeys.size === 0;
    const effective = replace ? rows : projectProductOrder(rows, local.products, {}, true);
    state.synced = Object.fromEntries(effective.map((row, i) => [
      keyOf(row.kind, row.id), effectiveEntry(row, rows[i]),
    ]));
    // Keep defaults for settings absent from the cloud, or all local defaults
    // when the cloud is empty, without marking those defaults for upload.
    for (const [key, entry] of buildLocalEntries(local, Date.now())) {
      if ((!replace && !state.synced[key]) || rows.length === 0 || (entry.kind === 'setting' && !state.synced[key]?.json)) {
        state.synced[key] = entry;
      }
    }
    state.initialized = true;
    persist();
    if (effective.length > 0) deps.applyRows(effective, pendingKeys, replace);
  }

  function effectiveEntry(row: CatalogRow, original: CatalogRow): CatalogEntry {
    const entry = rowToEntry(row);
    return row !== original ? { ...entry, cloudJson: rowToEntry(original).json ?? undefined } : entry;
  }

  function reconcileProductOrder(cloud: CatalogRow[]) {
    for (const row of cloud) {
      if (row.kind !== 'product') continue;
      const key = keyOf('product', row.id);
      const base = state.synced[key];
      const pending = state.pending[key];
      if (!base?.json || !pending?.json || row.updated_at < base.updatedAt) continue;
      const { sortOrder: baseOrder, ...baseFields } = JSON.parse(base.json) as Product;
      const { sortOrder: localOrder, ...localFields } = JSON.parse(pending.json) as Product;
      if (localOrder === baseOrder || stableStringify(baseFields) !== stableStringify(localFields)) continue;

      const remote = row.data as Product;
      const previousRemoteOrder = base.cloudJson ? (JSON.parse(base.cloudJson) as Product).sortOrder : baseOrder;
      const remoteMoved = remote.categoryId !== baseFields.categoryId || remote.sortOrder !== previousRemoteOrder;
      if (row.deleted || remote.categoryId !== baseFields.categoryId || (remoteMoved && row.updated_at > pending.updatedAt)) {
        delete state.pending[key];
      } else {
        const json = stableStringify({ ...remote, sortOrder: localOrder });
        if (json === rowToEntry(row).json) delete state.pending[key];
        else state.pending[key] = { ...pending, json, updatedAt: Math.max(pending.updatedAt, row.updated_at + 1) };
      }
    }
    persist();
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

  function applyCloudRows(rows: CatalogRow[]) {
    const local = deps.getLocal();
    const localEntries = buildLocalEntries(local, Date.now());
    const accepted = rows.filter(row => {
      const key = keyOf(row.kind, row.id);
      return !state.pending[key] && row.updated_at >= (state.synced[key]?.updatedAt ?? 0);
    });
    const effective = projectProductOrder(accepted, local.products, state.synced, false);
    let storeChanged = false;
    effective.forEach((row, i) => {
      const key = keyOf(row.kind, row.id);
      const next = effectiveEntry(row, accepted[i]);
      if ((localEntries.get(key)?.json ?? null) !== next.json) storeChanged = true;
      state.synced[key] = next;
    });
    persist();
    if (storeChanged) deps.applyRows(effective, new Set(Object.keys(state.pending)));
  }

  async function step(): Promise<boolean> {
    if (!state.initialized) {
      // Existing devices may have a folder and local data from before catalog sync.
      initializeFromCloud(await fetchCatalogRows(), false);
      if (!Object.keys(state.pending).length) return true;
    }
    if (!capturedInitialCatalog) {
      capturedInitialCatalog = true;
      if (computePending(buildLocalEntries(deps.getLocal(), Date.now()), state, Date.now())) persist();
    }
    const cloud = await fetchCatalogRows();
    if (Object.keys(state.pending).length) {
      reconcileProductOrder(cloud);
      if (Object.keys(state.pending).length) {
        await pushPending();
        applyCloudRows(await fetchCatalogRows());
        return true;
      }
    }
    applyCloudRows(cloud);
    return true;
  }

  function sync(): Promise<CatalogSyncResult> {
    if (importing) return Promise.resolve({ ok: false, error: 'Katalogimport läuft.' });
    if (!deps.isEnabled() || !supabase) return Promise.resolve({ ok: false, error: 'Artikel-Synchronisierung ist nicht konfiguriert.' });
    inFlight ??= step()
      .then((complete) => complete ? ({ ok: true }) : ({ ok: false, error: 'Bitte zuerst die Daten aus der KassenCloud herunterladen.' }))
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

  async function downloadCatalog(replaceOnFirstDownload: boolean) {
    if (!deps.isEnabled() || !supabase) throw new Error('KassenCloud ist nicht verfügbar.');
    if (importing) throw new Error('Es läuft bereits eine Datenübernahme.');
    importing = true;
    try {
      if (inFlight) await inFlight;
      const rows = await fetchCatalogRows();
      if (state.initialized) applyCloudRows(rows);
      else initializeFromCloud(rows, replaceOnFirstDownload);
      return Object.keys(state.pending).length === 0;
    } finally {
      importing = false;
    }
  }

  async function prepareImport(): Promise<CatalogImportSession> {
    const result = await sync();
    if (!result.ok) throw new Error(result.error);
    if (!state.initialized || Object.keys(state.pending).length) throw new Error('Bitte zuerst alle Katalogänderungen synchronisieren.');
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
      if (stableStringify(deps.getLocal()) !== stableStringify(session.base) || Object.keys(state.pending).length) {
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
  return { sync, localChanged, downloadCatalog, prepareImport, commitImport };
}
