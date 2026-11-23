import { useRef } from 'react';
import type { TouchEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { formatDateGermanFromISO, formatDateISO } from '@/lib/format';

/** Tag (JJJJ-MM-TT) um `days` verschieben. */
export function shiftIsoDay(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return formatDateISO(d.getTime());
}

/**
 * Wischen auf Tablets: nach links = nächster Tag, nach rechts = vorheriger Tag.
 * Nur deutlich waagerechte Wischer (≥ 60 px, doppelt so weit wie senkrecht) zählen,
 * damit normales Scrollen nichts umschaltet.
 */
export function useDaySwipe(onPrev: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (event: TouchEvent) => {
      const touch = event.touches[0];
      start.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
    },
    onTouchEnd: (event: TouchEvent) => {
      const from = start.current;
      start.current = null;
      const touch = event.changedTouches[0];
      if (!from || !touch) return;
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy)) return;
      if (dx > 0) onPrev(); else onNext();
    },
  };
}

interface Props {
  /** Angezeigter Tag (JJJJ-MM-TT). */
  value: string;
  onChange: (iso: string) => void;
  /** Spätester wählbarer Tag (heute). */
  max: string;
  /** Letzter Tag mit Umsatz (für den Button „Letzter Umsatztag“). */
  lastSalesDay?: string | null;
}

/** ‹ [Datum – antippen öffnet Kalender] › + „Letzter Umsatztag“. */
export function DateNav({ value, onChange, max, lastSalesDay }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const openPicker = () => {
    const input = picker.current;
    if (!input) return;
    try { input.showPicker(); } catch { input.focus(); input.click(); }
  };
  const atMax = value >= max;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-1.5 py-1 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <button type="button" onClick={() => onChange(shiftIsoDay(value, -1))} aria-label="Vorheriger Tag"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="relative">
          <button type="button" onClick={openPicker} aria-label="Kalender öffnen"
            className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-bold text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700">
            <CalendarDays className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {formatDateGermanFromISO(value)}
          </button>
          <input ref={picker} type="date" tabIndex={-1} aria-hidden="true" value={value} max={max}
            onChange={(event) => { const next = event.target.value; if (next && next <= max) onChange(next); }}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0" />
        </div>
        <button type="button" onClick={() => onChange(shiftIsoDay(value, 1))} disabled={atMax} aria-label="Nächster Tag"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-700">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      {lastSalesDay && lastSalesDay !== value && (
        <button type="button" onClick={() => onChange(lastSalesDay)}
          className="flex h-10 items-center gap-1.5 rounded-xl bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50">
          <History className="h-4 w-4" /> Letzter Umsatztag ({formatDateGermanFromISO(lastSalesDay)})
        </button>
      )}
      {value !== max && (
        <button type="button" onClick={() => onChange(max)}
          className="flex h-10 items-center rounded-xl border border-gray-300 px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
          Heute
        </button>
      )}
    </div>
  );
}
