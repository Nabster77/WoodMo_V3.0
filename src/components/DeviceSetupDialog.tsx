import { useEffect, useState } from 'react';
import { FolderOpen, Settings } from 'lucide-react';
import { archiveFolderStatus, confirmJournalExportFolder, folderPickerSupported, loadExportFolder, pickJournalExportFolder, type ArchiveFolderStatus } from '@/lib/journalPdfFile';
import { readDeviceSetup, saveDeviceSetup } from '@/lib/deviceSetup';

interface Props {
  firstSetup?: boolean;
  onContinue: () => void;
  onComplete: () => void;
  onClose: () => void;
  onOffline?: () => void;
  warning?: string | null;
}

const action = 'flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800';

export function DeviceSetupDialog({ firstSetup = false, onContinue, onComplete, onClose, onOffline, warning }: Props) {
  const [setup, setSetup] = useState(readDeviceSetup);
  const [status, setStatus] = useState<ArchiveFolderStatus | null>(null);
  const [folderOptionsOpen, setFolderOptionsOpen] = useState(firstSetup && setup?.archiveMode !== 'folder');
  const [selection, setSelection] = useState<FileSystemDirectoryHandle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerSupported, setPickerSupported] = useState(folderPickerSupported);

  useEffect(() => {
    if (setup?.archiveMode !== 'folder') return;
    let active = true;
    void archiveFolderStatus().then(result => {
      if (!active) return;
      setStatus(result);
      if (firstSetup && result === 'missing') setFolderOptionsOpen(true);
    });
    return () => { active = false; };
  }, [setup, firstSetup]);

  async function chooseFolder() {
    setBusy(true);
    setError(null);
    try {
      const folder = await pickJournalExportFolder();
      if (folder) setSelection(folder);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'NotSupportedError') {
        setSelection(null);
        setPickerSupported(false);
      } else {
        setError(reason instanceof Error ? reason.message : 'Der Ordner konnte nicht geöffnet werden.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveLocation(choice: FileSystemDirectoryHandle | 'saved') {
    setBusy(true);
    setError(null);
    try {
      const folder = choice === 'saved' ? await loadExportFolder() : choice;
      if (!folder) {
        setStatus('missing');
        setFolderOptionsOpen(true);
        throw new Error('Der gespeicherte Ordner fehlt. Bitte wählen Sie ihn erneut aus.');
      }
      const label = await confirmJournalExportFolder(folder);
      const next = choice === 'saved' && setup?.folderLabel === label ? setup : saveDeviceSetup('folder', label);
      setSetup(next);
      setStatus('ok');
      setSelection(null);
      setFolderOptionsOpen(false);
      onComplete();
      if (firstSetup) onContinue();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Der Speicherort konnte nicht übernommen werden.');
      if (choice === 'saved') {
        const result = await archiveFolderStatus();
        setStatus(result);
        if (result === 'missing') setFolderOptionsOpen(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/80 p-3 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="device-setup-title"
        className="my-auto w-full max-w-md space-y-4 rounded-2xl border border-slate-300 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <h2 id="device-setup-title" className="flex items-center gap-2 text-xl font-bold"><Settings size={20} aria-hidden="true" /> {firstSetup ? 'Speicherort wählen' : 'Setup'}</h2>
        {firstSetup && <p className="text-sm font-semibold text-red-700 dark:text-red-300">Bitte geben Sie den Ordner an, wo das Tablet die Kassendaten speichern kann.</p>}
        {warning && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-200">{warning}</p>}
        <section aria-labelledby="setup-storage-title" className="space-y-2">
          <h3 id="setup-storage-title" className="font-semibold">Speicherort für PDFs und Backups</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">Offene Übertragungen bleiben im lokalen App-Speicher. Mit Schreibzugriff legt die App zusätzlich eine Wiederherstellungskopie in „Offline-Sicherung“ ab.</p>
          {setup?.archiveMode === 'folder' && <div className="rounded-lg bg-slate-100 p-2 text-sm dark:bg-slate-800">
            <strong className="block [overflow-wrap:anywhere]">{setup.folderLabel ?? 'Gespeicherter Ordner'}</strong>
            {status === 'missing' && <p className="text-amber-800 dark:text-amber-200">Der Ordner ist nicht mehr verfügbar.</p>}
            {status === 'needs-permission' && <p>Bitte bestätigen Sie den Schreibzugriff erneut.</p>}
            {status === null && <p>Gespeicherter Ordner wird geprüft …</p>}
          </div>}
          {setup?.archiveMode === 'downloads' && <p className="text-sm">Dateien werden manuell gespeichert.</p>}
          {firstSetup && !folderOptionsOpen && status && status !== 'missing' && <div className="space-y-2">
            <p className="text-sm">{status === 'ok' ? 'Ordner bereits ausgewählt. Möchten Sie ihn behalten?' : 'Möchten Sie den Schreibzugriff auf diesen Ordner erneut erlauben?'}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={action} disabled={busy} onClick={() => void saveLocation('saved')}>{status === 'ok' ? 'Behalten und weiter' : 'Zugriff erlauben und weiter'}</button>
              <button type="button" className={action} disabled={busy} onClick={() => { setError(null); setFolderOptionsOpen(true); }}>Ordner ändern</button>
            </div>
          </div>}
          {!folderOptionsOpen && (!firstSetup || status === null) && <button type="button" className={action} onClick={() => setFolderOptionsOpen(true)}>
            <FolderOpen size={18} aria-hidden="true" /> {firstSetup ? 'Ordner ändern' : 'Kassen-Speicherort wählen'}
          </button>}
          {folderOptionsOpen && <div className="space-y-2">
            <p className="text-sm">{firstSetup ? 'Bitte wählen Sie den Ordner, in dem Ihre Kassendaten abgelegt werden.' : 'Wählen Sie den Ordner, in dem Sie die Kassendateien ablegen möchten.'}</p>
            {pickerSupported
              ? <button type="button" className={action} disabled={busy} onClick={() => void chooseFolder()}>
                  <FolderOpen size={18} aria-hidden="true" /> Ordner auswählen
                </button>
              : <p className="text-sm">Dieser Browser kann keinen Ordner dauerhaft freigeben.</p>}
            {selection && <p className="rounded-lg bg-emerald-50 p-2 text-sm dark:bg-emerald-950">
              Ausgewählter Ordner <strong className="block [overflow-wrap:anywhere]">{selection.name}</strong>
            </p>}
            {selection && <p className="text-xs text-slate-600 dark:text-slate-300">Chrome stellt hier den Ordnernamen bereit. Laufwerk und vollständiger Systempfad sind im Auswahlfenster sichtbar, soweit das Betriebssystem sie anzeigt.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={action} disabled={busy} onClick={() => {
                setSelection(null); setError(null); setFolderOptionsOpen(false);
                if (firstSetup) onClose();
              }}>Abbrechen</button>
              <button type="button" className={action} disabled={busy || !selection} onClick={() => {
                if (selection) void saveLocation(selection);
              }}>OK</button>
            </div>
          </div>}
        </section>
        {error && <p role="alert" className="break-words text-sm text-red-700 dark:text-red-300">{error}</p>}
        {onOffline && <button type="button" className={action} disabled={busy} onClick={onOffline}>Offline zur Kasse</button>}
        {!firstSetup && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-300 pt-3 dark:border-slate-700">
          <button type="button" className={`${action} ml-auto`} disabled={busy} onClick={onClose}>Schließen</button>
        </div>}
      </section>
    </div>
  );
}
