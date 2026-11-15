import { useEffect } from 'react';
import { archiveFolderStatus } from '@/lib/journalPdfFile';
import { readDeviceSetup } from '@/lib/deviceSetup';

/**
 * No prompt at start: staff log in and sell without any message. Android
 * Chrome forgets folder access after a reload; it is asked again only at the
 * first actual save (daily close, PDF export, backup), inside that tap.
 * Only if no folder is stored at all does the Setup open.
 */
export function ArchivePermissionGate({ onOpenSetup, suspended }: { onOpenSetup: () => void; suspended: boolean }) {
  useEffect(() => {
    if (suspended || readDeviceSetup()?.archiveMode !== 'folder') return;
    let cancelled = false;
    void archiveFolderStatus().then((status) => {
      if (!cancelled && status === 'missing') onOpenSetup();
    });
    return () => { cancelled = true; };
  }, [suspended, onOpenSetup]);
  return null;
}
