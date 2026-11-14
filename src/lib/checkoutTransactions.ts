import type { CartItem, Location, PaymentMethod, Transaction, TransactionItem } from '@/types';
import { calcNet, calcTax } from '@/lib/format';
import { taxRateForProduct } from '@/lib/tax';

/**
 * WOODMO V3 – Bon in Buchungen umwandeln.
 *
 * Regel (Betreiber-Vorgabe 14.11.2026):
 * - Bar: Ware und Pfand-Retoure werden verrechnet, eine Barbuchung (wie bisher).
 * - Karte OHNE Pfand-Retoure: eine Kartenbuchung (wie bisher).
 * - Karte MIT Pfand-Retoure: aufgeteilt in
 *     1) Kartenbuchung: nur Ware inkl. Pfand der Ware (läuft übers Konto),
 *     2) Barbuchung „Pfandausgabe“: nur die Pfand-Retoure, wird bar aus der
 *        Kasse ausgezahlt und mindert den Kassenbestand.
 *   Beide Buchungen tragen dieselbe paymentSplitId, damit sie im Journal als
 *   ein Kundenvorgang erkennbar sind.
 * - Nur Pfand-Retoure: eine Barbuchung „Pfandausgabe“ (wie bisher).
 */
export interface CheckoutTotals {
  subtotal: number;      // Warenwert brutto ohne Pfand
  totalPfand: number;    // Pfand der verkauften Ware (>= 0)
  pfandRetoure: number;  // Pfand-Retoure (<= 0)
  total: number;         // Saldo des gesamten Bons
  totalTax: number;
  totalNet: number;
  goodsTotal: number;    // subtotal + totalPfand (was die Karte belastet)
  isPfandOnly: boolean;
  hasRetoure: boolean;
  /** MwSt je Satz, aufsteigend sortiert, fuer die Anzeige. */
  taxLines: Array<{ rate: number; tax: number }>;
}

export function checkoutTotals(items: readonly CartItem[], location: Location): CheckoutTotals {
  const grossByRate = new Map<number, number>();
  let totalPfand = 0;
  let pfandRetoure = 0;
  for (const item of items) {
    if (item.isPfandRetoure) {
      pfandRetoure += item.unitPrice * item.quantity;
      continue;
    }
    const rate = taxRateForProduct(item.product, location);
    const gross = item.unitPrice * item.quantity;
    grossByRate.set(rate, (grossByRate.get(rate) ?? 0) + gross);
    totalPfand += item.unitPfand * item.quantity;
  }
  const subtotal = [...grossByRate.values()].reduce((s, v) => s + v, 0);
  const totalTax = [...grossByRate.entries()].reduce((s, [r, g]) => s + calcTax(g, r), 0);
  const totalNet = [...grossByRate.entries()].reduce((s, [r, g]) => s + calcNet(g, r), 0);
  return {
    subtotal, totalPfand, pfandRetoure, totalTax, totalNet,
    total: subtotal + totalPfand + pfandRetoure,
    goodsTotal: subtotal + totalPfand,
    isPfandOnly: items.length > 0 && items.every((item) => item.isPfandRetoure),
    hasRetoure: items.some((item) => item.isPfandRetoure),
    taxLines: [...grossByRate.entries()].sort((a, b) => a[0] - b[0])
      .map(([rate, gross]) => ({ rate, tax: calcTax(gross, rate) })),
  };
}

/** True when a card payment must pay out the Pfand-Retoure in cash. */
export function isCardWithCashPfandPayout(items: readonly CartItem[], paymentMethod: PaymentMethod | null): boolean {
  return paymentMethod === 'card' &&
    items.some((item) => item.isPfandRetoure) &&
    items.some((item) => !item.isPfandRetoure);
}

function retoureItem(item: CartItem): TransactionItem {
  return {
    productId: item.product.id,
    name: item.product.name,
    price: item.unitPrice,
    quantity: item.quantity,
    taxRate: 0,
    netPrice: item.unitPrice,
    taxAmount: 0,
    categoryId: item.product.categoryId,
    pfand: item.unitPrice * item.quantity,
    isPfandRetoure: true,
  };
}

