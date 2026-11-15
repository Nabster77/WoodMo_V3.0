import { archiveRootName, BACKUP_FOLDER } from './archiveRoot';
import { archiveDate, archiveSubfolders, type ArchiveReport } from './archivePaths';

export const ARCHIVE_LOCATIONS = ['Friedrichshafen', 'Bregenz', 'Alle-Standorte'] as const;
/** Visible report folders beneath every location. Further types are created on demand. */
export const ARCHIVE_REPORT_FOLDERS = ['Tagesabschluss', 'Tagesjournal', 'Wochenjournal', 'Monatsjournal', 'Jahresjournal', 'Individuell'] as const;

/**
 * Structure beneath the folder the user selected once:
 *   Kasse JJJJ / Friedrichshafen | Bregenz | Alle-Standorte / <Berichtsart>
 *   Kasse JJJJ / Backup
 * Missing folders are created, existing folders and files are never replaced
 * or cleared, and a deleted subfolder is simply created again.
 */
export async function ensureYearStructure(
  parent: FileSystemDirectoryHandle,
  at: number,
): Promise<FileSystemDirectoryHandle> {
  const root = await parent.getDirectoryHandle(archiveRootName(at), { create: true });
  for (const location of ARCHIVE_LOCATIONS) {
    const folder = await root.getDirectoryHandle(location, { create: true });
    for (const kind of ARCHIVE_REPORT_FOLDERS) await folder.getDirectoryHandle(kind, { create: true });
  }
  await root.getDirectoryHandle(BACKUP_FOLDER, { create: true });
  return root;
}

/** True if the named subfolder exists, without creating it. */
export async function hasDirectory(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await parent.getDirectoryHandle(name);
    return true;
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')) return false;
    throw error;
  }
}

/**
 * Reports are filed in the calendar year of their period (daily closes: of
 * their closing), so a December report exported in January stays in last
 * year's „Kasse JJJJ“.
 */
export async function ensureReportFolder(
  parent: FileSystemDirectoryHandle,
  report: ArchiveReport,
  now = Date.now(),
): Promise<FileSystemDirectoryHandle> {
  await ensureYearStructure(parent, now);
  const root = await ensureYearStructure(parent, archiveDate(report, now));
  let target = root;
  for (const segment of archiveSubfolders(report)) {
    target = await target.getDirectoryHandle(segment, { create: true });
  }
  return target;
}

/** "Name.pdf" → "Name (1).pdf", "Name (2).pdf", … */
export function copyName(name: string, copy: number): string {
  if (copy < 1) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${copy})${name.slice(dot)}` : `${name} (${copy})`;
}

async function fileExists(folder: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await folder.getFileHandle(name);
    return true;
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')) return false;
    throw error;
  }
}

/**
 * Never overwrites: if the name is taken, the next free "Name (n).ext" is
 * used. Returns the name actually written. The file is read back and checked.
 */
export async function saveFileNoOverwrite(
  folder: FileSystemDirectoryHandle,
  name: string,
  contents: Blob,
): Promise<string> {
  let target = name;
  for (let copy = 1; await fileExists(folder, target); copy++) {
    if (copy > 9999) throw new Error('Zu viele Kopien mit demselben Dateinamen.');
    target = copyName(name, copy);
  }
  const handle = await folder.getFileHandle(target, { create: true });
  const writer = await handle.createWritable();
  try {
    await writer.write(contents);
    await writer.close();
  } catch (error) {
    try { await writer.abort(); } catch { /* Preserve original error. */ }
    throw error;
  }
  const written = await handle.getFile();
  if (written.size !== contents.size) throw new Error(`Die Datei „${target}“ wurde nicht vollständig gespeichert.`);
  return target;
}

/** PDF archive: same rule for every report, finalized or not: never overwrite. */
export async function savePdfInFolder(
  target: FileSystemDirectoryHandle,
  name: string,
  pdf: Blob,
): Promise<string> {
  return saveFileNoOverwrite(target, name, pdf);
}
