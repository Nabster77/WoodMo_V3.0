import type { Product, ShotOption, Location } from '@/types';
import { shotPriceForLocation } from '@/lib/shotCatalog';
import { NO_SHOT_ID, REMOVE_ALL_SHOTS_ID, shotParts } from '@/lib/shotCombine';

import { X, Wine } from 'lucide-react';
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

export function ShotSelectionDialog({ product, options, location, current, onSelect, onCancel }: Props) {
  const already = shotParts(current);
  // „Ohne Schuss“ / „Kein weiterer Schuss“: nichts hinzufügen, nichts berechnen.
  const availableOptions: ShotOption[] = [{ id: NO_SHOT_ID, name: already.length ? 'Kein weiterer Schuss' : 'Ohne Schuss', price: 0 }, ...options];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/50 p-4 sm:items-center" onClick={onCancel}>
      <div className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-gray-100">
            <Wine className="h-5 w-5 text-blue-600 dark:text-blue-400" /> Schuss-Auswahl
          </h3>
          <button onClick={onCancel} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">{product.name} — SCHUSS für {location} auswählen?</p>
        {already.length > 0 ? (
          <p className="mb-4 rounded-xl bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900 dark:bg-blue-900/30 dark:text-blue-100">
            Schon drin: {product.name} + {already.join(' + ')} ({formatCurrency(current?.price ?? 0)}). Eine weitere Auswahl kommt dazu.
          </p>
        ) : (
          <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">Mehrere Schüsse möglich: danach einfach noch einmal auf SCHUSS tippen.</p>
        )}
        <div className="space-y-2">
          {availableOptions.map((shot) => (
            <button
              key={shot.id}
              onClick={() => onSelect({ ...shot, price: shotPriceForLocation(shot, location) })}
              className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-blue-500 hover:bg-blue-50 active:scale-95 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-blue-400 dark:hover:bg-blue-900/20"
            >
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{shot.name}</span>
              <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                {shotPriceForLocation(shot, location) > 0 ? `+ ${formatCurrency(shotPriceForLocation(shot, location))}` : 'kein Aufpreis'}
              </span>
            </button>
          ))}
          {already.length > 0 && (
            <button
              onClick={() => onSelect({ id: REMOVE_ALL_SHOTS_ID, name: 'Alle Schüsse entfernen', price: 0 })}
              className="flex w-full items-center justify-between rounded-xl border border-red-300 bg-white px-4 py-3 text-left transition hover:bg-red-50 active:scale-95 dark:border-red-800 dark:bg-gray-900 dark:hover:bg-red-900/20"
            >
              <span className="text-sm font-semibold text-red-700 dark:text-red-300">Alle Schüsse entfernen</span>
              <span className="text-sm font-bold text-red-700 dark:text-red-300">− {formatCurrency(current?.price ?? 0)}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
