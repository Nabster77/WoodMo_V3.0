/**
 * Device-local document archive naming. No filesystem access here: use this
 * shared, deterministic path for exports and finalized daily-close PDFs.
 */
export interface ArchiveReport {
  location: string;
  fileName: string;
  documentTitle?: string;
  /** Start of the report period, NOT the date the export is clicked. */
  reportPeriodStart?: number;
  /** Daily close: filed by the moment the till was actually closed. */
  cashSessionPeriod?: { closedAt: number };
}

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/**
 * Date that decides year folder (and, for daily closes, the month folder).
 * A daily close counts in the month it was closed; all other reports in the
 * month/year of their report period.
 */
export function archiveDate(report: ArchiveReport, now = Date.now()): number {
  const closedAt = report.cashSessionPeriod?.closedAt;
  if (reportKindFolder(report) === 'Tagesabschlüsse' && Number.isFinite(closedAt)) return closedAt as number;
  return report.reportPeriodStart ?? now;
}

function monthName(at: number): string {
  const month = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', month: 'numeric' }).format(new Date(at)));
  if (month < 1 || month > 12) throw new Error('Ungültiger Berichtsmonat.');
  return MONTH_NAMES[month - 1];
}

export function archiveSubfolders(report: ArchiveReport): string[] {
  // A report without a valid date must not be filed at all.
  // The calendar year selects „Kasse JJJJ“ (see archiveFolders).
  const at = archiveDate(report);
  if (!Number.isFinite(new Date(at).getTime())) throw new Error('Ungültiger Berichtszeitraum.');
  const scope = report.location.trim().toLocaleLowerCase('de-DE');
  const location = scope.includes('alle') || scope.includes('beide')
    ? 'Alle-Standorte'
    : scope.includes('bregenz') ? 'Bregenz'
      : scope.includes('friedrichshafen') ? 'Friedrichshafen' : null;
  if (!location) throw new Error('Unbekannter Standort im PDF-Bericht.');
  const kind = reportKindFolder(report);
  // Daily closes: one folder per month (all closes of October in „Oktober“).
  return kind === 'Tagesabschlüsse' ? [location, kind, monthName(at)] : [location, kind];
}

/** Folder per report type, directly beneath the location (no month level). */
export function reportKindFolder(report: Pick<ArchiveReport, 'fileName' | 'documentTitle'>): string {
  const name = (report.documentTitle ?? '') + ' ' + report.fileName;
  return /Tagesabschluss/i.test(name) ? 'Tagesabschlüsse'
    : /Wochenjournal/i.test(name) ? 'Wochenjournal'
    : /Monatsjournal/i.test(name) ? 'Monatsjournal'
    : /Jahresjournal/i.test(name) ? 'Jahresjournal'
    : /Tagesjournal/i.test(name) ? 'Tagesjournal'
    : /Journal_\d{2}-\d{2}-\d{4}_bis_/i.test(name) ? 'Individuell'
    : /Einzel(?:beleg|bon)/i.test(name) ? 'Einzelbelege'
    : /Kassen(?:uebersicht|übersicht)/i.test(name) ? 'Kassenuebersicht'
    : /Storno/i.test(name) ? 'Storno'
    : 'Weitere-Berichte';
}

export function safeArchiveFileName(name: string): string {
  const cleaned = Array.from(name, char => char.charCodeAt(0) < 32 ? '_' : char)
    .join('').replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error('Ungültiger Dateiname.');
  return cleaned.endsWith('.pdf') ? cleaned : cleaned + '.pdf';
}


/** Determine the archive location for a batch rather than using the first receipt. */
export function batchArchiveLocation(locations: readonly string[], fileName: string): string {
  if (locations.length === 0) throw new Error('Leerer PDF-Sammelbericht.');
  if (/Alle[- ]Standorte/i.test(fileName) ||
      new Set(locations.map((location) => location.trim().toLocaleLowerCase('de-DE'))).size > 1) {
    return 'Alle Standorte';
  }
  return locations[0];
}
