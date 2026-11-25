import { useCallback, useEffect, useState } from 'react';
import { X, Folder, FileText, Copy, Scissors, ClipboardPaste, FolderPlus, Trash2, Download, ArrowUp, Wrench, Loader2 } from 'lucide-react';
import { loadExportFolder, requestArchivePermission, grantArchiveFolder } from '@/lib/journalPdfFile';

interface WritableStream { write(data: Blob): Promise<void>; close(): Promise<void> }
interface FileEntry { kind: 'file'; name: string; getFile(): Promise<File>; createWritable(): Promise<WritableStream> }
interface DirEntry {
  kind: 'directory'; name: string;
  values(): AsyncIterable<FileEntry | DirEntry>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirEntry>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileEntry>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  isSameEntry(other: unknown): Promise<boolean>;
  resolve(possibleDescendant: unknown): Promise<string[] | null>;
}
type AnyEntry = FileEntry | DirEntry;
interface Row { entry: AnyEntry; size?: number; modified?: number }
interface Clip { mode: 'copy' | 'cut'; parent: DirEntry; entries: AnyEntry[] }

function sizeText(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function exists(dir: DirEntry, name: string): Promise<boolean> {
  try { await dir.getFileHandle(name); return true; } catch { /* kein Datei-Eintrag */ }
  try { await dir.getDirectoryHandle(name); return true; } catch { return false; }
}

async function freeName(dir: DirEntry, name: string): Promise<string> {
  if (!await exists(dir, name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${base} (Kopie${i > 1 ? ' ' + i : ''})${ext}`;
    if (!await exists(dir, candidate)) return candidate;
  }
  throw new Error('Kein freier Name für ' + name);
}

async function copyEntry(entry: AnyEntry, target: DirEntry): Promise<void> {
  const name = await freeName(target, entry.name);
  if (entry.kind === 'file') {
    const file = await entry.getFile();
    const handle = await target.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
    return;
  }
  const created = await target.getDirectoryHandle(name, { create: true });
  for await (const child of entry.values()) await copyEntry(child, created);
}

export function FolderExplorerDialog({ onClose, deviceName }: { onClose: () => void; deviceName: string }) {
  const [root, setRoot] = useState<DirEntry | null>(null);
  const [stack, setStack] = useState<DirEntry[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clip, setClip] = useState<Clip | null>(null);
  const [busy, setBusy] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const current = stack.length ? stack[stack.length - 1] : root;

  const list = useCallback(async (dir: DirEntry) => {
    setBusy(true);
    try {
      const result: Row[] = [];
      for await (const entry of dir.values()) {
        if (result.length >= 1000) break;
        if (entry.kind === 'file') {
          try { const file = await entry.getFile(); result.push({ entry, size: file.size, modified: file.lastModified }); } catch { result.push({ entry }); }
        } else result.push({ entry });
      }
      result.sort((a, b) => (a.entry.kind === b.entry.kind ? a.entry.name.localeCompare(b.entry.name, 'de') : a.entry.kind === 'directory' ? -1 : 1));
      setRows(result);
      setSelected(new Set());
    } catch (error) {
      setMessage({ ok: false, text: 'Ordner nicht lesbar: ' + (error instanceof Error ? error.message : 'Fehler') });
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const permission = await requestArchivePermission();
      if (cancelled) return;
      if (permission === 'none') { setMessage({ ok: false, text: 'Noch kein Speicherordner festgelegt.' }); setBusy(false); return; }
      if (permission === 'denied') { setMessage({ ok: false, text: 'Zugriff auf den Speicherordner wurde nicht erlaubt.' }); setBusy(false); return; }
      const folder = await loadExportFolder() as unknown as DirEntry | null;
      if (cancelled || !folder) { setBusy(false); return; }
      setRoot(folder);
    })().catch(() => setBusy(false));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (current) void list(current); }, [current, list]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true); setMessage(null);
    try { const text = await action(); setMessage({ ok: true, text }); }
    catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : 'Aktion fehlgeschlagen.' }); }
    finally { if (current) await list(current); }
  };

  const chosen = rows.filter((row) => selected.has(row.entry.name)).map((row) => row.entry);
  const toggle = (name: string) => setSelected((old) => { const next = new Set(old); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  const pathText = [root?.name ?? 'Speicherordner', ...stack.map((dir) => dir.name)].join(' / ');

  const openFile = async (entry: FileEntry) => {
    try { const url = URL.createObjectURL(await entry.getFile()); window.open(url, '_blank'); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    catch { setMessage({ ok: false, text: 'Datei nicht lesbar.' }); }
  };
  const download = async (entry: FileEntry) => {
    const url = URL.createObjectURL(await entry.getFile());
    const link = document.createElement('a'); link.href = url; link.download = entry.name; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const paste = () => run(async () => {
    if (!clip || !current) return 'Nichts eingefügt.';
    let count = 0;
    for (const entry of clip.entries) {
      if (entry.kind === 'directory') {
        if (await entry.isSameEntry(current) || (await entry.resolve(current)) !== null) throw new Error(`„${entry.name}“ kann nicht in sich selbst eingefügt werden.`);
      }
      if (clip.mode === 'cut' && await clip.parent.isSameEntry(current)) continue;
      await copyEntry(entry, current);
      if (clip.mode === 'cut') await clip.parent.removeEntry(entry.name, { recursive: true });
      count += 1;
    }
    if (clip.mode === 'cut') setClip(null);
    return `${count} Eintrag/Einträge eingefügt.`;
  });

  const tool = 'flex h-9 items-center gap-1.5 rounded-md bg-white px-2.5 text-xs font-semibold text-slate-900 shadow-sm disabled:opacity-35 dark:bg-slate-700 dark:text-white';
  const sep = 'mx-0.5 h-6 w-px bg-slate-300 dark:bg-slate-600';

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/65 p-4 backdrop-blur-[2px]" onClick={(event) => { event.stopPropagation(); onClose(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <section role="dialog" aria-modal="true" aria-labelledby="woodmo-explorer-title" onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col gap-3 rounded-2xl border border-slate-300 bg-white p-4 text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between gap-3">
          <h2 id="woodmo-explorer-title" className="flex items-center gap-2 text-xl font-bold"><Folder className="h-5 w-5" /> Speicherordner · {deviceName}</h2>
          <button type="button" aria-label="Schließen" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-400"><X className="h-5 w-5" /></button>
        </div>
        <p className="break-all text-xs text-slate-600 dark:text-slate-300"><span className="font-bold">{deviceName}</span> · {pathText}</p>

        <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-100 p-1.5 dark:bg-slate-800">
          <button type="button" disabled={busy || !stack.length} onClick={() => setStack((old) => old.slice(0, -1))} className={tool}><ArrowUp className="h-4 w-4" /> Zurück</button>
          <span aria-hidden="true" className={sep} />
          <button type="button" disabled={busy || !chosen.length} onClick={() => { if (current) setClip({ mode: 'copy', parent: current, entries: chosen }); setMessage({ ok: true, text: `${chosen.length} kopiert.` }); }} className={tool}><Copy className="h-4 w-4" /> Kopieren</button>
          <button type="button" disabled={busy || !chosen.length} onClick={() => { if (current) setClip({ mode: 'cut', parent: current, entries: chosen }); setMessage({ ok: true, text: `${chosen.length} ausgeschnitten.` }); }} className={tool}><Scissors className="h-4 w-4" /> Ausschneiden</button>
          <button type="button" disabled={busy || !clip} onClick={() => void paste()} className={tool}><ClipboardPaste className="h-4 w-4" /> Einfügen</button>
          <span aria-hidden="true" className={sep} />
          <button type="button" disabled={busy || !current} onClick={() => setNewFolder('')} className={tool}><FolderPlus className="h-4 w-4" /> Neuer Ordner</button>
          <button type="button" disabled={busy || chosen.length !== 1 || chosen[0].kind !== 'file'} onClick={() => { const entry = chosen[0]; if (entry.kind === 'file') void download(entry); }} className={tool}><Download className="h-4 w-4" /> Herunterladen</button>
          <button type="button" disabled={busy || !chosen.length} onClick={() => setConfirmDelete(true)} className={`${tool} !text-red-700 dark:!text-red-400`}><Trash2 className="h-4 w-4" /> Löschen</button>
        </div>

        {newFolder !== null && (
          <form className="flex gap-2" onSubmit={(event) => {
            event.preventDefault();
            const name = newFolder.trim();
            setNewFolder(null);
            if (!name || !current) return;
            void run(async () => { await current.getDirectoryHandle(name, { create: true }); return `Ordner „${name}“ angelegt.`; });
          }}>
            <input autoFocus value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="Ordnername" aria-label="Ordnername"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
            <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white">Anlegen</button>
            <button type="button" onClick={() => setNewFolder(null)} className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-bold text-white">Abbrechen</button>
          </form>
        )}
        {confirmDelete && (
          <div role="alert" className="space-y-2 rounded-lg border border-red-400 p-3 text-sm">
            <p className="font-semibold">{chosen.length} Eintrag/Einträge endgültig löschen? Das kann nicht rückgängig gemacht werden.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => {
                setConfirmDelete(false);
                const parent = current;
                if (!parent) return;
                void run(async () => { for (const entry of chosen) await parent.removeEntry(entry.name, { recursive: true }); return 'Gelöscht.'; });
              }} className="rounded-lg bg-red-700 px-3 py-2 font-bold text-white">Ja, löschen</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg bg-slate-700 px-3 py-2 font-bold text-white">Abbrechen</button>
            </div>
          </div>
        )}
        {message && <p role={message.ok ? 'status' : 'alert'} className={`text-sm font-semibold ${message.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>{message.text}</p>}
        {clip && <p className="text-xs text-slate-500">Zwischenablage: {clip.entries.length} {clip.mode === 'copy' ? 'kopiert' : 'ausgeschnitten'}</p>}

        <div className="min-h-32 flex-1 overflow-y-auto rounded-lg border border-slate-300 dark:border-slate-700">
          {busy && <p className="flex items-center gap-2 p-3 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Lädt …</p>}
          {!busy && rows.length === 0 && <p className="p-3 text-sm text-slate-500">Dieser Ordner ist leer.</p>}
          <ul>
            {rows.map(({ entry, size, modified }) => (
              <li key={entry.name} className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 last:border-b-0 dark:border-slate-800">
                <input type="checkbox" aria-label={`${entry.name} auswählen`} checked={selected.has(entry.name)} onChange={() => toggle(entry.name)} className="h-5 w-5 shrink-0" />
                <button type="button" onClick={() => { if (entry.kind === 'directory') setStack((old) => [...old, entry]); else void openFile(entry); }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
                  {entry.kind === 'directory' ? <Folder className="h-4 w-4 shrink-0 text-amber-600" /> : <FileText className="h-4 w-4 shrink-0 text-slate-500" />}
                  <span className="min-w-0 break-all font-semibold">{entry.name}</span>
                </button>
                <span className="shrink-0 text-xs text-slate-500">{sizeText(size)}{modified ? ` · ${new Date(modified).toLocaleDateString('de-DE')}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
        <button type="button" disabled={busy} onClick={() => void run(async () => {
          const ok = await grantArchiveFolder();
          if (!ok) throw new Error('Struktur konnte nicht geprüft werden (Zugriff fehlt).');
          return 'Ordnerstruktur geprüft, fehlende Ordner wurden angelegt.';
        })} className="flex items-center gap-1.5 self-start text-xs font-semibold text-slate-600 underline disabled:opacity-40 dark:text-slate-300"><Wrench className="h-3.5 w-3.5" /> Struktur prüfen (fehlende Ordner anlegen)</button>
      </section>
    </div>
  );
}
