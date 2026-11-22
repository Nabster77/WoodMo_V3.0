export type UpdatePhase = 'offer' | 'preparing' | 'prepared' | 'folder-check' | 'folder' |
  'syncing' | 'sync-error' | 'synced' | 'activating' | 'reload';

interface Props {
  phase: UpdatePhase;
  version?: string;
  error: string | null;
  percent: number;
  onPrepare: () => void;
  onContinue: () => void;
  onRetry: () => void;
  onActivate: () => void;
  onDismiss: () => void;
  onReload: () => void;
}

export function InitialSyncDialog({ phase, version, error, percent, onPrepare, onContinue, onRetry, onActivate, onDismiss, onReload }: Props) {
  const syncing = phase === 'syncing' || phase === 'sync-error' || phase === 'synced';
  const title = phase === 'offer' ? 'Update verfügbar – Version ' + version
    : phase === 'prepared' ? 'Update vorbereitet'
    : syncing ? 'Cloud-Synchronisierung'
    : phase === 'reload' ? 'App erneut öffnen' : 'Update';
  const action = phase === 'offer' ? { label: 'Jetzt updaten', run: onPrepare }
    : phase === 'prepared' ? { label: 'Weiter', run: onContinue }
    : phase === 'sync-error' ? { label: 'Erneut synchronisieren', run: onRetry }
    : phase === 'synced' ? { label: 'Bestätigen und App neu starten', run: onActivate }
    : phase === 'reload' ? { label: 'App neu laden', run: onReload } : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/80 p-3 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="initial-sync-title"
        className="my-auto w-full max-w-md space-y-4 rounded-2xl border border-slate-300 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <h2 id="initial-sync-title" className="text-xl font-bold">{title}</h2>
        {phase === 'preparing' && <p role="status">Update-Dateien und Kassendaten werden geprüft …</p>}
        {phase === 'prepared' && <p>Informationen zu den Änderungen finden Sie in der Verwaltung unter Info.</p>}
        {phase === 'folder-check' && <p role="status">Der Speicherort wird geprüft …</p>}
        {syncing && <progress aria-label="Synchronisierungsfortschritt" max={100} value={percent} className="h-3 w-full accent-emerald-600" />}
        {phase === 'syncing' && <p role="status">Kassendaten werden abgeglichen …</p>}
        {phase === 'synced' && <div role="status" className="space-y-1">
          <p className="font-semibold">Cloud-Synchronisierung erfolgreich</p>
          <p>Alle erforderlichen Daten wurden aktualisiert. Das Update kann abgeschlossen werden.</p>
        </div>}
        {phase === 'activating' && <p role="status">Die bestätigte Version wird aktiviert …</p>}
        {phase === 'reload' && <p>Falls das Neuladen nicht hilft, schließen Sie die App vollständig und öffnen Sie sie erneut. Am PC können Sie mit Strg+Umschalt+R neu laden.</p>}
        {error && <p role="alert" className="break-words text-sm text-red-700 dark:text-red-300">{error}</p>}
        {action && <div className="flex flex-wrap justify-end gap-2">
          {phase !== 'reload' && <button type="button" onClick={onDismiss} className="min-h-11 rounded-xl border px-4">Abbrechen</button>}
          <button type="button" onClick={action.run} className="min-h-11 rounded-xl bg-emerald-700 px-4 font-semibold text-white">{action.label}</button>
        </div>}
      </section>
    </div>
  );
}