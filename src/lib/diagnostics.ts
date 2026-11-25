// Geräte-Diagnose (25.11.2026): Statusbericht, Fern-Einschalten und Befehle.
// Modus je Gerät: 'off' = komplett aus (kein Senden, kein Lauschen), 'ready' = nur Lebenszeichen und
// Warten auf „Einschalten“, 'on' = Statusbericht und Befehle. Einschalten ('on') und Befehle laufen
// nur über die Edge Function woodmo-v3-diagnostics mit Administrator- oder Verwaltungspasswort.
import { supabase } from './supabaseClient';
import { APP_VERSION } from './appVersion';
import { readPendingOutbox } from './outbox';
import { describeArchiveFolder } from './journalPdfFile';

export type DiagMode = 'off' | 'ready' | 'on';
export type DiagCommand = 'status' | 'update-check' | 'reload' | 'update-install';

export interface DiagContext {
  location: string | null;
  online: boolean;
  homeVisible: boolean;
  staffLoggedIn: boolean;
  lastBooking: { at: number; total: number } | null;
  updateWaiting: string | null;
  syncStatus: string;
}
export interface DiagRow {
  device_id: string;
  label: string;
  location: string | null;
  app_version: string | null;
  mode: DiagMode;
  report: Record<string, unknown> | null;
  reported_at: string | null;
  pending_command: DiagCommand | null;
  command_force: boolean | null;
  command_sent_at: string | null;
  command_result: string | null;
  command_result_at: string | null;
}
export interface DiagHandlers {
  /** done=false: Befehl bleibt liegen und wird später erneut versucht (z. B. Kasse in Benutzung). */
  run(command: DiagCommand, force: boolean): Promise<{ done: boolean; text: string }>;
}

export const DIAG_EVENT = 'woodmo-diag-changed';
const MODE_KEY = 'woodmo-diag-mode';
const ID_KEY = 'woodmo-diag-device';
const LABEL_KEY = 'woodmo-diag-label';
const ERR_KEY = 'woodmo-diag-errors';
export const DIAG_ONLINE_WINDOW_MS = 3 * 60 * 1000;

function readStore(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
function notify(): void {
  try { window.dispatchEvent(new Event(DIAG_EVENT)); } catch { /* ignore */ }
}

export function getDiagMode(): DiagMode {
  const value = readStore(MODE_KEY);
  return value === 'ready' || value === 'on' ? value : 'off';
}
function storeMode(mode: DiagMode): void {
  writeStore(MODE_KEY, mode);
  notify();
}
export function getDeviceId(): string {
  const existing = readStore(ID_KEY);
  if (existing && existing.length >= 8) return existing;
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  writeStore(ID_KEY, id);
  return id;
}
export function defaultDeviceLabel(): string {
  const touch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  return touch ? 'Tablet' : 'PC';
}
export function getDeviceLabel(): string {
  return (readStore(LABEL_KEY) ?? '').trim() || defaultDeviceLabel();
}
export function setDeviceLabel(label: string): void {
  writeStore(LABEL_KEY, label.trim().slice(0, 40));
  notify();
}

// ---- Letzte Fehler (ohne personenbezogene Daten, gekürzt) ----
function cleanMessage(raw: unknown): string {
  return String(raw ?? '').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[mail]').replace(/\s+/g, ' ').trim().slice(0, 140);
}
function pushError(raw: unknown): void {
  const message = cleanMessage(raw);
  if (!message) return;
  let list: { at: number; msg: string }[] = [];
  try { list = JSON.parse(readStore(ERR_KEY) ?? '[]') as { at: number; msg: string }[]; } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  list.push({ at: Date.now(), msg: message });
  writeStore(ERR_KEY, JSON.stringify(list.slice(-5)));
}
let captureInstalled = false;
export function installDiagErrorCapture(): void {
  if (captureInstalled || typeof window === 'undefined') return;
  captureInstalled = true;
  window.addEventListener('error', (event) => pushError(event.message));
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    pushError(reason instanceof Error ? reason.message : reason);
  });
}
function readErrors(): { at: number; msg: string }[] {
  try {
    const parsed = JSON.parse(readStore(ERR_KEY) ?? '[]') as { at: number; msg: string }[];
    return Array.isArray(parsed) ? parsed.slice(-5) : [];
  } catch { return []; }
}

let folderCache: { at: number; value: Awaited<ReturnType<typeof describeArchiveFolder>> } | null = null;

export async function buildReport(ctx: DiagContext): Promise<Record<string, unknown>> {
  let outbox = -1;
  try { outbox = (await readPendingOutbox()).length; } catch { /* unbekannt */ }
  // Ordnerliste höchstens alle 5 Minuten neu einlesen (Dateien zählen kostet Zeit).
  if (!folderCache || Date.now() - folderCache.at > 5 * 60_000) {
    try { folderCache = { at: Date.now(), value: await describeArchiveFolder() }; } catch { /* alter Wert bleibt */ }
  }
  const folder = folderCache?.value ?? null;
  return {
    version: APP_VERSION,
    online: ctx.online,
    visible: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
    home: ctx.homeVisible,
    staffLoggedIn: ctx.staffLoggedIn,
    sync: ctx.syncStatus,
    outbox,
    lastBooking: ctx.lastBooking,
    updateWaiting: ctx.updateWaiting,
    folder,
    errors: readErrors(),
    sentAt: Date.now(),
  };
}

