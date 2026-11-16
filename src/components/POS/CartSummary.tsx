import type { CartItem, Location } from '@/types';
import { formatCurrency } from '@/lib/format';
import { checkoutTotals } from '@/lib/checkoutTransactions';
import { ShoppingCart, Recycle } from 'lucide-react';

interface Props {
  items: CartItem[];
  location: Location;
}

export function CartSummary({ items, location }: Props) {
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
        <div className="flex justify-between text-gray-600 dark:text-gray-400">
          <span>Pfand</span>
          <span className="font-medium">{formatCurrency(totalPfand)}</span>
        </div>
      )}
      {pfandRetoure !== 0 && (
        <div className="flex items-center justify-between text-teal-600 dark:text-teal-400">
          <span className="flex items-center gap-1.5">
            <Recycle className="h-3.5 w-3.5" />
            Pfand-Retoure
          </span>
          <span className={`font-medium ${pfandRetoure < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{formatCurrency(pfandRetoure)}</span>
        </div>
      )}
      <div className="flex items-baseline justify-between border-t-2 border-gray-300 pt-2 dark:border-gray-600">
        <span className="text-lg font-bold text-gray-900 dark:text-gray-100">Gesamt</span>
        <span className={`text-2xl font-bold ${total < 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>{formatCurrency(total)}</span>
      </div>
    </div>
  );
}
