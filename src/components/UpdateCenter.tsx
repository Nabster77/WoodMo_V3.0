import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, X, XCircle } from 'lucide-react';
import { PasswordGate } from '@/components/PasswordGate';
import { readPendingOutbox } from '@/lib/outbox';
import { readDeviceSetup } from '@/lib/deviceSetup';
import { archiveFolderStatus } from '@/lib/journalPdfFile';
import { formatDateISO } from '@/lib/format';
import {
  INSTALLED_BUILD, buildLabel, fetchOnlineBuild, fingerprint, installUpdate, lastBackupExport, sameBuild,
  sameFingerprint, saveUpdateCheck, clearUpdateCheck, type BuildInfo, type UpdateCheck, type UpdateStep,
} from '@/lib/updateCenter';
import type { CashSession, StaffUser, Transaction } from '@/types';

type CheckState = 'ok' | 'warn' | 'fail' | 'wait';

interface Props {
  administrators: StaffUser[];
  online: boolean;
  cloudStatus: 'ok' | 'pending' | 'error';
  sessionOpen: boolean;
  transactions: Transaction[];
  cashSessions: CashSession[];
  onClose: () => void;
}

const STEP_TEXT: Record<UpdateStep, string> = {
  suchen: 'Neue Version wird gesucht …',
  laden: 'Neue Version wird vollständig geladen …',
  neustart: 'Fertig geladen. App startet neu …',
};
const STEP_PERCENT: Record<UpdateStep, number> = { suchen: 15, laden: 60, neustart: 100 };

function Mark({ state }: { state: CheckState }) {
  if (state === 'ok') return <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-label="in Ordnung" />;
  if (state === 'warn') return <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-label="Hinweis" />;
  if (state === 'fail') return <XCircle className="h-5 w-5 shrink-0 text-red-500" aria-label="nicht erfüllt" />;
  return <Loader2 className="h-5 w-5 shrink-0 animate-spin text-slate-400" aria-label="wird geprüft" />;
}

function Row({ state, title, detail }: { state: CheckState; title: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <Mark state={state} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
        {detail && <p className="text-xs text-slate-500 dark:text-slate-400">{detail}</p>}
      </div>
    </li>
  );
}