// ---- Cloud ----
const TABLE = 'pos_device_diagnostics';

export async function listDevices(): Promise<DiagRow[]> {
  if (!supabase) throw new Error('Cloud ist nicht konfiguriert.');
  const { data, error } = await supabase.from(TABLE).select('*').order('reported_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DiagRow[];
}

async function invokeGateway(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!supabase) throw new Error('Cloud ist nicht konfiguriert.');
  const { data, error } = await supabase.functions.invoke('woodmo-v3-diagnostics', { body });
  if (error) {
    let message = 'Diagnose-Dienst nicht erreichbar: ' + error.message;
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      try {
        const parsed: unknown = await response.json();
        if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
          message = (parsed as { error: string }).error;
        }
      } catch { /* Transportfehler bleibt */ }
    }
    throw new Error(message);
  }
  if (!data || typeof data !== 'object') throw new Error('Unerwartete Antwort der Cloud.');
  return data as Record<string, unknown>;
}

export async function ensureOwnRow(location: string | null): Promise<void> {
  if (!supabase) throw new Error('Cloud ist nicht konfiguriert.');
  const id = getDeviceId();
  const { data, error } = await supabase.from(TABLE).select('device_id').eq('device_id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return;
  const mode = getDiagMode();
  const { error: insertError } = await supabase.from(TABLE).insert({
    device_id: id, label: getDeviceLabel(), location, app_version: APP_VERSION,
    mode: mode === 'on' ? 'ready' : mode, reported_at: new Date().toISOString(),
  });
  if (insertError) throw new Error(insertError.message);
}

/** Aus/Bereit am eigenen Gerät: ohne Passwort. AUS ist endgültig lokal, der PC kann es nicht überstimmen. */
export async function setLocalMode(mode: 'off' | 'ready', location: string | null): Promise<void> {
  storeMode(mode);
  if (!supabase || !navigator.onLine) return;
  try {
    await ensureOwnRow(location);
    await supabase.from(TABLE).update({ mode, pending_command: null }).eq('device_id', getDeviceId());
  } catch { /* lokal gilt trotzdem */ }
}

/** Dieses Gerät einschalten: Passwort nötig (Prüfung serverseitig). */
export async function enableOwnDevice(password: string, location: string | null): Promise<void> {
  // Von AUS aus zuerst auf BEREIT, damit der Dienst das Einschalten zulässt.
  if (getDiagMode() === 'off') await setLocalMode('ready', location);
  await ensureOwnRow(location);
  await invokeGateway({ action: 'set_mode', device_id: getDeviceId(), mode: 'on', password });
  storeMode('on');
}

/** Anderes Gerät fernsteuern (nur aus BEREIT/AN heraus möglich, weil nur diese Geräte lauschen). */
export async function setRemoteMode(deviceId: string, mode: DiagMode, password: string): Promise<void> {
  await invokeGateway({ action: 'set_mode', device_id: deviceId, mode, password });
  if (deviceId === getDeviceId()) storeMode(mode);
}
export async function sendRemoteCommand(deviceId: string, command: DiagCommand, password: string, force = false): Promise<void> {
  await invokeGateway({ action: 'command', device_id: deviceId, command, password, force });
}

/** Prüft nur das Passwort (serverseitig), ändert nichts. */
export async function verifyDiagnosticsPassword(password: string): Promise<void> {
  await invokeGateway({ action: 'verify', password });
}

/** Ein Durchlauf: Lebenszeichen/Bericht senden, Modus abgleichen, Befehle ausführen. */
export async function diagnosticsTick(ctx: DiagContext, handlers: DiagHandlers): Promise<void> {
  let mode = getDiagMode();
  if (mode === 'off' || !supabase || !navigator.onLine) return;
  const id = getDeviceId();
  const { data: row, error } = await supabase.from(TABLE).select('*').eq('device_id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) {
    await ensureOwnRow(ctx.location);
    return;
  }
  const current = row as DiagRow;
  // Remote-Änderungen übernehmen: nur 'on' (mit Passwort gesetzt) oder 'off'/'ready' vom PC.
  if (current.mode !== mode) {
    if (current.mode === 'on' || current.mode === 'off' || current.mode === 'ready') {
      mode = current.mode;
      storeMode(mode);
    }
  }
  if (mode === 'off') return;
  const base = {
    label: getDeviceLabel(), location: ctx.location, app_version: APP_VERSION,
    reported_at: new Date().toISOString(),
  };
  const report = mode === 'on' ? await buildReport(ctx) : { online: true, version: APP_VERSION, sentAt: Date.now() };
  await supabase.from(TABLE).update({ ...base, report }).eq('device_id', id);
  if (mode !== 'on' || !current.pending_command) return;

  const outcome = await handlers.run(current.pending_command, current.command_force === true);
  if (!outcome.done) {
    await supabase.from(TABLE).update({ command_result: outcome.text.slice(0, 200), command_result_at: new Date().toISOString() })
      .eq('device_id', id);
    return;
  }
  await supabase.from(TABLE).update({
    pending_command: null, command_result: outcome.text.slice(0, 200), command_result_at: new Date().toISOString(),
  }).eq('device_id', id);
}
