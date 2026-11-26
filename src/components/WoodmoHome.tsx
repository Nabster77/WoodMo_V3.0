import { Cloud, LockKeyhole, Settings2, WifiOff } from 'lucide-react';
import { APP_VERSION } from '@/lib/appVersion';
import type { Location } from '@/types';

interface Props {
  onCash: () => void;
  onAdmin: () => void;
  sessionOpen: boolean;
  location: Location;
  status: 'ok' | 'pending' | 'error';
  testMode: boolean;
  onSetup?: () => void;
  /** Version of a published update waiting for installation, if any. */
  updateWaiting?: string;
  onUpdate?: () => void;
}

/** WOODMO home: two existing routes, no invented features or register mutations. */
export function WoodmoHome({ onCash, onAdmin, sessionOpen, location, status, testMode, onSetup, updateWaiting, onUpdate }: Props) {
  const symbol = `${import.meta.env.BASE_URL}woodmo-cashmark-no-text.svg`;
  const watermark = 'pointer-events-none absolute grayscale dark:brightness-150 -right-5 top-1/2 h-40 w-40 -translate-y-1/2 rotate-[-12deg] opacity-[0.085] sm:-right-8 sm:h-52 sm:w-52';
  return (
    <section className="flex h-full min-h-0 items-center justify-center overflow-y-auto rounded-2xl gx-bg px-3 py-5 sm:px-6">
      <div className="my-auto flex w-full max-w-4xl flex-col items-center gap-6 py-3 sm:gap-8">
        <div className="text-center">
          <h1 className={`woodmo-title-3d text-4xl font-black tracking-wide sm:text-5xl ${status === 'ok' ? 'woodmo-title-ok' : status === 'error' ? 'woodmo-title-error' : ''}`}>WOODMO</h1>
          <p className="mt-4 text-sm gx-muted">Kassen-App Version {APP_VERSION}</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-3 sm:gap-5">
          <button type="button" onClick={onCash}
            className="gx-tile gx-tile-hi relative isolate flex min-h-[clamp(10rem,30vh,19rem)] flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl p-3 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:p-6">
            <img src={symbol} alt="" aria-hidden="true" className={watermark} />
            <span className="relative z-10 gx-chip rounded-2xl p-2.5">
              <img src={symbol} alt="" className="h-9 w-9 object-contain grayscale dark:brightness-150 sm:h-11 sm:w-11" />
            </span>
            <span className="relative z-10 text-xl font-extrabold sm:text-3xl">Kasse</span>
            <span className="relative z-10 text-xs gx-muted sm:text-base">{sessionOpen ? 'Kasse fortsetzen' : 'Kasse eröffnen'}</span>
          </button>
          <button type="button" onClick={onAdmin}
            className="gx-tile relative isolate flex min-h-[clamp(10rem,30vh,19rem)] flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl p-3 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:p-6">
            <img src={symbol} alt="" aria-hidden="true" className={watermark} />
            <span className="relative z-10 gx-chip rounded-2xl p-3">
              <Settings2 className="h-8 w-8 gx-text sm:h-10 sm:w-10" />
            </span>
            <span className="relative z-10 text-xl font-extrabold sm:text-3xl">Verwaltung</span>
            <span className="relative z-10 flex items-center justify-center gap-1 text-xs gx-muted sm:text-base">
              <LockKeyhole className="h-3.5 w-3.5" /> Administrator
            </span>
          </button>
        </div>
        <div className="flex max-w-full flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs gx-muted">
          <span className="flex items-center gap-1.5">
            {status === 'error' ? <WifiOff className="h-4 w-4 text-[color:var(--gx-err)]" /> : <Cloud className={`h-4 w-4 ${status === 'ok' ? 'text-[color:var(--gx-ok)]' : 'text-[color:var(--gx-warn)]'}`} />}
            {status === 'error' ? 'Cloud / Abgleich prüfen' : status === 'pending' ? 'Cloud-Abgleich läuft oder steht aus' : 'Cloud verbunden'}
          </span>
          {sessionOpen && <span>{location} · Kasse geöffnet</span>}
          {testMode && <span className="font-semibold text-[color:var(--gx-warn)]">TESTMODUS</span>}
        </div>
        <div className="relative flex w-full items-center justify-center">
          {onUpdate && <button type="button" onClick={onUpdate}
            title={updateWaiting ? `Update ${updateWaiting} wartet auf Installation` : 'Nach Updates suchen'}
            className={`absolute left-0 gx-btn min-h-9 rounded-xl px-3 text-xs font-semibold ${updateWaiting ? 'text-[color:var(--gx-ok)] motion-safe:animate-pulse' : ''}`}>
            {updateWaiting ? '● Update wartet' : 'Update'}
          </button>}
          <p className="px-28 text-center text-[11px] font-semibold gx-muted">Holz trifft Code · by Nabster77</p>
          {onSetup && <button type="button" onClick={onSetup}
            className="gx-btn absolute right-0 min-h-9 rounded-xl px-3 text-xs font-semibold">
            Setup
          </button>}
        </div>
      </div>
    </section>
  );
}
