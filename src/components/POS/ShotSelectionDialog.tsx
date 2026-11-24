import type { Product, ShotOption, Location } from '@/types';
import { shotPriceForLocation } from '@/lib/shotCatalog';
import { REMOVE_ALL_SHOTS_ID, shotParts } from '@/lib/shotCombine';

import { X, Wine, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/format';

interface Props {
  product: Product;
  options: ShotOption[];
  location: Location;
  /** Schüsse, die schon in diesem Getränk sind (mehrere möglich). */
  current?: ShotOption | null;
  onSelect: (shot: ShotOption) => void;
  onCancel: () => void;
}

export function ShotSelectionDialog({ options, location, current, onSelect, onCancel }: Props) {
  const already = shotParts(current);
  // Ohne-Eintrag entfernt (22.11.): wer keinen Schuss will, öffnet das Fenster nicht.
  const availableOptions: ShotOption[] = options;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/50 p-4 sm:items-center" onClick={onCancel}>
      <div className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-gray-100">
            <Wine className="h-5 w-5 text-blue-600 dark:text-blue-400" /> Schussauswahl {location}
          </h3>
          <div className="flex items-center gap-1">
            {/* 24.11.: Papierkorb entfernt alle Schüsse dieser Warenkorbposition. */}
            <button type="button" aria-label="Alle Schüsse entfernen" title="Alle Schüsse entfernen" disabled={already.length === 0}
              onClick={() => onSelect({ id: REMOVE_ALL_SHOTS_ID, name: 'Alle Schüsse entfernen', price: 0 })}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-30 dark:text-red-400 dark:hover:bg-red-900/20">
              <Trash2 className="h-4 w-4" />
            </button>
            <button onClick={onCancel} aria-label="Schließen" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {availableOptions.map((shot) => (
            <button
              key={shot.id}
              onClick={() => onSelect({ ...shot, price: shotPriceForLocation(shot, location) })}
              className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-blue-500 hover:bg-blue-50 active:scale-95 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-blue-400 dark:hover:bg-blue-900/20"
            >
              <span className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{shot.name}</span>
              {/* Aktuelle Anzahl dieser Sorte an der gewählten Position */}
              <span className="w-10 text-center text-base font-extrabold text-gray-900 dark:text-white">{already.filter((name) => name === shot.name).length || ''}</span>
              <span className="flex-1 text-right text-sm font-bold text-blue-600 dark:text-blue-400">
                {shotPriceForLocation(shot, location) > 0 ? `+ ${formatCurrency(shotPriceForLocation(shot, location))}` : 'kein Aufpreis'}
              </span>
            </button>
          ))}
        </div>
        <button type="button" onClick={onCancel}
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-green-600 text-base font-bold text-white transition hover:bg-green-700 active:scale-95">
          Fertig
        </button>
      </div>
    </div>
  );
}
