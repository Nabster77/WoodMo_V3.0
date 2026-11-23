import { useEffect, useState } from 'react';
import type { CartItem, Location } from '@/types';
import { formatCurrency } from '@/lib/format';
import { Minus, Plus, Trash2, Recycle } from 'lucide-react';
import { SpiritBadge } from './ProductTile';
import { spiritColor } from '@/lib/spiritColors';
import { shotSummary } from '@/lib/shotCombine';

interface Props {
  item: CartItem;
  location: Location;
  onInc: () => void;
  onDec: () => void;
  onRemove: () => void;
  /** Menge direkt eintippen (≥ 1). */
  onSetQuantity?: (quantity: number) => void;
  onEditShot?: () => void;
}

/**
 * Kompakte Warenkorbzeile (Vorgabe 22.11.): Name, darunter nur kurze farbige Hinweise
 * („+ Pfand“, „+ 3× Schuss Rum“, Schnaps/Likör, individueller Preis); SCHUSS mittig;
 * Menge (− Zahl +), Löschen und Betrag rechts. Nichts bricht um: Texte werden gekürzt,
 * Größen richten sich nach der Warenkorbbreite (cqw). Nur Anzeige – Preise unverändert.
 */
export function CartItemRow({ item, onInc, onDec, onRemove, onSetQuantity, onEditShot }: Props) {
  const unitTotal = item.unitPrice + item.unitPfand;
  const shots = item.isPfandRetoure ? null : shotSummary(item.shot, item.quantity);
  const nameColor = !item.isPfandRetoure ? spiritColor(item.product.spiritType) : undefined;
  const [qtyText, setQtyText] = useState(String(item.quantity));
  useEffect(() => setQtyText(String(item.quantity)), [item.quantity]);
  const commitQty = () => {
    const next = Number.parseInt(qtyText, 10);
    if (onSetQuantity && Number.isInteger(next) && next >= 1 && next <= 999 && next !== item.quantity) onSetQuantity(next);
    else setQtyText(String(item.quantity));
  };

  return (
    <div className="flex min-w-0 items-center gap-[clamp(4px,1.6cqw,12px)] whitespace-nowrap border-b border-slate-200 py-2 dark:border-slate-700">
      <div className="min-w-0 flex-[2_1_0%]">
        <p style={nameColor ? { color: nameColor } : undefined}
          className={`truncate text-[clamp(0.85rem,4.6cqw,1.2rem)] font-bold leading-tight ${item.isPfandRetoure ? 'text-green-600 dark:text-green-400' : 'text-slate-900 dark:text-slate-100'}`}>
          {item.isPfandRetoure && <Recycle className="mr-1 inline h-3.5 w-3.5" />}
          {item.product.name}
        </p>
        <div className="mt-0.5 flex min-w-0 items-center gap-[clamp(4px,1.4cqw,10px)] overflow-hidden text-[clamp(10px,3.3cqw,14px)] font-semibold leading-snug">
          {item.isPfandRetoure ? (
            <span className="truncate text-slate-500 dark:text-slate-400">Pfand-Rückgabe · {formatCurrency(Math.abs(item.unitPrice))}/Stück</span>
          ) : (
            <>
              {item.product.spiritType && <SpiritBadge kind={item.product.spiritType} className="shrink-0 rounded px-1 py-px text-[clamp(9px,2.8cqw,11px)] font-extrabold tracking-wide" />}
              {item.product.hasIndividualPrice && <span className="shrink-0 text-amber-500 dark:text-amber-400">+ Preis individuell</span>}
              {item.unitPfand > 0 && <span className="shrink-0 text-green-600 dark:text-green-400">+ Pfand</span>}
              {shots && (
                <span className="min-w-0 truncate text-blue-600 dark:text-blue-400" title={`${shots.total}× Schuss ${shots.label}`}>
                  + {shots.total}× Schuss {shots.label}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      {/* SCHUSS mittig in der Zeile, passt sich der Breite an. */}
      <div className="flex min-w-0 flex-1 justify-center">
        {onEditShot && !item.isPfandRetoure && (
          <button type="button" onClick={onEditShot} aria-label={item.shot ? `${item.product.name}: SCHUSS ändern` : `${item.product.name}: SCHUSS hinzufügen`}
            className="flex h-[clamp(2rem,9cqw,2.75rem)] items-center rounded-lg bg-blue-600 px-[clamp(6px,2.2cqw,16px)] text-[clamp(10px,3.4cqw,14px)] font-bold text-white hover:bg-blue-700 active:scale-[0.97]">
            {item.shot && item.shot.id !== 'none' ? 'SCHUSS ✎' : '+ SCHUSS'}
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button type="button" aria-label={`${item.product.name}: Menge verringern`} onClick={onDec}
          className="flex h-[clamp(2rem,9cqw,2.75rem)] w-[clamp(2rem,9cqw,2.75rem)] items-center justify-center rounded-lg bg-slate-100 text-slate-800 active:scale-95 dark:bg-slate-700 dark:text-slate-100">
          <Minus className="h-4 w-4" />
        </button>
        {onSetQuantity ? (
          <input type="text" inputMode="numeric" aria-label={`${item.product.name}: Menge`} value={qtyText}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setQtyText(e.target.value.replace(/\D/g, '').slice(0, 3))}
            onBlur={commitQty}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="w-[clamp(1.75rem,7cqw,2.5rem)] rounded-md bg-transparent text-center text-[clamp(0.85rem,4cqw,1.1rem)] font-bold tabular-nums text-slate-900 focus:bg-white focus:outline focus:outline-2 focus:outline-blue-500 dark:text-slate-100 dark:focus:bg-slate-900" />
        ) : (
          <span className="w-6 text-center text-sm font-bold tabular-nums">{item.quantity}</span>
        )}
        <button type="button" aria-label={`${item.product.name}: Menge erhöhen`} onClick={onInc}
          className="flex h-[clamp(2rem,9cqw,2.75rem)] w-[clamp(2rem,9cqw,2.75rem)] items-center justify-center rounded-lg bg-slate-100 text-slate-800 active:scale-95 dark:bg-slate-700 dark:text-slate-100">
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button type="button" aria-label={`${item.product.name} aus Warenkorb entfernen`} onClick={onRemove}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30">
          <Trash2 className="h-4 w-4" />
        </button>
        <span className={`text-right text-[clamp(0.8rem,3.8cqw,1.05rem)] font-bold tabular-nums ${unitTotal * item.quantity < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
          {formatCurrency(unitTotal * item.quantity)}
        </span>
      </div>
    </div>
  );
}
