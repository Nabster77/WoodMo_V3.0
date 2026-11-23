import { readDeviceSetup } from './deviceSetup';
import { loadExportFolder } from './journalPdfFile';
import { saveFileNoOverwrite } from './archiveFolders';
import type { OutboxEntry } from './outbox';

/** Secondary archive only. The IndexedDB queue remains the source for uploads. */
export async function mirrorOfflineEntries(entries: readonly OutboxEntry[]): Promise<void> {
  if (!entries.length || readDeviceSetup()?.archiveMode !== 'folder') return;
  const folder = await loadExportFolder();
  if (!folder) return;
  const access = folder as FileSystemDirectoryHandle & {
    queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  const permission = await access.queryPermission?.({ mode: 'readwrite' });
  if (permission !== undefined && permission !== 'granted') return;
  const copy = async () => {
    const target = await folder.getDirectoryHandle('Offline-Sicherung', { create: true });
    for (const entry of entries) {
      const json = JSON.stringify({ type: 'woodmo-offline-recovery', version: 1, entry });
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
      const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      const name = `${entry.table}-${hash}.json`;
      try {
        const file = await (await target.getFileHandle(name)).getFile();
        if (await file.text() === json) continue;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      }
      await saveFileNoOverwrite(target, name, new Blob([json], { type: 'application/json' }));
    }
  };
  if (navigator.locks) await navigator.locks.request('woodmo-offline-backup', copy);
  else await copy();
}
