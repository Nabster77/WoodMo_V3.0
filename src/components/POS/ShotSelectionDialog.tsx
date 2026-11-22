import { useState } from 'react';
import type { Product, ShotOption, Location } from '@/types';
import { shotPriceForLocation } from '@/lib/shotCatalog';
import { REMOVE_ALL_SHOTS_ID, shotCount, shotParts } from '@/lib/shotCombine';

import { X, Wine, MapPin, Minus, Plus } from 'lucide-react';
import { formatCurrency } from '@/lib/format';

interface Props {
  product: Product;
  options: ShotOption[];
  location: Location;
  /** Schüsse, die schon in diesem Getränk sind. */
  current?: ShotOption | null;
  /** Menge der Zeile: bei mehreren Getränken gilt die Auswahl für genau 1 Getränk. */
  quantity?: number;
  /** Fügt `count` Schüsse hinzu (1 = „1× SCHUSS“, n = „XXL-SCHUSS“). */
  onAdd: (shot: ShotOption, count: number) => void;
  onCancel: () => void;
}

const MAX_SHOTS = 20;

function ShotRow({ shot, location, inDrink, onAdd }: { shot: ShotOption; location: Location; inDrink: number; onAdd: (shot: ShotOption, count: number) => void }) {
  const [qty, setQty] = useState(0);
  const price = shotPriceForLocation(shot, location);
  const priced = { ...shot, price };
  const setClamped = (value: number) => setQty(Math.max(0, Math.min(MAX_SHOTS, Math.floor(value) || 0)));

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-[8rem] flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {shot.name}
            {inDrink > 0 && <span className="ml-2 rounded-full bg-green-600 px-2 py-0.5 text-xs font-bold text-white">{inDrink}× drin</span>}
          </p>
          <p className="text-xs font-bold text-blue-600 dark:text-blue-400">{price > 0 ? `+ ${formatCurrency(price)}` : 'kein Aufpreis'} je Schuss</p>
        </div>
        <button type="button" onClick={() => onAdd(priced, 1)} aria-label={`${shot.name}: 1× SCHUSS hinzufügen`}
          className="h-11 rounded-lg bg-green-600 px-3 text-sm font-bold text-white hover:bg-green-700 active:scale-95">
          1× SCHUSS
        </button>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={`${shot.name}: Menge verringern`} disabled={qty <= 0} onClick={() => setClamped(qty - 1)}
            className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-800 active:scale-95 disabled:opacity-40 dark:bg-slate-700 dark:text-slate-100">
            <Minus className="h-4 w-4" />
          </button>
          <input type="text" inputMode="numeric" aria-label={`${shot.name}: Anzahl Schüsse`} value={qty}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setClamped(Number(e.target.value.replace(/\D/g, '')))}
            className="h-11 w-12 rounded-lg border border-gray-300 bg-white text-center text-base font-bold text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
          <button type="button" aria-label={`${shot.name}: Menge erhöhen`} disabled={qty >= MAX_SHOTS} onClick={() => setClamped(qty + 1)}
            className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-800 active:scale-95 disabled:opacity-40 dark:bg-slate-700 dark:text-slate-100">
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" disabled={qty < 1} onClick={() => { onAdd(priced, qty); setQty(0); }}
            className="h-11 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">
            XXL-SCHUSS
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShotSelectionDialog({ product, options, location, current, quantity = 1, onAdd, onCancel }: Props) {
  const already = shotParts(current);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/50 p-4 sm:items-center" onClick={onCancel}>
      <div className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-gray-100">
            <Wine className="h-5 w-5 text-blue-600 dark:text-blue-400" /> Schuss-Auswahl
          </h3>
          <button onClick={onCancel} aria-label="Schließen" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-1 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
          <MapPin className="h-4 w-4" /> {location}
        </p>
        <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
          Extraschuss möglich
          {quantity > 1 ? ` · gilt für 1 von ${quantity}× ${product.name}` : ''}
        </p>
        <div className="space-y-2">
          {options.map((shot) => (
            <ShotRow key={shot.id} shot={shot} location={location} inDrink={shotCount(current, shot.name)} onAdd={onAdd} />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          {already.length > 0 ? (
            <button type="button" onClick={() => onAdd({ id: REMOVE_ALL_SHOTS_ID, name: 'Alle Schüsse entfernen', price: 0 }, 1)}
              className="h-11 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 active:scale-95 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20">
              Alle Schüsse entfernen
            </button>
          ) : <span />}
          <button type="button" onClick={onCancel} className="h-11 rounded-lg bg-slate-900 px-5 text-sm font-bold text-white active:scale-95 dark:bg-white dark:text-slate-900">
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}
