import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { archiveFolderStatus, grantArchiveFolder } from '@/lib/journalPdfFile';
import { readDeviceSetup } from '@/lib/deviceSetup';
import { PdfArchiveSetupRequired } from '@/lib/pdfArchiveSetup';

/**
 * Android Chrome forgets folder access when the app is closed. At start we
 * check silently; if access is missing, the register waits for ONE tap that
 * re-grants the same folder. Without a stored folder the Setup opens.
 */
export function ArchivePermissionGate({ onOpenSetup, suspended }: { onOpenSetup: () => void; suspended: boolean }) {
  const [needed, setNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (suspended || readDeviceSetup()?.archiveMode !== 'folder') return;
    let cancelled = false;
    void archiveFolderStatus().then((status) => {
      if (cancelled) return;
      if (status === 'missing') onOpenSetup();
      else setNeeded(status === 'needs-permission');
    });
    return () => { cancelled = true; };
  }, [suspended, onOpenSetup]);

  if (!needed || suspended) return null;

  async function grant() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await grantArchiveFolder()) setNeeded(false);
      else setError('Der Ordner wurde nicht freigegeben. Bitte erneut tippen und „Zulassen“ wählen, oder den Speicherort neu auswählen.');
    } catch (reason) {
      if (reason instanceof PdfArchiveSetupRequired) { setNeeded(false); return; }
      setError(reason instanceof Error ? reason.message : 'Ordner konnte nicht freigegeben werden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="archive-permission-title"
        className="w-full max-w-md space-y-4 rounded-3xl border border-emerald-700/40 bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-emerald-800/10 p-3 text-emerald-700 dark:text-emerald-400"><FolderOpen size={26} /></div>
          <h2 id="archive-permission-title" className="text-xl font-bold text-slate-900 dark:text-white">Speicherordner freigeben</h2>
        </div>
        <p className="text-sm text-slate-700 dark:text-slate-200">
          Das Tablet fragt nach dem Neustart erneut nach der Erlaubnis für deinen Speicherordner. Einmal tippen und „Zulassen“ wählen – der Ordner bleibt derselbe.
        </p>
        <button type="button" onClick={() => void grant()} disabled={busy}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
          <FolderOpen size={19} /> {busy ? 'Wird freigegeben …' : 'Speicherordner freigeben'}
        </button>
        <button type="button" onClick={() => { setNeeded(false); onOpenSetup(); }} disabled={busy}
          className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-200">
          Anderen Speicherort wählen
        </button>
        {error && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{error}</p>}
      </section>
    </div>
  );
}