function goodsItem(item: CartItem, location: Location, taxByRate: Record<number, number>): TransactionItem {
  const rate = taxRateForProduct(item.product, location);
  const gross = item.unitPrice * item.quantity;
  const net = calcNet(gross, rate);
  const tax = calcTax(gross, rate);
  taxByRate[rate] = (taxByRate[rate] ?? 0) + tax;
  return {
    productId: item.product.id,
    name: item.shot && item.shot.id !== 'none' ? `${item.product.name} + ${item.shot.name}` : item.product.name,
    price: item.unitPrice,
    quantity: item.quantity,
    taxRate: rate,
    netPrice: net,
    taxAmount: tax,
    categoryId: item.product.categoryId,
    pfand: item.unitPfand * item.quantity,
    shotName: item.shot && item.shot.id !== 'none' ? item.shot.name : undefined,
  };
}

function newId(): string {
  return `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface BuildOptions {
  items: readonly CartItem[];
  location: Location;
  paymentMethod: PaymentMethod | null;
  /** Cash handed over (only for cash payment). */
  given?: number;
  now?: number;
  makeId?: () => string;
}

/** Builds the 1 or 2 immutable receipts for one checkout. */
export function buildCheckoutTransactions(options: BuildOptions): Transaction[] {
  const { items, location, paymentMethod } = options;
  const now = options.now ?? Date.now();
  const makeId = options.makeId ?? newId;
  const totals = checkoutTotals(items, location);
  if (items.length === 0) throw new Error('Leerer Bon kann nicht gebucht werden.');

  const goodsLines = items.filter((item) => !item.isPfandRetoure);
  const retoureLines = items.filter((item) => item.isPfandRetoure);

  if (isCardWithCashPfandPayout(items, paymentMethod)) {
    const splitId = 'split-' + makeId();
    const taxByRate: Record<number, number> = {};
    const cardItems = goodsLines.map((item) => goodsItem(item, location, taxByRate));
    const card: Transaction & { paymentSplitId: string; paymentSplitRole: 'card-goods' } = {
      id: makeId(),
      timestamp: now,
      items: cardItems,
      subtotal: totals.subtotal,
      taxByRate,
      totalNet: totals.totalNet,
      totalTax: totals.totalTax,
      totalPfand: totals.totalPfand,
      total: totals.goodsTotal,
      paymentMethod: 'card',
      location,
      paymentSplitId: splitId,
      paymentSplitRole: 'card-goods',
    };
    // One cash payout receipt per retoure line (the POS keeps at most one).
    const payouts = retoureLines.map((item, index) => {
      const line = retoureItem(item);
      const amount = line.price * line.quantity;
      const payout: Transaction & { paymentSplitId: string; paymentSplitRole: 'cash-pfand-payout' } = {
        id: makeId(),
        timestamp: now + 1 + index, // strictly after the card receipt
        items: [line],
        subtotal: 0,
        taxByRate: {},
        totalNet: 0,
        totalTax: 0,
        totalPfand: amount,
        total: amount,
        paymentMethod: 'cash',
        location,
        paymentSplitId: splitId,
        paymentSplitRole: 'cash-pfand-payout',
      };
      return payout;
    });
    return [card, ...payouts];
  }

  const taxByRate: Record<number, number> = {};
  const txItems = items.map((item) => item.isPfandRetoure ? retoureItem(item) : goodsItem(item, location, taxByRate));
  const cashPayment = !totals.isPfandOnly && paymentMethod === 'cash';
  const given = options.given ?? 0;
  return [{
    id: makeId(),
    timestamp: now,
    items: txItems,
    subtotal: totals.subtotal,
    taxByRate,
    totalNet: totals.totalNet,
    totalTax: totals.totalTax,
    totalPfand: totals.totalPfand + totals.pfandRetoure,
    total: totals.total,
    paymentMethod: totals.isPfandOnly ? 'cash' : (paymentMethod ?? 'cash'),
    amountPaid: cashPayment ? given : undefined,
    change: cashPayment ? given - totals.total : undefined,
    location,
  }];
}