/** Update-Zentrale: nur für Administratoren (persönliches Passwort), vom Startbildschirm aus. */
export function UpdateCenter({ administrators, online, cloudStatus, sessionOpen, transactions, cashSessions, onClose }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [onlineBuild, setOnlineBuild] = useState<BuildInfo | null | 'wait'>('wait');
  const [pending, setPending] = useState<number | null>(null);
  const [folder, setFolder] = useState<{ state: CheckState; detail: string } | null>(null);
  const [step, setStep] = useState<UpdateStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  const admins = useMemo(() => administrators.filter((user) => user.active && user.role === 'administrator'), [administrators]);

  async function refresh() {
    setOnlineBuild('wait');
    setPending(null);
    setFolder(null);
    setError(null);
    const [build, queue] = await Promise.all([
      fetchOnlineBuild(),
      readPendingOutbox().then((rows) => rows.length).catch(() => -1),
    ]);
    setOnlineBuild(build);
    setPending(queue);
    const setup = readDeviceSetup();
    if (!setup) setFolder({ state: 'fail', detail: 'Auf diesem Gerät ist noch kein Speicherort eingerichtet.' });
    else if (setup.archiveMode === 'downloads') setFolder({ state: 'ok', detail: 'PDFs werden in „Downloads“ gespeichert.' });
    else {
      const status = await archiveFolderStatus().catch(() => 'missing' as const);
      setFolder(status === 'missing'
        ? { state: 'fail', detail: 'Ordner ist eingetragen, aber nicht mehr verfügbar.' }
        : { state: 'ok', detail: `Ordner „${setup.folderLabel ?? 'eingerichtet'}“ bleibt.` });
    }
  }

  useEffect(() => { if (unlocked) void refresh(); }, [unlocked]);

  if (!unlocked) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60">
        <PasswordGate title="Update-Zentrale" administrators={admins} allowManagerPassword
          onSuccess={() => setUnlocked(true)} onCancel={onClose} />
      </div>
    );
  }

  const updateAvailable = onlineBuild !== 'wait' && onlineBuild !== null && !sameBuild(onlineBuild, INSTALLED_BUILD);
  const backupAt = lastBackupExport();
  const backupToday = backupAt !== null && formatDateISO(backupAt) === formatDateISO(Date.now());
  const checks: { state: CheckState; title: string; detail?: string; required: boolean }[] = [
    { required: true, state: online ? 'ok' : 'fail', title: 'Internet verbunden', detail: online ? undefined : 'Ohne Internet kein Update.' },
    { required: true,
      state: pending === null ? 'wait' : pending === 0 && cloudStatus === 'ok' ? 'ok' : pending < 0 ? 'warn' : 'fail',
      title: 'Alle Buchungen übertragen',
      detail: pending === null ? undefined : pending > 0 ? `${pending} offen – „Sync Cloud“ tippen.`
        : cloudStatus !== 'ok' ? 'Abgleich läuft – kurz warten.' : undefined },
    { required: true, state: sessionOpen ? 'fail' : 'ok', title: 'Keine Kasse offen auf diesem Gerät',
      detail: sessionOpen ? 'Erst den Tagesabschluss machen.' : undefined },
    { required: false, state: backupToday ? 'ok' : 'warn', title: 'Backup von heute',
      detail: backupToday ? `Um ${new Date(backupAt ?? 0).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.`
        : 'Heute noch keins auf diesem Gerät (Hinweis, kein Muss).' },
    { required: false, state: folder?.state === 'fail' ? 'warn' : folder?.state ?? 'wait', title: 'Speicherort für PDFs', detail: folder?.detail },
  ];
  const blocked = checks.some((check) => check.required && check.state !== 'ok');
  const busy = step !== null;

  async function start() {
    setError(null);
    const check: UpdateCheck = { from: INSTALLED_BUILD, startedAt: Date.now(), before: fingerprint(transactions, cashSessions), expectUpdate: updateAvailable };
    saveUpdateCheck(check);
    try {
      await installUpdate(setStep);
    } catch (reason) {
      clearUpdateCheck();
      setStep(null);
      setError(`${reason instanceof Error ? reason.message : 'Update abgebrochen.'} Die bisherige Version läuft unverändert weiter. Daten sind nicht betroffen.`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Update-Zentrale">
      <section className="my-auto w-full max-w-lg rounded-3xl border border-slate-300 bg-white p-5 shadow-2xl dark:border-white/20 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Update-Zentrale</h2>
          {!busy && <button type="button" onClick={onClose} aria-label="Schließen" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"><X className="h-5 w-5" /></button>}
        </div>

        <div className="space-y-1 rounded-2xl border border-slate-200 p-3 text-sm dark:border-white/15">
          <p><span className="text-slate-500 dark:text-slate-400">Installiert:</span> <strong className="text-slate-900 dark:text-white">{buildLabel(INSTALLED_BUILD)}</strong></p>
          <p><span className="text-slate-500 dark:text-slate-400">Online:</span>{' '}
            {onlineBuild === 'wait' ? 'wird geprüft …'
              : onlineBuild === null ? 'nicht erreichbar (offline?)'
              : <strong className="text-slate-900 dark:text-white">{buildLabel(onlineBuild)}</strong>}
          </p>
          <p className={`font-bold ${updateAvailable ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {onlineBuild === 'wait' ? '' : onlineBuild === null ? '' : updateAvailable ? 'Neue Version verfügbar' : 'Diese Version ist aktuell'}
          </p>
        </div>

        {(() => {
          const notes: BuildInfo = updateAvailable && typeof onlineBuild === 'object' && onlineBuild !== null ? onlineBuild : INSTALLED_BUILD;
          return notes.notes.length > 0 && (
            <details className="mt-3 rounded-2xl border border-slate-200 p-3 text-sm dark:border-white/15">
              <summary className="cursor-pointer font-semibold text-slate-900 dark:text-white">{updateAvailable ? 'Was ist neu?' : 'Inhalt dieser Version'} ({notes.notes.length} Punkte, zum Aufklappen)</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
                {notes.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </details>
          );
        })()}

        <h3 className="mt-4 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Prüfung vor dem Update</h3>
        <ul className="mt-1 divide-y divide-slate-100 dark:divide-white/10">
          {checks.map((check) => <Row key={check.title} state={check.state} title={check.title} detail={check.detail} />)}
        </ul>

        {step && (
          <div className="mt-4" role="status" aria-live="polite">
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${STEP_PERCENT[step]}%` }} />
            </div>
            <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><Loader2 className="h-4 w-4 animate-spin" />{STEP_TEXT[step]}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Bitte nicht schließen. Bricht die Verbindung ab, läuft die bisherige Version einfach weiter.</p>
          </div>
        )}
        {error && <p className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</p>}

        {!busy && (
          <div className="mt-4 grid gap-2">
            <button type="button" disabled={blocked || onlineBuild === 'wait'} onClick={() => void start()}
              className="min-h-12 w-full rounded-xl bg-slate-900 px-4 py-3 text-base font-bold text-white disabled:opacity-40 dark:bg-white dark:!text-slate-900">
              {updateAvailable ? 'Jetzt aktualisieren' : 'Neu starten und prüfen'}
            </button>
            {blocked && <p className="text-center text-xs text-slate-500 dark:text-slate-400">Knopf frei, sobald die oberen drei Punkte grün sind.</p>}
            <button type="button" onClick={() => void refresh()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 py-2.5 text-sm font-semibold text-slate-800 dark:border-white/30 dark:text-slate-100">
              <RefreshCw className="h-4 w-4" /> Erneut prüfen
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

/** Prüfbericht nach dem Neustart: Version vorher/nachher und unveränderter Datenstand. */
export function UpdateReport({ check, transactions, cashSessions, onClose }: { check: UpdateCheck; transactions: Transaction[]; cashSessions: CashSession[]; onClose: () => void }) {
  const after = fingerprint(transactions, cashSessions);
  const changedVersion = !sameBuild(check.from, INSTALLED_BUILD);
  const dataSame = sameFingerprint(check.before, after);
  const euro = (cents: number) => (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const rows: [string, string, string][] = [
    ['Version', buildLabel(check.from), buildLabel(INSTALLED_BUILD)],
    ['Bons', String(check.before.receipts), String(after.receipts)],
    ['Kassensitzungen', String(check.before.sessions), String(after.sessions)],
    ['davon abgeschlossen', String(check.before.closedSessions), String(after.closedSessions)],
    ['Summe aller Bons', euro(check.before.totalCents), euro(after.totalCents)],
  ];
  const healthCheck = !check.expectUpdate && !changedVersion;
  const ok = (changedVersion || healthCheck) && dataSame;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Prüfbericht Update">
      <section className="my-auto w-full max-w-lg rounded-3xl border border-slate-300 bg-white p-5 shadow-2xl dark:border-white/20 dark:bg-slate-900">
        <h2 className={`flex items-center gap-2 text-xl font-extrabold ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
          {ok ? <CheckCircle2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
          {ok ? (healthCheck ? 'Prüfung in Ordnung' : 'Update erfolgreich') : !dataSame ? 'Bitte prüfen' : 'Version unverändert'}
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {ok ? (healthCheck ? 'App neu gestartet. Alle Daten dieses Geräts sind unverändert vorhanden.' : 'Neue Version läuft. Alle Daten dieses Geräts sind unverändert vorhanden.')
            : !dataSame ? 'Der Datenstand weicht vom Stand vor dem Neustart ab. Bitte Sync abwarten und mit dem Backup vergleichen.'
            : 'Die neue Version ist noch nicht aktiv (z. B. Verbindung abgebrochen). Die bisherige Version läuft. Update später erneut starten.'}
        </p>
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400"><th className="py-1">Prüfpunkt</th><th>Vorher</th><th>Nachher</th></tr></thead>
          <tbody>
            {rows.map(([label, before, now]) => (
              <tr key={label} className="border-t border-slate-100 dark:border-white/10">
                <td className="py-1.5 font-semibold text-slate-800 dark:text-slate-100">{label}</td>
                <td className="text-slate-600 dark:text-slate-300">{before}</td>
                <td className={label !== 'Version' && before !== now ? 'font-bold text-red-600' : 'text-slate-900 dark:text-white'}>{now}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Update gestartet: {new Date(check.startedAt).toLocaleString('de-DE')}</p>
        <button type="button" onClick={onClose} className="mt-4 min-h-12 w-full rounded-xl bg-slate-900 px-4 py-3 font-bold text-white dark:bg-white dark:!text-slate-900">Schließen</button>
      </section>
    </div>
  );
}
