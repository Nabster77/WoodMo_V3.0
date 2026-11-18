import type { CartItem, Location } from '@/types';
import { formatCurrency } from '@/lib/format';
import { taxRateForProduct } from '@/lib/tax';
import { Minus, Plus, Trash2, Recycle } from 'lucide-react';
import { SpiritBadge } from './ProductTile';
import { shotParts } from '@/lib/shotCombine';

interface Props {
  item: CartItem;
  location: Location;
  onInc: () => void;
  onDec: () => void;
  onRemove: () => void;
  onEditShot?: () => void;
}

/**
 * Two-row cart entry stays usable in a narrow right-hand tablet column.
 * All quantity, shot and deposit operations remain wired to the original handlers.
 */
export function CartItemRow({ item, location, onInc, onDec, onRemove, onEditShot }: Props) {
  const unitTotal = item.unitPrice + item.unitPfand;
  const shotPrice = item.shot && item.shot.id !== 'none' ? item.shot.price : 0;
  const basePrice = item.unitPrice - shotPrice;
  const rate = taxRateForProduct(item.product, location);

  return (
    <div className="flex min-w-0 items-start gap-1.5 border-b border-slate-200 py-2 dark:border-slate-700">
      {/* Kompakt: Angaben links, Menge in derselben Höhe, rechts Entfernen + Zeilensumme. */}
      <div className="min-w-0 flex-1">
        <p className={`break-words text-[clamp(0.875rem,5cqw,1.15rem)] font-bold leading-tight ${item.isPfandRetoure ? 'text-green-600 dark:text-green-400' : 'text-slate-900 dark:text-slate-100'}`}>
          {item.isPfandRetoure && <Recycle className="mr-1 inline h-3.5 w-3.5" />}
          {item.product.name}
          {!item.isPfandRetoure && item.product.spiritType && <span className="ml-1 inline-block align-middle"><SpiritBadge kind={item.product.spiritType} /></span>}
          {!item.isPfandRetoure && item.shot && item.shot.id !== 'none' && (
            <span className="text-blue-600 dark:text-blue-400"> + {item.shot.name}</span>
          )}
        </p>
        {item.isPfandRetoure ? (
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Pfand-Rückgabe · {formatCurrency(Math.abs(item.unitPrice))}/Stück
          </p>
        ) : (
          <div className="mt-0.5 text-[clamp(10px,3.6cqw,13px)] leading-snug text-slate-500 dark:text-slate-400">
            {shotPrice > 0 ? (
              <span>{item.product.name} {formatCurrency(basePrice)} + {shotParts(item.shot).length > 1 ? `${shotParts(item.shot).length} Schüsse` : 'SCHUSS'} {formatCurrency(shotPrice)} = {formatCurrency(item.unitPrice)}</span>
            ) : (
              <span>Stückpreis {formatCurrency(unitTotal)} · MwSt. {rate}%</span>
            )}
            {item.unitPfand > 0 && <span className="block font-medium text-green-600 dark:text-green-400">+ {formatCurrency(item.unitPfand)} Pfand</span>}
          </div>
        )}
      </div>
      {/* SCHUSS zwischen Artikel und Menge: spart eine Zeile pro Position. */}
      {onEditShot && !item.isPfandRetoure && (
        <button type="button" onClick={onEditShot} aria-label={item.shot ? `${item.product.name}: SCHUSS ändern` : `${item.product.name}: SCHUSS hinzufügen`}
          className="flex h-9 shrink-0 items-center rounded-lg bg-blue-600 px-2 text-[clamp(10px,3.4cqw,13px)] font-bold text-white hover:bg-blue-700 active:scale-[0.97]">
          {item.shot && item.shot.id !== 'none' ? 'SCHUSS ✎' : '+ SCHUSS'}
        </button>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        <button type="button" aria-label={`${item.product.name}: Menge verringern`} onClick={onDec}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-800 active:scale-95 dark:bg-slate-700 dark:text-slate-100">
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-6 text-center text-sm font-bold tabular-nums">{item.quantity}</span>
        <button type="button" aria-label={`${item.product.name}: Menge erhöhen`} onClick={onInc}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-800 active:scale-95 dark:bg-slate-700 dark:text-slate-100">
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button type="button" aria-label={`${item.product.name} aus Warenkorb entfernen`} onClick={onRemove}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30">
          <Trash2 className="h-4 w-4" />
        </button>
        <span className={`text-right text-sm font-bold tabular-nums ${unitTotal * item.quantity < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
          {formatCurrency(unitTotal * item.quantity)}
        </span>
      </div>
    </div>
  );
}
