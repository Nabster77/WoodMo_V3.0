import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { buildJournalHTML, type JournalReportData } from '@/lib/journalPdf';
import { getWeekNumber } from '@/lib/format';
import type { Location } from '@/types';
import { colorNegativeMoney } from '@/lib/movementStyle';
import { archiveDate, batchArchiveLocation, safeArchiveFileName } from '@/lib/archivePaths';
import { ensureReportFolder, ensureYearStructure, saveFileNoOverwrite, savePdfInFolder } from '@/lib/archiveFolders';
import { BACKUP_FOLDER } from '@/lib/archiveRoot';
import { readDeviceSetup } from '@/lib/deviceSetup';
import { archiveRootName, wrongArchiveFolderMessage } from '@/lib/archiveRoot';
import { PdfArchiveSetupRequired, requirePdfArchiveSetup } from '@/lib/pdfArchiveSetup';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const ALL_LABEL = 'Alle-Standorte';
const RENDER_WIDTH_PX = 900;
const PDF_MARGIN_X_MM = 14;
const PDF_CONTENT_TOP_MM = 14;
const PDF_CONTENT_BOTTOM_MM = 20;

export type JournalKind = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

function dmy(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function journalPart(kind: JournalKind, start: number, end: number): string {
  const d = new Date(start);
  switch (kind) {
    case 'daily': return `Tagesjournal_${dmy(start)}`;
    case 'weekly': return `Wochenjournal_KW${getWeekNumber(start)}`;
    case 'monthly': return `Monatsjournal_${MONTHS_SHORT[d.getMonth()]}-${d.getFullYear()}`;
    case 'yearly': return `Jahresjournal_${d.getFullYear()}`;
    case 'custom': return `Journal_${dmy(start)}_bis_${dmy(end)}`;
  }
}

export function buildJournalFileName(kind: JournalKind, start: number, end: number, location: Location | 'all'): string {
  const ort = location === 'all' ? ALL_LABEL : location;
  return `${ort}_${journalPart(kind, start, end)}.pdf`;
}

type SaveFilePicker = (options: {
  suggestedName: string;
  startIn: 'desktop';
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

type DirectoryPicker = (options: {
  id: string;
  mode: 'readwrite';
  startIn: 'documents';
}) => Promise<FileSystemDirectoryHandle>;

type WritableDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
};

const EXPORT_FOLDER_DB = 'holzbar-journal-export';
const EXPORT_FOLDER_STORE = 'settings';
const EXPORT_FOLDER_KEY = 'base-folder';

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function openExportFolderDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(EXPORT_FOLDER_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(EXPORT_FOLDER_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadExportFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openExportFolderDatabase();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(EXPORT_FOLDER_STORE, 'readonly').objectStore(EXPORT_FOLDER_STORE).get(EXPORT_FOLDER_KEY);
      request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function rememberExportFolder(folder: FileSystemDirectoryHandle): Promise<void> {
  const db = await openExportFolderDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(EXPORT_FOLDER_STORE, 'readwrite').objectStore(EXPORT_FOLDER_STORE).put(folder, EXPORT_FOLDER_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function canWrite(folder: WritableDirectoryHandle): Promise<boolean> {
  try {
    const permission = await folder.queryPermission?.({ mode: 'readwrite' });
    if (permission === 'granted') return true;
    return (await folder.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** True if this browser can let the user pick a folder (Chrome/Edge, recent Android Chrome). */
export function folderPickerSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export type ArchiveFolderStatus = 'ok' | 'needs-permission' | 'missing';

/** Check at app start WITHOUT prompting (no tap available yet). */
export async function archiveFolderStatus(): Promise<ArchiveFolderStatus> {
  const folder = await loadExportFolder() as WritableDirectoryHandle | null;
  if (!folder) return 'missing';
  try {
    const permission = await folder.queryPermission?.({ mode: 'readwrite' });
    return permission === 'granted' ? 'ok' : 'needs-permission';
  } catch {
    return 'needs-permission';
  }
}

/**
 * Must be called directly from a tap. Re-grants access to the remembered
 * folder (Android forgets it after the app is closed) and recreates any
 * missing subfolder. A removed „Kasse JJJJ“ leads back to the Setup.
 */
export async function grantArchiveFolder(): Promise<boolean> {
  const folder = await loadExportFolder() as WritableDirectoryHandle | null;
  if (!folder) return false;
  let permission: PermissionState | undefined;
  try {
    permission = await folder.queryPermission?.({ mode: 'readwrite' });
    if (permission !== 'granted') permission = await folder.requestPermission?.({ mode: 'readwrite' });
  } catch {
    return false;
  }
  if (permission !== 'granted') return false;
  await ensureYearStructure(folder, Date.now());
  return true;
}

/** Called directly from a user click in the first-run/administration Setup.
 * Directory handles are persisted in IndexedDB (not embedded in an URL).
 * Android browsers may not support selecting a persistent local folder.
 */
/**
 * Call as the FIRST thing in a tap that will save files later (daily close,
 * backup). Android Chrome forgets folder access after a reload and only
 * grants it again during a tap. Never throws; asks at most once per start.
 */
export async function requestArchiveAccess(): Promise<void> {
  if (readDeviceSetup()?.archiveMode !== 'folder') return;
  try {
    const folder = await loadExportFolder();
    if (folder) await canWrite(folder as WritableDirectoryHandle);
  } catch { /* The later save shows the real problem. */ }
}

export type FolderSetupResult = { mode: 'folder' | 'downloads' | 'cancelled' | 'needs-write'; folderName?: string };

let pendingFolder: WritableDirectoryHandle | null = null;

async function finishFolderSetup(selected: WritableDirectoryHandle): Promise<FolderSetupResult> {
  // Only create missing components of this year's base structure.
  const configuredAt = Date.now();
  await ensureYearStructure(selected, configuredAt);
  await rememberExportFolder(selected);
  pendingFolder = null;
  return { mode: 'folder', folderName: `${selected.name}/${archiveRootName(configuredAt)}` };
}

export async function configureJournalExportFolder(): Promise<FolderSetupResult> {
  const picker = (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  if (!picker) return { mode: 'downloads' };
  try {
    // Call picker directly from the button handler to preserve user activation.
    const selected = await picker({ id: 'holzbar-journal-exports', mode: 'readwrite', startIn: 'documents' }) as WritableDirectoryHandle;
    const wrongFolder = wrongArchiveFolderMessage(selected.name);
    if (wrongFolder) throw new Error(wrongFolder);
    // Android may grant only READ access at this point although readwrite was
    // requested. Writing then fails with NotAllowedError. In that case a
    // second, fresh tap must ask for write access (see grantWriteForPendingFolder).
    let permission: PermissionState | undefined;
    try { permission = await selected.queryPermission?.({ mode: 'readwrite' }); } catch { permission = undefined; }
    if (permission !== undefined && permission !== 'granted') {
      try { permission = await selected.requestPermission?.({ mode: 'readwrite' }); } catch { /* needs a new tap */ }
    }
    if (permission !== undefined && permission !== 'granted') {
      pendingFolder = selected;
      return { mode: 'needs-write', folderName: selected.name };
    }
    try {
      return await finishFolderSetup(selected);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        pendingFolder = selected;
        return { mode: 'needs-write', folderName: selected.name };
      }
      throw error;
    }
  } catch (error) {
    if (isAbortError(error)) return { mode: 'cancelled' };
    throw error;
  }
}

/** Second tap in the Setup: ask Android for WRITE access to the chosen folder. */
export async function grantWriteForPendingFolder(): Promise<FolderSetupResult> {
  const selected = pendingFolder;
  if (!selected) return { mode: 'cancelled' };
  let permission: PermissionState | undefined;
  try {
    permission = await selected.requestPermission?.({ mode: 'readwrite' });
  } catch (error) {
    throw new Error(`Schreibzugriff konnte nicht angefragt werden (${error instanceof Error ? error.name + ': ' + error.message : String(error)}).`);
  }
  if (permission !== undefined && permission !== 'granted') {
    throw new Error(`Das Tablet erlaubt das Schreiben in „${selected.name}“ nicht (Status: ${permission}). Bitte erneut versuchen oder einen anderen Ordner wählen, z. B. einen neuen Ordner unter „Documents“.`);
  }
  try {
    return await finishFolderSetup(selected);
  } catch (error) {
    if (error instanceof DOMException) {
      throw new Error(`Ordner „${selected.name}“ ist nicht beschreibbar (${error.name}). Dieses Tablet lässt Web-Apps hier keine Ordner anlegen.`);
    }
    throw error;
  }
}

/*
 * Ordnerregel (Wunsch des Nutzers, 15.11.2026): Im zuletzt gewählten Ordner
 * wird „Kasse JJJJ“ samt Unterordnern benutzt, wenn er existiert, und sonst
 * still neu angelegt – auch wenn ihn jemand gelöscht hat. Kein erneutes Setup.
 * Nur wenn der gewählte Ordner selbst fehlt, fragt das Setup neu
 * (siehe canWrite / localArchiveFolder / saveManualPdfToConfiguredArchive).
 */

async function saveIntoJournalFolder(folder: FileSystemDirectoryHandle, data: JournalReportData, blob: Blob): Promise<void> {
  if (data.documentStatus === 'Endgültig abgeschlossen' && data.reportPeriodStart == null) {
    throw new Error('Für einen endgültigen Tagesabschluss fehlt das originale Berichtsdatum.');
  }
  const now = Date.now();
  const target = await ensureReportFolder(folder, data, now);
  // Never overwrite: an existing name gets a copy "Name (1).pdf".
  await savePdfInFolder(target, safeArchiveFileName(data.fileName), blob);
}

type ArchiveTarget = { mode: 'downloads' } | { mode: 'fallback' } | { mode: 'folder'; folder: FileSystemDirectoryHandle };

/**
 * Get write access BEFORE rendering: Android only grants folder access during
 * the tap itself, and rendering a PDF takes longer than that window.
 */
async function acquireArchiveTarget(): Promise<ArchiveTarget> {
  const setup = readDeviceSetup();
  if (!setup) return requirePdfArchiveSetup('Für den PDF-Export muss zuerst auf diesem Gerät ein Speicherort im Setup eingerichtet werden.');
  if (setup.archiveMode === 'downloads') return { mode: 'downloads' };
  const folder = await loadExportFolder() as WritableDirectoryHandle | null;
  if (!folder) return requirePdfArchiveSetup('Für den PDF-Export muss zuerst auf diesem Gerät ein Speicherort im Setup eingerichtet werden.');
  // Access refused or not granted in this tap: never lose the PDF.
  if (!(await canWrite(folder))) return { mode: 'fallback' };
  return { mode: 'folder', folder };
}

/**
 * Backup JSON: with a configured folder it goes to „Kasse JJJJ/Backup“
 * (never overwriting), otherwise it is downloaded as before.
 * Call prepareBackupTarget() at the very start of the click handler.
 */
export async function prepareBackupTarget(): Promise<ArchiveTarget> {
  const setup = readDeviceSetup();
  if (setup?.archiveMode !== 'folder') return { mode: 'downloads' };
  return { mode: 'folder', folder: await localArchiveFolder() };
}

export async function saveBackupFile(target: ArchiveTarget, blob: Blob, fileName: string): Promise<string> {
  if (target.mode !== 'folder') {
    downloadBlob(blob, fileName);
    return fileName;
  }
  const now = Date.now();
  const root = await ensureYearStructure(target.folder, now);
  const backup = await root.getDirectoryHandle(BACKUP_FOLDER, { create: true });
  const written = await saveFileNoOverwrite(backup, fileName, blob);
  return `${archiveRootName(now)}/${BACKUP_FOLDER}/${written}`;
}

function waitForLoad(iframe: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve, reject) => {
    iframe.onload = () => resolve();
    iframe.onerror = () => reject(new Error('Das Journal konnte nicht für den PDF-Export vorbereitet werden.'));
  });
}

type ProtectedTableBlock = {
  /** First pixel of the section heading. */
  start: number;
  /** Bottom edge of the table heading plus its first visible content row. */
  requiredEnd: number;
  end: number;
};

function relativeTop(element: Element, bodyRect: DOMRect): number {
  return Math.round(element.getBoundingClientRect().top - bodyRect.top);
}

function relativeBottom(element: Element, bodyRect: DOMRect): number {
  return Math.round(element.getBoundingClientRect().bottom - bodyRect.top);
}

/**
 * Returns the table which belongs to a section title. Some journal sections
 * already have a wrapper, while compact sections such as "Bestseller" place
 * an h2 directly before the table. Both forms must be protected equally.
 */
function tableForHeading(heading: HTMLElement): HTMLTableElement | null {
  let sibling = heading.nextElementSibling;
  while (sibling) {
    if (sibling instanceof HTMLHeadingElement) return null;
    if (sibling instanceof HTMLTableElement) return sibling;
    const table = sibling.querySelector('table');
    if (table instanceof HTMLTableElement) return table;
    sibling = sibling.nextElementSibling;
  }
  return null;
}

/**
 * Finds title + table combinations that must never be split before their
 * first visible content row. This is calculated from the real print DOM,
 * because the PDF itself is produced from a canvas and does not honour CSS
 * page-break rules while being sliced into pages.
 */
function protectedTableBlocks(doc: Document, bodyRect: DOMRect): ProtectedTableBlock[] {
  const blocks = new Map<number, ProtectedTableBlock>();

  const add = (title: Element | null, table: HTMLTableElement | null) => {
    if (!title || !table) return;
    const start = relativeTop(title, bodyRect);
    const firstRow = table.querySelector('tbody tr');
    // An empty table still has an explanatory row ("Keine …"). If a report
    // ever has no tbody row, keep its table header with the title as well.
    const requiredEnd = firstRow
      ? relativeBottom(firstRow, bodyRect)
      : relativeBottom(table.querySelector('thead') ?? table, bodyRect);
    const existing = blocks.get(start);
    if (!existing || requiredEnd > existing.requiredEnd) blocks.set(start, { start, requiredEnd, end: relativeBottom(table, bodyRect) });
  };

  // Wrapped sections are used by the journal and the daily-close report.
  for (const section of doc.querySelectorAll<HTMLElement>('.report-table-section, .report-block, .staff-times')) {
    const table = section.querySelector<HTMLTableElement>('table');
    // Journal table titles are intentionally part of the THEAD. Unlike an h2
    // this is print-safe, so it must also be the protected break anchor.
    add(table?.querySelector('.table-title-row') ?? section.querySelector<HTMLElement>('h2'), table);
  }

  // Legacy/daily-close sections still use a regular h2 before their table.
  for (const heading of doc.querySelectorAll<HTMLElement>('h2')) add(heading, tableForHeading(heading));

  // Compact journal tables (for example Bestseller) have no external h2:
  // their title is a THEAD row. Add every such table explicitly so a page is
  // always cut before the title row, never between title and first data row.
  for (const table of doc.querySelectorAll<HTMLTableElement>('table')) {
    add(table.querySelector('.table-title-row'), table);
  }

  return [...blocks.values()].sort((a, b) => a.start - b.start);
}

/**
 * Determines page breaks at real content boundaries before any bitmap is
 * sliced. A title, its table header and the first row are treated as one
 * unit, preventing isolated table titles at the bottom of a page.
 */
type PageSlice = { from: number; until: number; header?: { start: number; end: number } };

function getSafePages(doc: Document, maxPageHeightPx: number): PageSlice[] {
  const body = doc.body;
  const bodyRect = body.getBoundingClientRect();
  const totalHeight = Math.ceil(Math.max(body.scrollHeight, bodyRect.height));
  const candidates = [...doc.querySelectorAll<HTMLElement>('.loc-header, .summary-grid, .tax-section, h2, tr, table, .empty, .batch-pagebreak')]
    .flatMap((el) => [relativeTop(el, bodyRect), relativeBottom(el, bodyRect)])
    .filter((top) => top > 0 && top < totalHeight)
    .sort((a, b) => a - b);
  const tableBlocks = protectedTableBlocks(doc, bodyRect);
  // Keep a short document footer with the final table instead of creating a
  // nearly empty extra page just for the "automatisch generiert" line.
  const footer = doc.querySelector('.footer');
  const lastTable = [...tableBlocks].sort((a, b) => b.end - a.end)[0];
  if (footer && lastTable) {
    const footerEnd = relativeBottom(footer, bodyRect);
    if (relativeTop(footer, bodyRect) >= lastTable.end && footerEnd - lastTable.start <= maxPageHeightPx) lastTable.end = footerEnd;
  }
  const tables = [...doc.querySelectorAll<HTMLTableElement>('table')].flatMap(table => {
    const head = table.querySelector('thead');
    return head ? [{ start: relativeTop(head, bodyRect), end: relativeBottom(head, bodyRect), tableEnd: relativeBottom(table, bodyRect) }] : [];
  });
  // Unlike browser printing, canvas slicing does not repeat THEAD automatically.
  const rows = [...doc.querySelectorAll('tr')].map(row => ({ start: relativeTop(row, bodyRect), end: relativeBottom(row, bodyRect) }));
  // A daily close also has sections without a table (e.g. deposit control).
  // Keep their heading with the box rather than leaving it on the prior page.
  const textSections = [...doc.querySelectorAll('.report-block')]
    .filter(section => !section.querySelector('table'))
    .map(section => ({ start: relativeTop(section, bodyRect), end: relativeBottom(section, bodyRect) }))
    .filter(section => section.end - section.start <= maxPageHeightPx);

  const pages: PageSlice[] = [];
  let from = 0;
  while (from < totalHeight) {
    const head = tables.find(table => from >= table.end && from < table.tableEnd);
    const header = head && head.end - head.start < maxPageHeightPx / 2 ? { start: head.start, end: head.end } : undefined;
    const capacity = maxPageHeightPx - (header ? header.end - header.start : 0);
    const target = Math.min(from + capacity, totalHeight);
    if (target === totalHeight) {
      pages.push({ from, until: totalHeight, header });
      break;
    }

    // Short tables move as a whole; long tables protect title + first row.
    const protectedRanges = tableBlocks.map(block => ({ start: block.start,
      end: block.end - block.start <= maxPageHeightPx ? block.end : block.requiredEnd,
    }));
    const unbrokenRows = rows.filter(row => row.end - row.start <= capacity);
    const isSafe = (point: number) => ![...protectedRanges, ...unbrokenRows, ...textSections]
      .some(block => point > block.start && point < block.end);
    const safe = candidates.filter(point => point > from && point <= target && isSafe(point)).pop();
    const next = safe ?? target;
    pages.push({ from, until: next, header });
    from = next;
  }
  return pages;
}

/** Renders HTML into a real PDF with stable, printed page numbers. */
export async function renderPdfHtml(html: string): Promise<Blob> {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${RENDER_WIDTH_PX}px;height:1200px;border:0;background:#fff`;
  iframe.srcdoc = html;
  document.body.appendChild(iframe);

  try {
    await waitForLoad(iframe);
    const doc = iframe.contentDocument;
    const body = doc?.body;
    if (!doc || !body) throw new Error('Das Journal konnte nicht gerendert werden.');
    colorNegativeMoney(doc);
    // The measurement iframe is shorter than a multi-page document. Its
    // scrollbar must not reduce the layout width: html2canvas's tall clone
    // has no scrollbar and would otherwise wrap text differently after cuts
    // have already been measured (even clipping headings at page boundaries).
    doc.documentElement.style.overflow = 'hidden';
    await doc.fonts.ready;

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const contentWidth = pageWidth - PDF_MARGIN_X_MM * 2;
    const contentHeight = pageHeight - PDF_CONTENT_TOP_MM - PDF_CONTENT_BOTTOM_MM;
    const maxPageHeightPx = Math.floor(contentHeight / (contentWidth / RENDER_WIDTH_PX));
    let pages: PageSlice[] = [];
    let pageLabels: { start: number; text: string; color: string }[] = [];

    const canvas = await html2canvas(body, {
      scale: 2,
      width: RENDER_WIDTH_PX,
      windowWidth: RENDER_WIDTH_PX,
      windowHeight: Math.max(body.scrollHeight, 1200),
      backgroundColor: '#ffffff',
      useCORS: true,
      // Measure the very DOM that is rasterized. html2canvas may reflow a
      // cloned table; measuring the original can cut through a title instead.
      onclone: (renderDoc) => {
        pages = getSafePages(renderDoc, maxPageHeightPx);
        const bounds = renderDoc.body.getBoundingClientRect();
        pageLabels = [...renderDoc.querySelectorAll<HTMLElement>('[data-pdf-page-header]')]
          .map(element => ({ start: relativeTop(element, bounds), text: element.dataset.pdfPageHeader ?? '',
            color: element.dataset.pdfPageLocation === 'Bregenz' ? '#0f766e' : '#1e3a5f' }))
          .filter(label => label.text.trim()).sort((a, b) => a.start - b.start);
      },
    });
    const canvasScale = canvas.width / RENDER_WIDTH_PX;

    pages.forEach(({ from, until, header }, index) => {
      if (index > 0) pdf.addPage();
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      const headerHeight = header ? Math.round((header.end - header.start) * canvasScale) : 0;
      const contentHeight = Math.max(1, Math.round((until - from) * canvasScale));
      slice.height = contentHeight + headerHeight;
      const context = slice.getContext('2d');
      if (header) context?.drawImage(canvas, 0, Math.round(header.start * canvasScale), canvas.width, headerHeight, 0, 0, canvas.width, headerHeight);
      context?.drawImage(
        canvas,
        0,
        Math.round(from * canvasScale),
        canvas.width,
        contentHeight,
        0,
        headerHeight,
        canvas.width,
        contentHeight,
      );

      const sliceHeightMm = (slice.height / canvas.width) * contentWidth;
      pdf.addImage(slice.toDataURL('image/png'), 'PNG', PDF_MARGIN_X_MM, PDF_CONTENT_TOP_MM, contentWidth, sliceHeightMm, undefined, 'FAST');
      const label = pageLabels.filter(candidate => candidate.start <= from).pop();
      if (index > 0 && label && from > label.start) {
        // Use the existing top margin, leaving pagination and totals unchanged.
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        const width = pdf.getTextWidth(label.text);
        if (width > contentWidth) pdf.setFontSize(8 * contentWidth / width);
        pdf.setTextColor(label.color);
        pdf.text(label.text, PDF_MARGIN_X_MM, 8);
      }
      pdf.setDrawColor(203, 213, 225);
      pdf.line(PDF_MARGIN_X_MM, pageHeight - 13, pageWidth - PDF_MARGIN_X_MM, pageHeight - 13);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(71, 85, 105);
      pdf.text(`Seite ${index + 1} von ${pages.length}`, pageWidth - PDF_MARGIN_X_MM, pageHeight - 8, { align: 'right' });
    });

    return pdf.output('blob');
  } finally {
    iframe.remove();
  }
}

async function renderJournalPdf(data: JournalReportData): Promise<Blob> {
  return renderPdfHtml(buildJournalHTML(data));
}

/** Builds one print/PDF document. Every selected daily close starts on a new page. */
export function buildJournalBatchHTML(reports: JournalReportData[]): string {
  if (reports.length === 1) return buildJournalHTML(reports[0]);
  const first = buildJournalHTML(reports[0]);
  const style = first.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const bodies = reports.map((report) => {
    const html = buildJournalHTML(report);
    return html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '';
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Tagesabschlüsse</title><style>${style}\n.batch-document{break-after:page;page-break-after:always}.batch-document:last-child{break-after:auto;page-break-after:auto}</style></head><body>${bodies.map((body) => `<section class="batch-document">${body}</section>`).join('')}</body></html>`;
}

/** Opens the browser/system save flow. This never uses the automatic journal folder. */
async function savePdfWithUserChoice(data: JournalReportData, blob: Blob): Promise<boolean> {
  const file = new File([blob], data.fileName, { type: 'application/pdf' });
  const showSaveFilePicker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;

  if (showSaveFilePicker) {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: data.fileName,
        startIn: 'desktop',
        types: [{ description: 'PDF-Datei', accept: { 'application/pdf': ['.pdf'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if (isAbortError(err)) return false;
    }
  }

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: data.fileName });
      return true;
    } catch (err) {
      if (isAbortError(err)) return false;
    }
  }

  downloadBlob(blob, data.fileName);
  return true; // Browser download initiated; completion is controlled by the browser.
}

/**
 * Manual PDFs are created from the available transaction/session data, never
 * uploaded as files to Supabase. On a configured folder device they must use
 * that device's folder; losing access is NOT a silent redirect to Downloads.
 */
async function localArchiveFolder(): Promise<FileSystemDirectoryHandle> {
  const stored = await loadExportFolder();
  if (!stored || !(await canWrite(stored as WritableDirectoryHandle))) {
    return requirePdfArchiveSetup(
      'Der eingestellte PDF-Speicherordner ist auf diesem Gerät nicht mehr verfügbar. Bitte im Geräte-Setup den Ordner erneut auswählen.',
    );
  }
  return stored;
}

async function saveManualPdfToConfiguredArchive(target: ArchiveTarget, data: JournalReportData, blob: Blob): Promise<void> {
  if (target.mode === 'downloads') {
    const started = await savePdfWithUserChoice(data, blob);
    if (!started) throw new Error('PDF-Speicherung wurde abgebrochen.');
    return;
  }
  if (target.mode === 'fallback') {
    downloadBlob(blob, safeArchiveFileName(data.fileName));
    alert('Der Speicherordner war nicht freigegeben. Das PDF wurde stattdessen im Ordner „Download“ gespeichert.');
    return;
  }
  const selected = target.folder;
  try {
    await saveIntoJournalFolder(selected, data, blob);
  } catch (error) {
    if (error instanceof PdfArchiveSetupRequired) throw error;
    console.warn('Der eingestellte PDF-Ordner kann nicht beschrieben werden.', error);
    return requirePdfArchiveSetup('Der PDF-Speicherordner oder ein benötigter Unterordner ist nicht beschreibbar. Bitte den Speicherort im Geräte-Setup überprüfen.');
  }
}

function showPdfExportError(error: unknown): void {
  if (error instanceof PdfArchiveSetupRequired) return; // Setup dialog contains the warning.
  console.error('PDF konnte auf diesem Gerät nicht gespeichert werden.', error);
  alert(error instanceof Error ? error.message : 'Der lokale PDF-Export ist fehlgeschlagen.');
}

/** Export an independently formatted audit document through the same local
 * PDF archive setup as the journal. The HTML is generated in-app, never sent to
 * Supabase or a third-party PDF service.
 */
export async function exportAuditDocumentPdf(data: JournalReportData, html: string): Promise<boolean> {
  try {
    const target = await acquireArchiveTarget();
    const blob = await renderPdfHtml(html);
    await saveManualPdfToConfiguredArchive(target, data, blob);
    return true;
  } catch (error) {
    showPdfExportError(error);
    return false;
  }
}

export async function exportJournalPdf(data: JournalReportData): Promise<void> {
  try {
    const target = await acquireArchiveTarget();
    const blob = await renderJournalPdf(data);
    await saveManualPdfToConfiguredArchive(target, data, blob);
  } catch (error) {
    showPdfExportError(error);
  }
}

export async function exportJournalPdfBatch(reports: JournalReportData[], fileName: string): Promise<void> {
  if (reports.length === 0) return;
  try {
    const target = await acquireArchiveTarget();
    const blob = await renderPdfHtml(buildJournalBatchHTML(reports));
    const location = batchArchiveLocation(reports.map((report) => report.location), fileName);
    const archiveData = { ...reports[0], location, fileName };
    await saveManualPdfToConfiguredArchive(target, archiveData, blob);
  } catch (error) {
    showPdfExportError(error);
  }
}

// Browsers intentionally control printer selection and the "Save as PDF"
// destination. The document title supplies the native dialog's file-name
// suggestion without bypassing that browser safety boundary.
export function openJournalPrintDialog(data: JournalReportData): void {
  openPrintHtml(buildJournalHTML(data));
}

export function openJournalPrintBatch(reports: JournalReportData[]): void {
  if (reports.length === 0) return;
  openPrintHtml(buildJournalBatchHTML(reports));
}

function openPrintHtml(html: string): void {
  const printWindow = window.open('', '_blank', 'width=960,height=760');
  if (!printWindow) throw new Error('Der Druckdialog konnte nicht geöffnet werden. Bitte Popups erlauben.');

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  colorNegativeMoney(printWindow.document);

  let printStarted = false;
  const print = () => {
    if (printStarted || printWindow.closed) return;
    printStarted = true;
    printWindow.focus();
    printWindow.print();
  };
  // document.write()/close() creates a complete local document. One guarded
  // delayed call is enough; an additional load handler opened the dialog twice
  // in some Firefox installations.
  window.setTimeout(print, 250);
}

/**
 * After a daily close (no tap active any more): save into the folder only if
 * access is still granted. Otherwise report 'needs-tap' – the app then shows
 * a „PDF jetzt speichern“ button. Never opens the Setup by itself.
 */
export async function saveJournalPdfIfAllowed(data: JournalReportData): Promise<'saved' | 'needs-tap'> {
  const setup = readDeviceSetup();
  if (setup?.archiveMode !== 'folder') {
    await saveJournalPdf(data);
    return 'saved';
  }
  const folder = await loadExportFolder() as WritableDirectoryHandle | null;
  if (!folder) return 'needs-tap';
  let permission: PermissionState | undefined;
  try { permission = await folder.queryPermission?.({ mode: 'readwrite' }); } catch { permission = undefined; }
  if (permission !== 'granted') return 'needs-tap';
  const blob = await renderJournalPdf(data);
  try {
    await saveIntoJournalFolder(folder, data, blob);
    return 'saved';
  } catch {
    return 'needs-tap';
  }
}

/**
 * Called directly from the „PDF jetzt speichern“ tap. Asks for folder access
 * FIRST (needs the tap), then saves into „Kasse JJJJ/…“. If the folder cannot
 * be used, the PDF is downloaded instead, so it is never lost.
 * Returns a short German description of where the file went.
 */
export async function saveJournalPdfFromTap(data: JournalReportData): Promise<string> {
  const folder = readDeviceSetup()?.archiveMode === 'folder'
    ? await loadExportFolder() as WritableDirectoryHandle | null
    : null;
  const allowed = folder ? await canWrite(folder) : false;
  const blob = await renderJournalPdf(data);
  if (folder && allowed) {
    try {
      await saveIntoJournalFolder(folder, data, blob);
      return `im Speicherordner „${folder.name}“ unter ${archiveRootName(archiveDate(data))}`;
    } catch (error) {
      console.warn('PDF konnte nicht im Speicherordner abgelegt werden, Download stattdessen.', error);
    }
  }
  downloadBlob(blob, safeArchiveFileName(data.fileName));
  return 'im Ordner „Download“ (der Speicherordner war nicht freigegeben)';
}

// Daily-close PDFs are kept on this device only. Cloud stores the underlying
// receipts and finalized cash sessions, not a copy of the generated PDF.
export async function saveJournalPdf(data: JournalReportData): Promise<void> {
  const setup = readDeviceSetup();
  if (!setup) return requirePdfArchiveSetup('Bitte zuerst den PDF-Speicherort im Geräte-Setup festlegen.');

  if (setup.archiveMode === 'downloads') {
    const blob = await renderJournalPdf(data);
    const saved = await savePdfWithUserChoice(data, blob);
    if (!saved) throw new Error('PDF-Speicherung abgebrochen. Der Tagesabschluss bleibt unverändert.');
    return;
  }

  const folder = await localArchiveFolder();
  const blob = await renderJournalPdf(data);
  try {
    await saveIntoJournalFolder(folder, data, blob);
  } catch (error) {
    if (error instanceof PdfArchiveSetupRequired) throw error;
    console.warn('Tagesabschluss-PDF konnte nicht lokal archiviert werden.', error);
    return requirePdfArchiveSetup('Der Tagesabschluss ist als Buchung erfasst, aber das PDF konnte nicht im gewählten lokalen Ordner gespeichert werden. Bitte den Speicherort im Setup reparieren und das PDF aus dem Journal erneut erzeugen.');
  }
}
