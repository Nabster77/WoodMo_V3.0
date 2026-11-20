import type { CashSession } from '@/types';
import { supabase } from '@/lib/supabaseClient';

export function closeArchiveKey(location: unknown, year: unknown, number: unknown): string {
  return JSON.stringify([location, Number(year), Number(number)]);
}

export function sessionCloseArchiveKey(session: CashSession): string {
  return closeArchiveKey(session.dailyCloseReceiptLocation ?? session.location, session.dailyCloseReceiptYear, session.dailyCloseReceiptNumber);
}

export async function loadDailyCloseArchive(includeSource = true): Promise<CashSession[]> {
  if (!supabase) throw new Error('Tagesabschlussarchiv ist nicht verbunden.');
  const { data, error } = await supabase.rpc('export_pos_close_archive', { p_include_source: includeSource });
  if (error) throw new Error('Tagesabschlussarchiv nicht erreichbar: ' + error.message);
  if (!Array.isArray(data)) throw new Error('Tagesabschlussarchiv hat ein ungueltiges Format.');
  return data as CashSession[];
}

export function requireCompleteCloseArchive(recovery: Record<string, unknown>, archive: CashSession[]): void {
  if (!Array.isArray(archive) || archive.some(session =>
    !session?.id || !session.closed || session.discarded ||
    !Number.isFinite(session.dailyCloseFinalizedAt) ||
    (session.location !== 'Bregenz' && session.location !== 'Friedrichshafen') ||
    (session.dailyCloseReceiptLocation != null && session.dailyCloseReceiptLocation !== session.location) ||
    !Array.isArray(session.dailyCloseSnapshot?.transactions) ||
    !Number.isSafeInteger(session.dailyCloseReceiptYear) || Number(session.dailyCloseReceiptYear) < 2000 ||
    !Number.isSafeInteger(session.dailyCloseReceiptNumber) || Number(session.dailyCloseReceiptNumber) < 1) ||
    new Set(archive.map(session => session.id)).size !== archive.length) {
    throw new Error('Tagesabschlussarchiv enthält unvollständige oder doppelte Berichte.');
  }
  const keys = new Set(archive.map(sessionCloseArchiveKey));
  if (keys.size !== archive.length || !Array.isArray(recovery.receipts) || recovery.receipts.some((receipt) =>
    !receipt || typeof receipt !== 'object' ||
    !keys.has(closeArchiveKey(receipt.location, receipt.calendar_year, receipt.location_sequence)))) {
    throw new Error('Sicherung unvollstaendig: Mindestens ein Tagesabschlussbericht fehlt oder ist doppelt.');
  }
}

export async function restoreDailyCloseArchive(archive?: CashSession[], validateOnly = false): Promise<void> {
  if (archive === undefined) return;
  if (!Array.isArray(archive) || !supabase) throw new Error('Tagesabschlussarchiv kann nicht importiert werden.');
  const { data, error } = await supabase.rpc('restore_pos_close_archive', {
    p_reports: archive,
    p_validate_only: validateOnly,
  });
  if (error || data !== archive.length) {
    throw new Error('Tagesabschluesse nicht vollstaendig bestaetigt: ' + (error?.message ?? 'Anzahl stimmt nicht.'));
  }
}
