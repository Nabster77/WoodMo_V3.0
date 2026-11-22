import { useCallback, useEffect, useRef, useState } from 'react';
import { createCatalogEngine } from '@/lib/catalogEngine';
import { stableStringify, type CatalogRow } from '@/lib/catalogSync';
import type { Category, PfandSettings, Product, ShotOption } from '@/types';

interface CatalogSyncOptions {
  categories: Category[];
  products: Product[];
  pfandSettings: PfandSettings;
  shotOptions: ShotOption[];
  testMode: boolean;
  offerInitialDownload: boolean;
  applyRows: (rows: CatalogRow[], skipKeys: Set<string>, replaceLocal?: boolean) => void;
}

export function useCatalogSync({ categories, products, pfandSettings, shotOptions, testMode, offerInitialDownload, applyRows }: CatalogSyncOptions) {
  const [syncStatus, setSyncStatus] = useState<'pending' | 'syncing' | 'saved' | 'error'>('pending');
  const revision = useRef(0);
  const lastCatalogSnapshot = useRef<string | null>(null);

  const localRef = useRef({ categories, products, pfandSettings, shotOptions });
  localRef.current = { categories, products, pfandSettings, shotOptions };
  const applyRef = useRef(applyRows);
  applyRef.current = applyRows;
  const testModeRef = useRef(testMode);
  testModeRef.current = testMode;

  const [engine] = useState(() =>
    createCatalogEngine({
      getLocal: () => localRef.current,
      applyRows: (rows, skipKeys, replaceLocal) => applyRef.current(rows, skipKeys, replaceLocal),
      isEnabled: () => !testModeRef.current,
    }),
  );

  const syncCatalog = useCallback(async (background = true) => {
    if (testModeRef.current) return { ok: false, error: 'Im Testmodus ist die Cloud-Synchronisierung deaktiviert.' };
    const startedAt = revision.current;
    if (!background) setSyncStatus('syncing');
    const result = await engine.sync();
    if (revision.current === startedAt) {
      // A successful background check must not flash amber when nothing changed.
      // A failed check is still reported, even when it ran in the background.
      setSyncStatus(result.ok ? 'saved' : 'error');
    }
    return result;
  }, [engine]);

  useEffect(() => {
    if (offerInitialDownload) return;
    // React can replace arrays with identical data after a cloud pull. Only a
    // real catalog content change should put the status back into pending.
    const snapshot = stableStringify({ categories, products, pfandSettings, shotOptions });
    if (lastCatalogSnapshot.current === snapshot) return;
    const firstRender = lastCatalogSnapshot.current === null;
    lastCatalogSnapshot.current = snapshot;
    engine.localChanged();
    if (testMode) return;
    const current = ++revision.current;
    if (!firstRender) setSyncStatus('pending');
    const timer = window.setTimeout(() => {
      if (revision.current === current) void syncCatalog(firstRender);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [engine, categories, products, pfandSettings, shotOptions, testMode, offerInitialDownload, syncCatalog]);

  useEffect(() => {
    if (testMode || offerInitialDownload) return;
    // Retry pending uploads after reconnect and periodically when the app stays open.
    const retry = () => { void syncCatalog(true); };
    window.addEventListener('online', retry);
    const interval = window.setInterval(retry, 30_000);
    return () => {
      window.removeEventListener('online', retry);
      window.clearInterval(interval);
    };
  }, [syncCatalog, testMode, offerInitialDownload]);
  async function downloadCatalog() {
    const fullySynced = await engine.downloadCatalog(offerInitialDownload);
    setSyncStatus(fullySynced ? 'saved' : 'pending');
  }
  return {
    downloadCatalog,
    syncStatus, syncCatalog, prepareImport: engine.prepareImport, commitImport: engine.commitImport,
  };
}
