import { useEffect, useState, useCallback } from 'react';
import { Activity, X, Loader2, Check } from 'lucide-react';
import {
  DIAG_EVENT, DIAG_ONLINE_WINDOW_MS, enableOwnDevice, getDeviceId, getDeviceLabel, getDiagMode, listDevices,
  sendRemoteCommand, setDeviceLabel, setLocalMode, setRemoteMode, verifyDiagnosticsPassword,
  type DiagCommand, type DiagMode, type DiagRow,
} from '@/lib/diagnostics';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { APP_VERSION } from '@/lib/appVersion';

const MODE_TEXT: Record<DiagMode, string> = { off: 'AUS', ready: 'BEREIT', on: 'AN' };
const COMMANDS: { id: DiagCommand; label: string }[] = [
  { id: 'status', label: 'Status abfragen' },
  { id: 'update-check', label: 'Nach Update suchen' },
  { id: 'reload', label: 'Neu laden' },
  { id: 'update-install', label: 'Update installieren' },
];

function useMode(): DiagMode {
  const [mode, setMode] = useState<DiagMode>(getDiagMode());
  useEffect(() => {
    const update = () => setMode(getDiagMode());
    window.addEventListener(DIAG_EVENT, update);
    return () => window.removeEventListener(DIAG_EVENT, update);
  }, []);
  return mode;
}

function ago(iso: string | null): { text: string; online: boolean } {
  if (!iso) return { text: 'nie', online: false };
  const age = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(age / 60000);
  const text = minutes < 1 ? 'gerade eben' : minutes < 60 ? `vor ${minutes} Min.` : formatDateTime(new Date(iso).getTime());
  return { text, online: age < DIAG_ONLINE_WINDOW_MS };
}

function summary(report: Record<string, unknown> | null): string[] {
  if (!report) return [];
  const lines: string[] = [];
  if (typeof report.outbox === 'number') lines.push(report.outbox < 0 ? 'Upload: unbekannt' : `Upload offen: ${report.outbox}`);
  if (typeof report.sync === 'string' && report.sync) lines.push(`Katalog: ${report.sync}`);
  const last = report.lastBooking as { at?: number; total?: number } | null | undefined;
  if (last && typeof last.at === 'number' && typeof last.total === 'number') {
    lines.push(`Letzte Buchung: ${formatDateTime(last.at)} · ${formatCurrency(last.total)}`);
  }
  if (typeof report.updateWaiting === 'string' && report.updateWaiting) lines.push(`Update wartet: ${report.updateWaiting}`);
  const folder = report.folder as { mode?: string; status?: string; name?: string | null; files?: number; newest?: { path: string; size: number; at: number }[] } | null | undefined;
  if (folder) {
    if (folder.mode === 'downloads') lines.push('Speicherort: Downloads des Browsers (kein Ordner gewählt)');
    else {
      const state = folder.status === 'ok' ? 'in Ordnung' : folder.status === 'needs-permission' ? 'Zugriff muss am Gerät neu erlaubt werden' : 'Ordner nicht gefunden';
      lines.push(`Speicherort: ${folder.name ?? '?'} · ${state} · ${folder.files ?? 0} Dateien`);
      for (const file of (folder.newest ?? []).slice(0, 3)) lines.push(`  ${file.path} · ${formatDateTime(file.at)} · ${Math.max(1, Math.round(file.size / 1024))} KB`);
    }
  }
  if (report.home === false) lines.push('Gerät in Benutzung');
  if (report.staffLoggedIn === true) lines.push('Mitarbeiter angemeldet');
  const errors = Array.isArray(report.errors) ? report.errors as { at?: number; msg?: string }[] : [];
  if (errors.length) lines.push(`Letzter Fehler: ${errors[errors.length - 1].msg ?? ''}`);
  return lines;
}

