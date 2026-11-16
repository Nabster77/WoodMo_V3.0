import type { CartItem, Location, PaymentMethod, Transaction, TransactionItem } from '@/types';
import { calcNet, calcTax } from '@/lib/format';
import { pfandReturnTaxRate, taxRateForProduct } from '@/lib/tax';

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
 *
 * Pfand-Umsatzsteuer (ab 17.11.2026): Das Pfand teilt den Steuersatz des
 * Getraenks; eine Pfand-Retoure ist eine Entgeltminderung mit dem Normalsatz
 * des Standorts (pfandReturnTaxRate). Gespeichert in eigenen Feldern
 * (pfandTaxByRate/pfandNet am Bon, pfandTaxRate/pfandNet/pfandTax je Zeile);
 * taxByRate/totalNet/totalTax bleiben die Werte der Ware wie bisher.
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
  /** Umsatzsteuer auf Pfand-Saldo je Satz (Verkauf +, Retoure −). */
  pfandTaxByRate: Record<number, number>;
  pfandNet: number;
  pfandTax: number;
  /** MwSt je Satz inkl. Pfand, aufsteigend sortiert, fuer die Anzeige. */
  taxLines: Array<{ rate: number; tax: number }>;
}

function addRate(map: Record<number, number>, rate: number, value: number): void {
  if (value) map[rate] = (map[rate] ?? 0) + value;
}

export function checkoutTotals(items: readonly CartItem[], location: Location): CheckoutTotals {
  const grossByRate = new Map<number, number>();
  const pfandTaxByRate: Record<number, number> = {};
  let totalPfand = 0;
  let pfandRetoure = 0;
  let pfandNet = 0;
  for (const item of items) {
    if (item.isPfandRetoure) {
      const amount = item.unitPrice * item.quantity;
      const rate = pfandReturnTaxRate(location);
      pfandRetoure += amount;
      pfandNet += calcNet(amount, rate);
      addRate(pfandTaxByRate, rate, calcTax(amount, rate));
      continue;
    }
    const rate = taxRateForProduct(item.product, location);
    const gross = item.unitPrice * item.quantity;
    const pfand = item.unitPfand * item.quantity;
    grossByRate.set(rate, (grossByRate.get(rate) ?? 0) + gross);
    totalPfand += pfand;
    pfandNet += calcNet(pfand, rate);
    addRate(pfandTaxByRate, rate, calcTax(pfand, rate));
  }
  const pfandTax = Object.values(pfandTaxByRate).reduce((sum, value) => sum + value, 0);
  const displayTax = new Map<number, number>();
  for (const [rate, gross] of grossByRate) displayTax.set(rate, calcTax(gross, rate));
  for (const [rate, tax] of Object.entries(pfandTaxByRate)) {
    displayTax.set(Number(rate), (displayTax.get(Number(rate)) ?? 0) + tax);
  }
  const subtotal = [...grossByRate.values()].reduce((s, v) => s + v, 0);
  const totalTax = [...grossByRate.entries()].reduce((s, [r, g]) => s + calcTax(g, r), 0);
  const totalNet = [...grossByRate.entries()].reduce((s, [r, g]) => s + calcNet(g, r), 0);
  return {
    subtotal, totalPfand, pfandRetoure, totalTax, totalNet, pfandTaxByRate, pfandNet, pfandTax,
    total: subtotal + totalPfand + pfandRetoure,
    goodsTotal: subtotal + totalPfand,
    isPfandOnly: items.length > 0 && items.every((item) => item.isPfandRetoure),
    hasRetoure: items.some((item) => item.isPfandRetoure),
    taxLines: [...displayTax.entries()].sort((a, b) => a[0] - b[0])
      .map(([rate, tax]) => ({ rate, tax })),
  };
}

/** True when a card payment must pay out the Pfand-Retoure in cash. */
export function isCardWithCashPfandPayout(items: readonly CartItem[], paymentMethod: PaymentMethod | null): boolean {
  return paymentMethod === 'card' &&
    items.some((item) => item.isPfandRetoure) &&
    items.some((item) => !item.isPfandRetoure);
}

function retoureItem(item: CartItem, location: Location, pfandTaxByRate: Record<number, number>): TransactionItem {
  const amount = item.unitPrice * item.quantity;
  const rate = pfandReturnTaxRate(location);
  const pfandTax = calcTax(amount, rate);
  addRate(pfandTaxByRate, rate, pfandTax);
  return {
    productId: item.product.id,
    name: item.product.name,
    price: item.unitPrice,
    quantity: item.quantity,
    taxRate: 0,
    netPrice: item.unitPrice,
    taxAmount: 0,
    categoryId: item.product.categoryId,
    pfand: amount,
    isPfandRetoure: true,
    pfandTaxRate: rate,
    pfandNet: calcNet(amount, rate),
    pfandTax,
  };
}

function goodsItem(item: CartItem, location: Location, taxByRate: Record<number, number>, pfandTaxByRate: Record<number, number>): TransactionItem {
  const rate = taxRateForProduct(item.product, location);
  const gross = item.unitPrice * item.quantity;
  const net = calcNet(gross, rate);
  const tax = calcTax(gross, rate);
  taxByRate[rate] = (taxByRate[rate] ?? 0) + tax;
  const pfand = item.unitPfand * item.quantity;
  const pfandTax = calcTax(pfand, rate);
  addRate(pfandTaxByRate, rate, pfandTax);
  return {
    productId: item.product.id,
    name: item.shot && item.shot.id !== 'none' ? `${item.product.name} + ${item.shot.name}` : item.product.name,
    price: item.unitPrice,
    quantity: item.quantity,
    taxRate: rate,
    netPrice: net,
    taxAmount: tax,
    categoryId: item.product.categoryId,
    pfand,
    shotName: item.shot && item.shot.id !== 'none' ? item.shot.name : undefined,
    ...(pfand ? { pfandTaxRate: rate, pfandNet: calcNet(pfand, rate), pfandTax } : {}),
  };
}

function sumNet(lines: readonly TransactionItem[]): number {
  return lines.reduce((sum, line) => sum + (line.pfandNet ?? 0), 0);
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
    const cardPfandTax: Record<number, number> = {};
    const cardItems = goodsLines.map((item) => goodsItem(item, location, taxByRate, cardPfandTax));
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
      pfandTaxByRate: cardPfandTax,
      pfandNet: sumNet(cardItems),
      paymentMethod: 'card',
      location,
      paymentSplitId: splitId,
      paymentSplitRole: 'card-goods',
    };
    // One cash payout receipt per retoure line (the POS keeps at most one).
    const payouts = retoureLines.map((item, index) => {
      const payoutPfandTax: Record<number, number> = {};
      const line = retoureItem(item, location, payoutPfandTax);
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
        // taxByRate/totalTax/totalNet bleiben 0 (DB-Pruefung fuer Pfandausgaben);
        // die Entgeltminderung steht in pfandTaxByRate/pfandNet.
        pfandTaxByRate: payoutPfandTax,
        pfandNet: sumNet([line]),
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
  const pfandTaxByRate: Record<number, number> = {};
  const txItems = items.map((item) => item.isPfandRetoure
    ? retoureItem(item, location, pfandTaxByRate)
    : goodsItem(item, location, taxByRate, pfandTaxByRate));
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
    pfandTaxByRate,
    pfandNet: sumNet(txItems),
    paymentMethod: totals.isPfandOnly ? 'cash' : (paymentMethod ?? 'cash'),
    amountPaid: cashPayment ? given : undefined,
    change: cashPayment ? given - totals.total : undefined,
    location,
  }];
}
