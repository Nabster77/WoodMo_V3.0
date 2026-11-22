import { useState } from 'react';
import type { CartItem, Transaction, PaymentMethod, Location } from '@/types';
import { formatCurrency } from '@/lib/format';
import { buildCheckoutTransactions, checkoutTotals, isCardWithCashPfandPayout } from '@/lib/checkoutTransactions';
import { X, Check, Receipt, Banknote, CreditCard, Coins, Recycle } from 'lucide-react';

export type CheckoutSaveResult = 'queued-online' | 'queued-offline' | 'test';

interface Props {
  items: CartItem[];
  location: Location;
  onComplete: (transactions: Transaction[]) => Promise<CheckoutSaveResult>;
  /** Called once after the booking was saved. The parent closes the dialog
   * and empties the cart in the same step (no extra "saved" window).
   * `hint` repeats what the cashier must still hand out (change, Pfand). */
  onPaid: (result: CheckoutSaveResult, hint?: string) => void;
  onCancel: () => void;
  /** Current expected cash in the drawer; payouts may never make it negative. */
  cashAvailable?: number;
}

export function CheckoutModal({ items, location, onComplete, onPaid, onCancel, cashAvailable }: Props) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [givenAmount, setGivenAmount] = useState('');
  const [paid, setPaid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { total, goodsTotal, pfandRetoure, isPfandOnly, totalPfand, taxLines } = checkoutTotals(items, location);
  // Card + Pfand-Retoure: goods on card, Pfand-Retoure paid out in cash.
  const splitPayout = isCardWithCashPfandPayout(items, paymentMethod);
  const cashPayout = -pfandRetoure;
  // "Gegeben" is optional (operator request 15.11.2026): an empty field means
  // the customer paid exactly. Only a typed amount is checked for change/too little.
  const givenEntered = givenAmount.trim() !== '';
  const given = givenEntered ? (parseFloat(givenAmount.replace(',', '.')) || 0) : total;
  const change = given - total;
  const cashPayment = !isPfandOnly && paymentMethod === 'cash';
  // Shown briefly after booking (the old last-confirmation window repeated it).
  const paidHint = splitPayout
    ? `Pfand bar auszahlen: ${formatCurrency(cashPayout)}`
    : isPfandOnly
      ? `Pfand auszahlen: ${formatCurrency(Math.abs(total))}`
      : cashPayment && givenEntered && change > 0.004
        ? `Rückgeld: ${formatCurrency(change)}`
        : undefined;
  // Cash leaving the drawer with this receipt (Pfand payout or negative cash total).
  const cashOut = splitPayout ? cashPayout : (isPfandOnly || paymentMethod === 'cash') && total < 0 ? -total : 0;
  const cashShort = cashAvailable !== undefined && cashOut > 0.004 && cashAvailable - cashOut < -0.004;
  const canPay = !saving && !paid && !cashShort && (isPfandOnly || (!!paymentMethod && !(paymentMethod === 'cash' && given < total)));

    async function handleConfirm() {
    if (saving || paid) return;
    setSaving(true);
    setSaveError(null);
    try {
    const transactions = buildCheckoutTransactions({ items, location, paymentMethod, given });
        const result = await onComplete(transactions);
    // `paid` stays true: a second tap can never book the same cart twice,
    // even if the parent needs another render to close this dialog.
    setPaid(true);
    onPaid(result, paidHint);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Die Buchung konnte nicht gesichert werden.');
    } finally {
      setSaving(false);
    }
  }

  // No "Buchung gesichert" window and no extra last-confirmation question
  // (operator requests 15./16.11.2026): change and the cash Pfand payout are
  // shown in this dialog; one tap on the green button books the sale.
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/50 p-4 sm:items-center" onClick={onCancel}>
      <div className="my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-3xl bg-white shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Bezahlung</h2>
          </div>
          <button onClick={onCancel} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 p-5">
          <div className="max-h-40 overflow-y-auto space-y-1">
            {items.map((item) => (
              <div key={`${item.product.id}-${item.shot?.id ?? 'none'}-${item.isPfandRetoure ? 'pf' : 'reg'}`} className="flex items-center justify-between text-sm">
                <span className={item.isPfandRetoure ? 'flex items-center gap-1.5 text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'}>
                  {item.isPfandRetoure && <Recycle className="h-3.5 w-3.5" />}
                  {item.quantity}× {item.shot && item.shot.id !== 'none' ? `${item.product.name} + ${item.shot.name}` : item.product.name}
                </span>
                <span className={`font-medium ${(item.unitPrice + item.unitPfand) * item.quantity < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                  {formatCurrency((item.unitPrice + item.unitPfand) * item.quantity)}
                </span>
              </div>
            ))}
          </div>
          <div className="space-y-1 border-t border-gray-200 pt-3 text-sm dark:border-gray-700">
            {taxLines.map(({ rate, tax }) => (
              <div key={rate} className="flex justify-between text-gray-500 dark:text-gray-400">
                <span>MwSt {rate}%</span><span>{formatCurrency(tax)}</span>
              </div>
            ))}
            {totalPfand > 0 && (
              <div className="flex justify-between text-gray-500 dark:text-gray-400">
                <span>Pfand</span><span>{formatCurrency(totalPfand)}</span>
              </div>
            )}
          </div>
          <div className="flex items-baseline justify-between border-t-2 border-gray-300 pt-3 dark:border-gray-600">
            <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{splitPayout ? 'Per Karte' : 'Zu zahlen'}</span>
            <span className={`text-3xl font-bold ${(splitPayout ? goodsTotal : total) < 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>{formatCurrency(splitPayout ? goodsTotal : total)}</span>
          </div>
          {splitPayout && (
            <div role="status" className="rounded-xl border border-green-500/60 bg-green-50 p-3 text-sm dark:bg-green-900/20">
              <div className="flex items-baseline justify-between font-bold text-green-700 dark:text-green-300">
                <span className="flex items-center gap-1.5"><Recycle className="h-4 w-4" /> Pfand bar auszahlen</span>
                <span className="text-xl">{formatCurrency(cashPayout)}</span>
              </div>
              <p className="mt-1 text-xs text-green-800 dark:text-green-200">
                Ware wird per Karte gebucht. Die Pfand-Retoure wird bar aus der Kasse ausgezahlt und mindert den Kassenbestand (eigener Beleg „Pfandausgabe“).
              </p>
            </div>
          )}

          {!isPfandOnly && (<>
          {/* Payment method selection */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <button
              onClick={() => setPaymentMethod('cash')}
              className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition active:scale-95 ${
                paymentMethod === 'cash'
                  ? 'bg-green-600 text-white shadow-md'
                  : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
              }`}
            >
              <Banknote className="h-5 w-5" /> BAR
            </button>
            <button
              onClick={() => setPaymentMethod('card')}
              className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition active:scale-95 ${
                paymentMethod === 'card'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
              }`}
            >
              <CreditCard className="h-5 w-5" /> KARTE
            </button>
          </div>

          {/* Cash given + change */}
          {paymentMethod === 'cash' && (
            <div className="space-y-2 rounded-xl bg-gray-50 p-3 dark:bg-gray-900/40">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Gegeben (€) <span className="font-normal text-gray-500 dark:text-gray-400">– optional, leer = passend</span></label>
                <input
                  value={givenAmount}
                  onChange={(e) => setGivenAmount(e.target.value)}
                  placeholder={formatCurrency(total)}
                  inputMode="decimal"
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-base text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
              </div>
              {givenEntered && given > 0 && (
                <div className={`flex flex-col items-center justify-center gap-1 pt-1 text-center ${change < 0 ? 'text-red-600 dark:text-red-400' : change === 0 ? 'text-gray-600 dark:text-gray-400' : 'text-green-600 dark:text-green-400'}`}>
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <Coins className="h-4 w-4" />
                    <span>{change < 0 ? 'Noch offen' : change === 0 ? 'Passend' : 'Rückgeld'}</span>
                  </div>
                  {change !== 0 && (
                    <span className="text-2xl font-bold leading-tight">{formatCurrency(Math.abs(change))}</span>
                  )}
                </div>
              )}
            </div>
          )}

          </>)}
                    {cashShort && <p role="alert" className="rounded-xl border border-red-500 p-2 text-sm text-red-600 dark:text-red-300">Nicht genug Bargeld in der Kasse: Bestand {formatCurrency(cashAvailable ?? 0)}, Auszahlung {formatCurrency(cashOut)}. Bitte zuerst eine Einlage buchen.</p>}
                    {saveError && <p role="alert" className="rounded-xl border border-red-500 p-2 text-sm text-red-600 dark:text-red-300">Buchung nicht gespeichert: {saveError}</p>}
          <button
            onClick={() => void handleConfirm()}
            disabled={!canPay}
            className={`sticky bottom-0 w-full rounded-xl py-4 text-lg font-bold text-white shadow-lg transition active:scale-95 disabled:opacity-50 ${isPfandOnly ? 'bg-green-400 !text-slate-950 hover:bg-green-300' : paymentMethod === 'card' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'}`}
          >
            <Check className="mr-1.5 inline h-5 w-5" />
            {saving ? 'Wird gebucht …' : isPfandOnly ? 'Pfandausgabe abschließen & buchen' : 'Bezahlen abschließen & buchen'}
          </button>
        </div>
      </div>
    </div>
  );
}