export function DiagnosticsDialog({ location, onClose }: { location: string | null; onClose: () => void }) {
  const mode = useMode();
  const myId = getDeviceId();
  const [label, setLabel] = useState(getDeviceLabel());
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [force, setForce] = useState(false);
  const [rows, setRows] = useState<DiagRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try { setRows(await listDevices()); } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Geräteliste nicht lesbar.' });
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);


  async function unlock() {
    if (!password.trim()) { setMessage({ ok: false, text: 'Bitte das Administrator- oder Verwaltungspasswort eingeben.' }); return; }
    setBusy(true); setMessage(null);
    try {
      await verifyDiagnosticsPassword(password);
      setUnlocked(true);
    } catch (error) {
      setPassword('');
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Passwort nicht geprüft.' });
    } finally { setBusy(false); }
  }

  async function guarded(action: () => Promise<void>, okText: string, needPassword: boolean) {
    if (needPassword && !password.trim()) { setMessage({ ok: false, text: 'Bitte zuerst das Administrator- oder Verwaltungspasswort eingeben.' }); return; }
    setBusy(true); setMessage(null);
    try {
      await action();
      setMessage({ ok: true, text: okText });
      await refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Aktion fehlgeschlagen.' });
    } finally { setBusy(false); }
  }

  const modeButton = (target: DiagMode, text: string, onClick: () => void) => (
    <button type="button" disabled={busy || mode === target} onClick={onClick} aria-pressed={mode === target}
      className={`min-h-10 flex-1 rounded-lg px-3 py-2 text-sm font-bold ${mode === target ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-white'}`}>
      {text}
    </button>
  );

  if (!unlocked) {
    return (
      <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/65 p-4 backdrop-blur-[2px]" onClick={onClose}
        onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="woodmo-diag-gate" onClick={(event) => event.stopPropagation()}
          className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-300 bg-white p-5 text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <h2 id="woodmo-diag-gate" className="flex items-center gap-2 text-xl font-bold"><Activity className="h-5 w-5" /> Diagnose</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">Bitte das Administrator- oder Verwaltungspasswort eingeben.</p>
          <form onSubmit={(event) => { event.preventDefault(); void unlock(); }} className="space-y-3">
            <input type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off"
              aria-label="Passwort" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-800" />
            {message && <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-400">{message.text}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-white px-3 text-sm font-bold text-slate-900 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Entsperren
              </button>
              <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-lg bg-slate-800 px-3 text-sm font-bold text-white">Abbrechen</button>
            </div>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/65 p-4 backdrop-blur-[2px]" onClick={onClose}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="woodmo-diag-title" onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-slate-300 bg-white p-5 text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between gap-3">
          <h2 id="woodmo-diag-title" className="flex items-center gap-2 text-xl font-bold"><Activity className="h-5 w-5" /> Diagnose</h2>
          <button type="button" aria-label="Diagnose schließen" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-400"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          AUS: nichts wird gesendet, das Gerät hört nicht zu. BEREIT: nur Lebenszeichen, ein Administrator kann das Gerät einschalten. AN: Statusbericht und Befehle.
          Einschalten und Befehle brauchen das Administrator- oder Verwaltungspasswort.
        </p>

        <div className="space-y-2 rounded-xl border border-slate-300 p-3 dark:border-slate-700">
          <p className="text-sm font-bold">Dieses Gerät: <span className="text-emerald-600">{MODE_TEXT[mode]}</span></p>
          <label className="block text-xs font-semibold">Gerätename
            <input value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} onBlur={() => setDeviceLabel(label)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
          </label>
          <div className="flex gap-2">
            {modeButton('off', 'AUS', () => void guarded(() => setLocalMode('off', location), 'Diagnose ist aus.', false))}
            {modeButton('ready', 'BEREIT', () => void guarded(() => setLocalMode('ready', location), 'Gerät ist bereit und wartet auf Freigabe.', false))}
            {modeButton('on', 'AN', () => void guarded(() => enableOwnDevice(password, location), 'Diagnose ist an.', true))}
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>Befehle „Neu laden“ und „Update installieren“ erzwingen: auch wenn das Gerät in Verwaltung oder Journal geöffnet ist oder noch etwas hochgeladen wird. Nie mitten im Verkauf.</span>
        </label>
        {message && (
          <p role={message.ok ? 'status' : 'alert'} className={`flex items-center gap-1.5 text-sm font-semibold ${message.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
            {message.ok && <Check className="h-4 w-4" />} {message.text}
          </p>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Geräte</h3>
          {rows.length === 0 && <p className="text-sm text-slate-500">Noch kein Gerät gemeldet.</p>}
          {rows.map((row) => {
            const seen = ago(row.reported_at);
            const own = row.device_id === myId;
            return (
              <div key={row.device_id} className="space-y-2 rounded-xl border border-slate-300 p-3 text-sm dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">{row.label || 'Gerät'}{own ? ' (dieses)' : ''}{row.location ? ` · ${row.location}` : ''}</p>
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${seen.online ? 'bg-emerald-600 text-white' : 'bg-slate-500 text-white'}`}>{seen.online ? 'online' : 'nicht erreichbar'}</span>
                </div>
                <p className="text-xs text-slate-500">Modus {MODE_TEXT[row.mode]} · Version {row.app_version ?? '?'}{row.app_version === APP_VERSION ? ' (wie dieses Gerät)' : ''} · zuletzt {seen.text}</p>
                {summary(row.report).map((line) => <p key={line} className="text-xs">{line}</p>)}
                {row.pending_command && <p className="text-xs font-semibold text-amber-600">Befehl wartet: {COMMANDS.find((c) => c.id === row.pending_command)?.label}</p>}
                {row.command_result && <p className="text-xs text-slate-500">Letztes Ergebnis: {row.command_result}</p>}
                {!own && (
                  <div className="flex flex-wrap gap-2">
                    {row.mode !== 'on' && (
                      <button type="button" disabled={busy || row.mode === 'off'} title={row.mode === 'off' ? 'Gerät steht auf AUS und hört nicht zu' : undefined}
                        onClick={() => void guarded(() => setRemoteMode(row.device_id, 'on', password), `${row.label || 'Gerät'}: AN gesetzt.`, true)}
                        className="min-h-10 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white disabled:opacity-40">Einschalten</button>
                    )}
                    {row.mode === 'on' && (
                      <button type="button" disabled={busy}
                        onClick={() => void guarded(() => setRemoteMode(row.device_id, 'ready', password), `${row.label || 'Gerät'}: auf BEREIT gestellt.`, true)}
                        className="min-h-10 rounded-lg bg-slate-700 px-3 text-xs font-bold text-white">Auf BEREIT</button>
                    )}
                    {row.mode === 'on' && COMMANDS.map((command) => (
                      <button key={command.id} type="button" disabled={busy}
                        onClick={() => void guarded(async () => {
                          // Schon auf der aktuellen Version: nichts senden, kein Update und kein Neustart nötig.
                          if (command.id === 'update-install' && row.app_version === APP_VERSION) throw new Error(`${row.label || 'Gerät'} läuft schon auf Version ${APP_VERSION}. Kein Update und kein Neustart nötig.`);
                          await sendRemoteCommand(row.device_id, command.id, password, force && (command.id === 'reload' || command.id === 'update-install'));
                        }, `${command.label} an ${row.label || 'Gerät'} gesendet.`, true)}
                        className="min-h-10 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white">{command.label}</button>
                    ))}
                  </div>
                )}
                {own && row.mode === 'on' && <p className="text-xs text-slate-500">Befehle für dieses Gerät setzt du von einem anderen Gerät aus.</p>}
              </div>
            );
          })}
          <button type="button" disabled={busy} onClick={() => void refresh()}
            className="flex min-h-10 items-center gap-1.5 rounded-lg bg-slate-700 px-3 text-xs font-bold text-white">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Aktualisieren
          </button>
        </div>
      </section>
    </div>
  );
}
