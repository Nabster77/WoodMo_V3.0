import type { CartItem, Location } from '@/types';
import { formatCurrency } from '@/lib/format';
import { checkoutTotals } from '@/lib/checkoutTransactions';
import { useState } from 'react';
import { ShoppingCart, Recycle, ChevronDown, ChevronUp } from 'lucide-react';
import { loadJSON, saveJSON } from '@/lib/storage';

/** Netto/MwSt/Pfand-Details aufgeklappt oder nicht – pro Gerät gemerkt. */
const DETAILS_KEY = 'pos_cart_details_open';

interface Props {
  items: CartItem[];
  location: Location;
}

export function CartSummary({ items, location }: Props) {
  const [detailsOpen, setDetailsOpen] = useState<boolean>(() => loadJSON<boolean>(DETAILS_KEY, false) === true);
  const toggleDetails = () => setDetailsOpen((value) => { const next = !value; saveJSON(DETAILS_KEY, next); return next; });
  // Gleiche Rechnung wie beim Buchen: USt auf Ware UND Pfand (ab 17.11.2026).
  const totals = checkoutTotals(items, location);
  const { totalPfand, pfandRetoure, total } = totals;
  const totalNet = totals.totalNet + totals.pfandNet;
  const totalTax = totals.totalTax + totals.pfandTax;
  const rateEntries = totals.taxLines;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-gray-400 dark:text-gray-500">
        <ShoppingCart className="h-16 w-16" />
        <p className="text-sm font-medium">Warenkorb ist leer</p>
        <p className="text-xs">Tippe auf Artikel, um sie hinzuzufügen</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 text-sm">
      <button type="button" onClick={toggleDetails} aria-expanded={detailsOpen}
        className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50">
        <span>Details (Netto, MwSt, Pfand)</span>
        {detailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {detailsOpen && <>
      <div className="flex justify-between text-gray-600 dark:text-gray-400">
        <span>Zwischensumme (netto)</span>
        <span className="font-medium">{formatCurrency(totalNet)}</span>
      </div>
      {rateEntries.map(({ rate, tax }) => (
        <div key={rate} className="flex justify-between text-gray-600 dark:text-gray-400">
          <span>MwSt {rate}%</span>
          <span className="font-medium">{formatCurrency(tax)}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-gray-200 pt-1.5 text-gray-600 dark:border-gray-700 dark:text-gray-400">
        <span>MwSt gesamt</span>
        <span className="font-medium">{formatCurrency(totalTax)}</span>
      </div>
      {totalPfand > 0 && (
        <div className="flex justify-between text-green-600 dark:text-green-400">
          <span>Pfand</span>
          <span className="font-medium">{formatCurrency(totalPfand)}</span>
        </div>
      )}
      {pfandRetoure !== 0 && (
        <div className="flex items-center justify-between text-green-600 dark:text-green-400">
          <span className="flex items-center gap-1.5">
            <Recycle className="h-3.5 w-3.5" />
            Pfand-Retoure
          </span>
          <span className={`font-medium ${pfandRetoure < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{formatCurrency(pfandRetoure)}</span>
        </div>
      )}
      </>}
      <div className="flex items-baseline justify-between border-t-2 border-gray-300 pt-2 dark:border-gray-600">
        <span className="text-lg font-bold text-gray-900 dark:text-gray-100">Gesamt</span>
        <span className={`text-2xl font-bold ${total < 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>{formatCurrency(total)}</span>
      </div>
    </div>
  );
}
