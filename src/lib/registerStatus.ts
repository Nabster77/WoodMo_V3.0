import type { CashSession, Location } from '@/types';
import { fetchLatestBookingReset } from '@/lib/bookingReset';
import { fetchCashSessions } from '@/lib/cloudPull';
import { formatDailyCloseReceiptNumber } from '@/lib/dailyCloseReceipt';

const LOCATIONS: Location[] = ['Bregenz', 'Friedrichshafen'];

export interface RegisterStatus {
  /** true nur, wenn die Cloud geantwortet hat und KEINE Kasse offen/unvollständig ist. */
  ready: boolean;
  /** Eine Zeile je Standort, z. B. „Bregenz: geschlossen (TA-…, 23.11. 22:05)“. */
  lines: string[];
}

const time = (ms: number) => new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Gleiche Regel wie „Buchungen zurücksetzen“: geschlossen + endgültiger Tagesabschluss + Snapshot. */
export function isFinallyClosed(session: CashSession): boolean {
  return Boolean(session.closed && session.dailyCloseFinalizedAt && session.dailyCloseSnapshot);
}

/** Wertet die Kassen der aktuellen Generation je Standort aus (rein, testbar). */
export function summarizeRegisters(sessions: readonly CashSession[]): RegisterStatus {
  const active = sessions.filter((session) => !session.discarded);
  const lines: string[] = [];
  let ready = true;
  for (const location of LOCATIONS) {
    const own = active.filter((session) => session.location === location);
    const open = own.filter((session) => !isFinallyClosed(session));
    if (open.length) {
      ready = false;
      for (const session of open) {
        lines.push(`${location}: OFFEN seit ${time(session.openedAt)} – bitte Tagesabschluss buchen und Kasse schließen.`);
      }
      continue;
    }
    const last = [...own].sort((a, b) => (b.dailyCloseFinalizedAt ?? 0) - (a.dailyCloseFinalizedAt ?? 0))[0];
    if (!last) { lines.push(`${location}: keine Kasse in dieser Abrechnungsperiode.`); continue; }
    const at = last.dailyCloseFinalizedAt ?? last.closedAt ?? last.openedAt;
    const receipt = formatDailyCloseReceiptNumber(last.dailyCloseReceiptNumber, last.dailyCloseReceiptLocation ?? location, at, last.dailyCloseReceiptYear);
    lines.push(`${location}: geschlossen${receipt ? ` (${receipt}, ${time(at)})` : ` (${time(at)})`}.`);
  }
  return { ready, lines };
}

/** Prüft den Kassenstatus direkt in der Cloud. Ohne Antwort gilt das Update als NICHT bereit. */
export async function checkRegistersClosedInCloud(): Promise<RegisterStatus> {
  try {
    const latest = await fetchLatestBookingReset();
    return summarizeRegisters(await fetchCashSessions(latest?.generation ?? 0));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ready: false, lines: [`Kassenstatus konnte nicht geprüft werden (${reason}). Bitte Internetverbindung prüfen und erneut versuchen.`] };
  }
}
