import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    const installedHandler = () => {
      setInstalled(true);
      setVisible(false);
    };
    window.addEventListener('appinstalled', installedHandler);

    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) setInstalled(true);

    // Tablets: ask on EVERY start in the browser until the app is installed.
    // If the browser offers no install button (e.g. after an earlier „Abbrechen“
    // or in Samsung Internet), show how to install via the browser menu.
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const fallback = !standalone && touch ? window.setTimeout(() => setVisible(true), 1500) : undefined;

    return () => {
      if (fallback) window.clearTimeout(fallback);
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  if (!visible || installed) return null;

  return (
    <div className="pointer-events-auto fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-white p-3 shadow-xl dark:border-blue-800 dark:bg-gray-800">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
          <Download className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Bitte als App installieren</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {deferred
              ? 'Die Kasse ist für den Betrieb als App gedacht – mit festem Speicherordner, auch offline.'
              : 'Oben rechts im Browser-Menü ⋮ auf „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ tippen.'}
          </p>
        </div>
        {deferred && <button
          onClick={async () => {
            await deferred.prompt();
            setDeferred(null);
            setVisible(false);
          }}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-blue-700 active:scale-95"
        >
          Installieren
        </button>}
        <button
          onClick={() => setVisible(false)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          aria-label="Später"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
