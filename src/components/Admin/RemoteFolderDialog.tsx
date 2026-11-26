import { useCallback, useEffect, useState } from 'react';
import { X, Folder, FileText, ArrowUp, Download, Loader2 } from 'lucide-react';
import { invokeGateway } from '@/lib/diagnostics';
import { listDeviceFolder, requestFileFromDevice, type RemoteEntry } from '@/lib/fileTransfer';

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Speicherordner eines anderen Geräts ansehen (verschlüsselt übertragen) und einzelne Dateien herunterladen. */
export function RemoteFolderDialog({ deviceId, deviceName, password, onClose }: { deviceId: string; deviceName: string; password: string; onClose: () => void }) {
  const [stack, setStack] = useState<string[]>([]);
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (path: string[]) => {
    setBusy(true); setMessage(null); setProgress('Starte …');
    try {
      setEntries(await listDeviceFolder(invokeGateway, deviceId, path.join('/'), password, setProgress));
    } catch (error) {
      setEntries([]);
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Ordner nicht lesbar.' });
    } finally { setBusy(false); setProgress(''); }
  }, [deviceId, password]);

  useEffect(() => { void load(stack); }, [stack, load]);

  const download = async (entry: RemoteEntry) => {
    setBusy(true); setMessage(null);
    try {
      const { name, blob } = await requestFileFromDevice(invokeGateway, deviceId, [...stack, entry.n].join('/'), password, setProgress);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage({ ok: true, text: `Gespeichert: ${name} (Server-Kopie gelöscht).` });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Übertragung fehlgeschlagen.' });
    } finally { setBusy(false); setProgress(''); }
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/65 p-4 backdrop-blur-[2px]" onClick={(event) => { event.stopPropagation(); onClose(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <section role="dialog" aria-modal="true" aria-labelledby="woodmo-remote-folder" onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col gap-3 rounded-2xl border border-slate-300 bg-white p-4 text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between gap-3">
          <h2 id="woodmo-remote-folder" className="flex items-center gap-2 text-xl font-bold"><Folder className="h-5 w-5" /> Speicherordner · {deviceName}</h2>
          <button type="button" aria-label="Schließen" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-400"><X className="h-5 w-5" /></button>
        </div>
        <p className="break-all text-xs text-slate-600 dark:text-slate-300"><span className="font-bold">{deviceName}</span> · {['Speicherordner', ...stack].join(' / ')}</p>
        <div className="flex gap-1.5 rounded-lg bg-slate-100 p-1.5 dark:bg-slate-800">
          <button type="button" disabled={busy || !stack.length} onClick={() => setStack((old) => old.slice(0, -1))}
            className="flex h-9 items-center gap-1.5 rounded-md bg-white px-2.5 text-xs font-semibold text-slate-900 shadow-sm disabled:opacity-35 dark:bg-slate-700 dark:text-white"><ArrowUp className="h-4 w-4" /> Zurück</button>
        </div>
        {message && <p role={message.ok ? 'status' : 'alert'} className={`text-sm font-semibold ${message.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>{message.text}</p>}
        <div className="min-h-32 flex-1 overflow-y-auto rounded-lg border border-slate-300 dark:border-slate-700">
          {busy && <p className="flex items-center gap-2 p-3 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> {progress || 'Lädt …'}</p>}
          {!busy && !entries.length && !message && <p className="p-3 text-sm text-slate-500">Dieser Ordner ist leer.</p>}
          <ul>
            {entries.map((entry) => (
              <li key={entry.k + entry.n} className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 last:border-b-0 dark:border-slate-800">
                {entry.k === 'd' ? (
                  <button type="button" disabled={busy} onClick={() => setStack((old) => [...old, entry.n])} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
                    <Folder className="h-4 w-4 shrink-0 text-amber-600" /><span className="min-w-0 break-all font-semibold">{entry.n}</span>
                  </button>
                ) : (
                  <>
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm"><FileText className="h-4 w-4 shrink-0 text-slate-500" /><span className="min-w-0 break-all font-semibold">{entry.n}</span></span>
                    <span className="shrink-0 text-xs text-slate-500">{sizeText(entry.s)}{entry.t ? ` · ${new Date(entry.t).toLocaleDateString('de-DE')}` : ''}</span>
                    <button type="button" disabled={busy} onClick={() => void download(entry)} aria-label={`${entry.n} herunterladen`}
                      className="flex h-9 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-bold text-white disabled:opacity-40"><Download className="h-4 w-4" /> Holen</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
