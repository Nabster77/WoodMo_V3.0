import { useEffect, useState } from 'react';
import { RESTORE_STEPS, restoreClear, subscribeRestoreProgress, type RestoreProgress } from '@/lib/restoreProgress';

/** Sperrt die App während des Backup-Imports. Freigabe erst bei 100 % oder nach Fehlermeldung. */
export function RestoreProgressOverlay() {
  const [progress, setProgress] = useState<RestoreProgress>(null);
  useEffect(() => subscribeRestoreProgress(setProgress), []);
  if (!progress) return null;
  const percent = Math.round((progress.done / progress.total) * 100);
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4" role="alertdialog" aria-live="polite">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl">
        <div className="text-sm font-black">Backup wird importiert</div>
        <div className="mt-1 text-xs text-white/70">
          {progress.failed ? 'Import nicht abgeschlossen' : progress.done >= progress.total ? 'Fertig' : `Schritt ${progress.done + 1} von ${progress.total}: ${progress.label} …`}
        </div>
        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-white/10">
          <div className={`h-full transition-all duration-500 ${progress.failed ? 'bg-red-500' : 'bg-emerald-400'}`} style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-1 text-right text-xs font-bold">{percent} %</div>
        <ul className="mt-3 space-y-1 text-xs">
          {RESTORE_STEPS.map((step, i) => (
            <li key={step} className={i < progress.done ? 'text-emerald-300' : i === progress.done ? 'text-white' : 'text-white/40'}>
              {i < progress.done ? '✓' : i === progress.done ? '…' : '○'} {step}
            </li>
          ))}
        </ul>
        {progress.failed ? (
          <>
            <p className="mt-3 text-xs text-red-300">{progress.failed}</p>
            <button type="button" onClick={restoreClear} className="mt-3 w-full rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-900">OK</button>
          </>
        ) : (
          <p className="mt-3 text-xs text-white/60">Bitte nicht schließen. Die Kasse ist bis zum Ende gesperrt.</p>
        )}
      </div>
    </div>
  );
}
