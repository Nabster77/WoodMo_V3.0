import { movementBadgeHTML, hasNegativeMoney, negativeMoneyClass } from '@/lib/movementStyle';
import { useMemo, useState, type ReactNode } from 'react';
import { X, Lock, FileDown, Check, TriangleAlert as AlertTriangle, Calculator, Coins, Banknote } from 'lucide-react';
import { formatCurrency, formatTime } from '@/lib/format';
import { formatCashSessionTimestamp, verifiedCloseTimestamp } from '@/lib/cashSessionTimes';
import { escapeHtml } from '@/lib/escapeHtml';
import { openingCorrectionView, signedAmountLabel } from '@/lib/openingCorrection';
import { mergeTaxByRate, transactionNet, transactionPfandTax } from '@/lib/tax';
import { formatDailyCloseReceiptNumber } from '@/lib/dailyCloseReceipt';
import { renderPdfHtml } from '@/lib/journalPdfFile';
import { calculateYearlyPfandOverview, type YearlyPfandOverview } from '@/lib/journalPdf';
import { sessionTransactions } from '@/lib/sessionTransactions';
import { projectFinancialTransactions, type StornoJournalTransaction } from '@/lib/stornoReportProjection';
import type { StornoRecord } from '@/lib/stornoRules';
import type { CashSession, StaffActivity, StaffLoginInterval, StaffUser, Transaction } from '@/types';

const DENOMINATIONS: { label: string; value: number }[] = [
  { label: '1 Cent', value: 0.01 },
  { label: '2 Cent', value: 0.02 },
  { label: '5 Cent', value: 0.05 },
  { label: '10 Cent', value: 0.10 },
  { label: '20 Cent', value: 0.20 },
  { label: '50 Cent', value: 0.50 },
  { label: '1 Euro', value: 1 },
  { label: '2 Euro', value: 2 },
  { label: '5 Euro', value: 5 },
  { label: '10 Euro', value: 10 },
  { label: '20 Euro', value: 20 },
  { label: '50 Euro', value: 50 },
  { label: '100 Euro', value: 100 },
  { label: '200 Euro', value: 200 },
];

const COINS = DENOMINATIONS.filter((denomination) => denomination.value < 5);
const NOTES = DENOMINATIONS.filter((denomination) => denomination.value >= 5);

type MovementKind = 'Pfandausgabe' | 'Bareinnahme' | 'Karteneinnahme' | 'Storno' | 'Einlage' | 'Ausgabe' | 'Korrektur';

interface MovementRecord {
  id: string;
  kind: MovementKind;
  timestamp: number;
  employeeName?: string;
  amount: number;
  details: string;
}

/**
 * A checkout can contain both sold articles and a returned deposit.  The
 * payment itself remains one transaction, but its display must be split so a
 * "Pfandausgabe" never contains a sold article or an incoming deposit.
 */
function transactionMovementRecords(transaction: Transaction): MovementRecord[] {
  if ('isStornoProjection' in transaction && transaction.isStornoProjection === true) {
    return [{
      id: transaction.id,
      kind: 'Storno',
      timestamp: transaction.timestamp,
      employeeName: transaction.employeeName,
      amount: transaction.total,
      details: `Originalbon: ${(transaction as StornoJournalTransaction).stornoOriginalId} · Grund: ${(transaction as StornoJournalTransaction).stornoReason}`,
    }];
  }
  const records: MovementRecord[] = [];
  const returnedDepositItems = transaction.items.filter((item) => item.isPfandRetoure);
  const soldItems = transaction.items.filter((item) => !item.isPfandRetoure);

  if (returnedDepositItems.length > 0) {
    records.push({
      id: `${transaction.id}-pfand-retoure`,
      kind: 'Pfandausgabe',
      timestamp: transaction.timestamp,
      employeeName: transaction.employeeName,
      amount: returnedDepositItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
      details: returnedDepositItems.map((item) => `${item.quantity}× Pfand-Retoure`).join(', '),
    });
  }

  if (soldItems.length > 0) {
    records.push({
      id: `${transaction.id}-artikelverkauf`,
      kind: transaction.paymentMethod === 'cash' ? 'Bareinnahme' : 'Karteneinnahme',
      timestamp: transaction.timestamp,
      employeeName: transaction.employeeName,
      // The item line's pfand is an incoming deposit and therefore belongs to
      // the actual sale/payment method, never to the deposit payout group.
      amount: soldItems.reduce((sum, item) => sum + item.price * item.quantity + item.pfand, 0),
      details: soldItems.map((item) => `${item.quantity}× ${item.name}`).join(', '),
    });
  }

  return records;
}



interface Props {
  session: CashSession;
  transactions: Transaction[];
  stornos?: StornoRecord[];
  currentStaff: StaffUser | null;
  onClose: (closingBalance: number, closingWithdrawalAmount: number, countDifferenceReason?: string) => Promise<{ ok: boolean; error?: string; receiptLabel?: string; synced?: boolean }>;
  onCancel: () => void;
}

export function DailyCloseDialog({ session, transactions, stornos = [], currentStaff, onClose, onCancel }: Props) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [differenceReason, setDifferenceReason] = useState('');
  const [useCounting, setUseCounting] = useState(false); // 24.11.: Standard „Direkt“
  const [manualInput, setManualInput] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [withdrawalStep, setWithdrawalStep] = useState(false);
  const [closingWithdrawalInput, setClosingWithdrawalInput] = useState('');

  const sessionTx = useMemo(
    () => projectFinancialTransactions(
      sessionTransactions(transactions, session),
      stornos.filter((entry) => entry.cashSessionId === session.id),
      session.openedAt,
      Infinity,
    ),
    [transactions, session, stornos],
  );
  const yearlyPfandOverview = useMemo(
    () => calculateYearlyPfandOverview(
      projectFinancialTransactions(transactions, stornos),
      new Date(session.openedAt).getFullYear(), session.location),
    [transactions, stornos, session.openedAt, session.location],
  );

  // Sales turnover never includes deposits. Deposits are neither taxable nor
  // revenue; they are displayed separately below.
  const txTotal = sessionTx.reduce((sum, transaction) => sum + transaction.subtotal, 0);
  const cashTxTotal = sessionTx
    .filter((transaction) => transaction.paymentMethod === 'cash')
    .reduce((sum, transaction) => sum + transaction.subtotal, 0);
  const cardTxTotal = sessionTx
    .filter((transaction) => transaction.paymentMethod === 'card')
    .reduce((sum, transaction) => sum + transaction.subtotal, 0);
  // The physical till does include cash deposits and returned deposits. Keep
  // this separate from taxable cash turnover.
  const cashTillTransactionTotal = sessionTx
    .filter((transaction) => transaction.paymentMethod === 'cash')
    .reduce((sum, transaction) => sum + transaction.total, 0);
  const taxByRate = useMemo(() => mergeTaxByRate(sessionTx), [sessionTx]);
  const totalTax = [...taxByRate.values()].reduce((s, v) => s + v, 0);
  // Netto/USt inkl. Pfand (ab 17.11.2026 im Bon gespeichert; aeltere Bons ohne Pfand-USt).
  const totalNet = sessionTx.reduce((s, t) => s + transactionNet(t), 0);
  const deposits = session.entries.filter((e) => e.type === 'deposit').reduce((s, e) => s + e.amount, 0);
  const withdrawals = session.entries.filter((e) => e.type === 'withdrawal').reduce((s, e) => s + e.amount, 0);
  const expected = Math.round((session.openingBalance + cashTillTransactionTotal + deposits - withdrawals) * 100) / 100;
  const countedTotal = useMemo(() => {
    let sum = 0;
    for (const d of DENOMINATIONS) {
      const c = parseInt(counts[d.value] ?? '', 10);
      if (!isNaN(c) && c > 0) sum += c * d.value;
    }
    return Math.round(sum * 100) / 100;
  }, [counts]);

  const countValue = (denominations: typeof DENOMINATIONS) => Math.round(
    denominations.reduce((sum, denomination) => {
      const quantity = parseInt(counts[denomination.value] ?? '', 10);
      return sum + (Number.isNaN(quantity) || quantity < 1 ? 0 : quantity * denomination.value);
    }, 0) * 100,
  ) / 100;
  const coinTotal = countValue(COINS);
  const noteTotal = countValue(NOTES);

  const manualValue = Math.round((parseFloat(manualInput.trim().replace(/\s/g, '').replace(',', '.')) || 0) * 100) / 100;
  const hasInput = useCounting ? Object.values(counts).some((v) => v.trim() !== '') : manualInput.trim() !== '';
  const closingBalance = hasInput ? (useCounting ? countedTotal : manualValue) : expected;
  const grossWithPfand = Math.round(sessionTx.reduce((sum, transaction) => sum + transaction.total, 0) * 100) / 100;
  const diff = closingBalance - expected;
  const closingWithdrawalAmount = Math.max(0, parseFloat(closingWithdrawalInput.replace(',', '.')) || 0);
  // The next opening balance is always determined from the booked cash
  // movements. A counted/manual value is only a control value and must not
  // accidentally overwrite the mathematical closing balance.
  const remainingCash = Math.round((closingBalance - closingWithdrawalAmount) * 100) / 100;

    function beginClose() {
    if (isNaN(closingBalance) || closingBalance < 0 || !confirmed) return;
    if (Math.abs(diff) > 0.01 && !differenceReason.trim()) {
      setCloseError('Bei einer Kassenabweichung ist eine Begruendung Pflicht.');
      return;
    }
    setCloseError(null);
    setWithdrawalStep(true);
  }

    async function handleClose() {
    if (isNaN(closingBalance) || closingBalance < 0 || !confirmed) return;
    if (Math.abs(diff) > 0.01 && !differenceReason.trim()) {
      setCloseError('Bei einer Kassenabweichung ist eine Begruendung Pflicht.');
      return;
    }
    if (closingWithdrawalAmount > closingBalance) {
      setCloseError('Die Entnahme darf nicht höher sein als der tatsächliche Kassenbestand.');
      return;
    }
    setCloseError(null);
    setIsFinalizing(true);
    try {
      const actualRemaining = Math.round((closingBalance - closingWithdrawalAmount) * 100) / 100;
      const result = await onClose(actualRemaining, Math.round(closingWithdrawalAmount * 100) / 100,
        Math.abs(diff) > 0.01 ? differenceReason.trim() : undefined);
      if (!result.ok) setCloseError(result.error ?? 'Beleg konnte nicht erstellt werden. Bitte erneut versuchen.');
    } catch {
      setCloseError('Beleg konnte nicht erstellt werden. Bitte Internetverbindung prüfen und erneut versuchen.');
    } finally {
      setIsFinalizing(false);
    }
  }

  function handlePDFExport() {
    const b = hasInput && !isNaN(closingBalance) ? closingBalance : expected;
    void generatePDF(session, sessionTx, {
      txTotal, cashTxTotal, cardTxTotal, taxByRate: Object.fromEntries(taxByRate), totalNet, deposits, withdrawals, expected, closingBalance: b, difference: b - expected,
    }, currentStaff?.name, yearlyPfandOverview);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/50 p-4 sm:items-center" onClick={onCancel}>
      <div className="my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-gray-100">
            <Lock className="h-5 w-5 text-blue-600 dark:text-blue-400" /> Tagesabschluss
          </h3>
          <button onClick={onCancel} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-3 text-sm">
            <p className="text-base font-bold text-gray-900 dark:text-gray-100">{session.location}</p>
            <p className="text-gray-600 dark:text-gray-300">Eröffnet: {formatCashSessionTimestamp(session.openedAt)}</p>
            <p className={`font-bold ${session.closed ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
              {session.closed ? 'Endgültig abgeschlossen' : 'Entwurf – noch nicht endgültig abgeschlossen'}
            </p>
            {session.closed && verifiedCloseTimestamp(session) !== null && <p className="text-gray-600 dark:text-gray-300">Abgeschlossen: {formatCashSessionTimestamp(verifiedCloseTimestamp(session)!)}</p>}
            {session.dailyCloseReceiptNumber && <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Belegnummer: {formatDailyCloseReceiptNumber(session.dailyCloseReceiptNumber, session.dailyCloseReceiptLocation ?? session.location, session.closedAt ?? session.openedAt, session.dailyCloseReceiptYear)}</p>}
          </div>

          {/* 1) Kassenbestand kompakt (nur Bargeld) */}
          <div className="mb-3 space-y-1.5 rounded-2xl bg-gray-50 p-4 dark:bg-gray-900/40">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Kassenbestand (nur Bargeld)</p>
              <p className="text-lg font-extrabold text-gray-900 dark:text-gray-100"><MoneyAmount value={expected} /></p>
            </div>
            <Row label="Anfangsbestand" value={<MoneyAmount value={session.openingBalance} />} />
            <Row label="Bargeldeinnahmen (Barbons inkl. Pfand)" value={signedAmountLabel(cashTillTransactionTotal, formatCurrency)} />
            {Math.abs(deposits - withdrawals) >= 0.005 && <Row label="Einlagen / Ausgaben" value={signedAmountLabel(deposits - withdrawals, formatCurrency)} />}
            <div className="border-t border-gray-200 pt-1.5 dark:border-gray-700">
              <Row label="= Erwarteter Kassenbestand" value={<MoneyAmount value={expected} />} bold />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Kartenzahlungen zählen zum Umsatz, nicht zum Bargeld.</p>
            {/* 2) Tagesumsatz direkt darunter, im selben Block (Karte zählt zum Umsatz, nicht zum Bargeld) */}
            <div className="mt-2 rounded-xl bg-green-50 p-3 dark:bg-green-900/30">
              <p className="mb-1.5 text-sm font-bold text-green-700 dark:text-green-400">Tagesumsatz</p>
              <div className="space-y-1 text-sm text-green-800 dark:text-green-300">
                <Row label="Umsatz brutto ohne Pfand" value={<MoneyAmount value={txTotal} />} bold />
                <Row label="Umsatz brutto mit Pfand" value={<MoneyAmount value={grossWithPfand} />} />
                <Row label="Davon Barzahlungen" value={<MoneyAmount value={cashTxTotal} />} />
                <Row label="Davon Kartenzahlungen" value={<MoneyAmount value={cardTxTotal} />} />
                <Row label="Enthaltene Mehrwertsteuer (Ware + Pfand)" value={<MoneyAmount value={totalTax} />} />
              </div>
            </div>
          </div>

          {/* 3) Tatsächlicher Kassenbestand: Direkt (Standard) oder Geld-Zählhilfe */}
          <div className="mb-3">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tatsächlicher Kassenbestand</label>
              <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900/60">
                <button onClick={() => setUseCounting(false)}
                  className={`flex min-h-9 items-center gap-1 rounded-md px-3 text-xs font-semibold transition ${!useCounting ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                  Direkt
                </button>
                <button onClick={() => setUseCounting(true)}
                  className={`flex min-h-9 items-center gap-1 rounded-md px-3 text-xs font-semibold transition ${useCounting ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                  <Calculator className="h-3 w-3" /> Geld-Zählhilfe
                </button>
              </div>
            </div>

            {useCounting ? (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <DenominationGroup title="Münzen" subtitle="1 Cent bis 2 Euro" icon={<Coins className="h-4 w-4" />} labelClass="text-amber-800 dark:text-amber-500"
                  denominations={COINS} counts={counts} total={coinTotal}
                  onChange={(value, quantity) => setCounts((previous) => ({ ...previous, [value]: quantity }))} />
                <DenominationGroup title="Scheine" subtitle="5 € bis 200 €" icon={<Banknote className="h-4 w-4" />} labelClass="text-green-800 dark:text-green-500"
                  denominations={NOTES} counts={counts} total={noteTotal}
                  onChange={(value, quantity) => setCounts((previous) => ({ ...previous, [value]: quantity }))} />
                <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2 dark:border-gray-700">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Leere Felder zählen als 0. Gesamtsumme:</span>
                  <span className="text-base font-bold text-gray-900 dark:text-gray-100"><MoneyAmount value={countedTotal} /></span>
                </div>
              </div>
            ) : (
              <input value={manualInput} onChange={(event) => { setManualInput(event.target.value.replace(/[^\d.,]/g, '')); setCloseError(null); }}
                inputMode="decimal" placeholder={`${formatCurrency(expected)} (leer = erwarteter Bestand)`} aria-label="Tatsächlicher Kassenbestand in Euro"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-base font-bold text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
            )}
          </div>

          {hasInput && !isNaN(closingBalance) && Math.abs(diff) > 0.01 && (
            <div className={`mb-3 flex items-center gap-2 rounded-xl p-3 text-sm ${diff > 0 ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
              <AlertTriangle className="h-4 w-4" />
              {diff > 0 ? `Mehrbestand: ${formatCurrency(diff)}` : `Fehlbestand: ${formatCurrency(Math.abs(diff))}`}
            </div>
          )}

          {hasInput && Math.abs(diff) > 0.01 && (
            <label className="mb-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Begruendung der Kassenabweichung (Pflichtfeld)
              <textarea value={differenceReason} onChange={event => setDifferenceReason(event.target.value)}
                rows={2} required placeholder="Warum weicht der gezaehlte Bestand ab?"
                className="mt-1.5 w-full rounded-xl border border-amber-400 bg-white px-3 py-2.5 text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100" />
            </label>
          )}

          {hasInput && !isNaN(closingBalance) && Math.abs(diff) <= 0.01 && (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              <Check className="h-4 w-4" /> Kassenbestand stimmt mit dem erwarteten Bestand überein.
            </div>
          )}

          {!hasInput && (
            <div className="mb-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
              Kein Betrag eingegeben. Beim Abschließen wird der erwartete Bestand (<MoneyAmount value={expected} />) als Ist-Bestand übernommen.
            </div>
          )}

          {closeError && !withdrawalStep && (
            <div className="mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
              {closeError}
            </div>
          )}

          <label className="mb-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-5 w-5 rounded accent-blue-600" />
            Ich bestätige, dass der Tagesabschluss korrekt ist. Nach dem Abschließen ist er nicht mehr änderbar.
          </label>
        </div>

        {/* 4) Eigener Dialog: optionale Entnahme, erst hier wird endgültig abgeschlossen */}
        {withdrawalStep && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-800">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">Entnahme zum Tagesabschluss · {session.location}</p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Optional: Geld aus der Kasse nehmen. Der Rest wird als Anfangsbestand für die nächste Kassenöffnung an diesem Standort vorgeschlagen.</p>
              <label className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-200">Entnahmebetrag (€)
                <input value={closingWithdrawalInput} onChange={(event) => { setClosingWithdrawalInput(event.target.value.replace(/[^\d.,]/g, '')); setCloseError(null); }} placeholder="0,00 (keine Entnahme)" inputMode="decimal"
                  className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
              </label>
              <div className="mt-3 space-y-1 rounded-xl bg-gray-50 p-3 dark:bg-gray-900/50">
                <Row label="Tatsächlicher Bestand vor Entnahme" value={<MoneyAmount value={closingBalance} />} />
                <Row label="Entnahme" value={`- ${formatCurrency(closingWithdrawalAmount)}`} />
                <Row label="Restbestand = nächster Anfangsbestand" value={<MoneyAmount value={remainingCash} />} bold />
              </div>
              {remainingCash < 0 && <p className="mt-2 text-sm font-semibold text-red-600 dark:text-red-400">Die Entnahme ist höher als der Kassenbestand.</p>}
              {closeError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{closeError}</p>}
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => { setWithdrawalStep(false); setCloseError(null); }} disabled={isFinalizing}
                  className="flex-1 rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700 dark:border-gray-600 dark:text-gray-200">Zurück</button>
                <button type="button" onClick={() => void handleClose()} disabled={isFinalizing || remainingCash < 0}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-md hover:bg-blue-700 disabled:opacity-50">
                  <Check className="h-4 w-4" /> {isFinalizing ? 'Beleg wird erstellt …' : closingWithdrawalAmount > 0 ? 'Mit Entnahme abschließen' : 'Ohne Entnahme abschließen'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          <button onClick={handlePDFExport}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
            <FileDown className="h-4 w-4" /> PDF-Export
          </button>
          <button onClick={beginClose} disabled={isFinalizing || isNaN(closingBalance) || closingBalance < 0 || !confirmed}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-700 active:scale-95 disabled:opacity-50">
            <Check className="h-4 w-4" /> Endgültig abschließen
          </button>
        </div>
      </div>
    </div>
  );
}

function DenominationGroup({
  labelClass = 'text-gray-700 dark:text-gray-300',
  title,
  subtitle,
  icon,
  denominations,
  counts,
  total,
  onChange,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  labelClass?: string;
  denominations: typeof DENOMINATIONS;
  counts: Record<number, string>;
  total: number;
  onChange: (value: number, quantity: string) => void;
}) {
  return (
    <section className="mb-3 rounded-xl border border-gray-200 bg-white p-2.5 dark:border-gray-700 dark:bg-gray-800/60">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-bold text-gray-800 dark:text-gray-100">
          <span className="text-blue-600 dark:text-blue-400">{icon}</span>
          <span>{title}</span>
          <span className="text-xs font-normal text-gray-500 dark:text-gray-400">· {subtitle}</span>
        </div>
        <span className="text-sm font-bold text-gray-800 dark:text-gray-100"><MoneyAmount value={total} /></span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {denominations.map((denomination) => {
          const quantity = parseInt(counts[denomination.value] ?? '', 10);
          const itemTotal = Number.isNaN(quantity) || quantity < 1 ? 0 : quantity * denomination.value;
          return (
            <label key={denomination.value} className="rounded-lg bg-gray-50 px-2 py-1.5 dark:bg-gray-900/60">
              <span className={`mb-1 flex items-center justify-between text-xs font-bold ${labelClass}`}>
                {denomination.label}
                <span className="font-normal text-gray-500 dark:text-gray-400"><MoneyAmount value={itemTotal} /></span>
              </span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={counts[denomination.value] ?? ''}
                onChange={(event) => onChange(denomination.value, event.target.value)}
                placeholder="0 Stück"
                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
          );
        })}
      </div>
    </section>
  );
}

function MoneyAmount({ value }: { value: number }) {
  return <span className={value < 0 ? negativeMoneyClass : undefined}>{formatCurrency(value)}</span>;
}

function Row({ label, value, bold }: { label: string; value: ReactNode; bold?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className={bold ? 'font-bold text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}>{label}</span>
      <span className={`${bold ? 'font-bold' : ''} ${typeof value === 'string' && hasNegativeMoney(value) ? negativeMoneyClass : 'text-gray-600 dark:text-gray-300'}`}>{value}</span>
    </div>
  );
}

// ---- PDF generation ----

interface StaffTimeRow { name: string; loginAt: number; logoutAt: number; durationMs: number; }

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.round(durationMs / 60_000));
  return `${Math.floor(totalMinutes / 60)} Std. ${String(totalMinutes % 60).padStart(2, '0')} Min.`;
}

/**
 * Old sessions did not have explicit login intervals. Build a best-effort
 * fallback from their activity history so existing reports stay readable.
 */
function intervalsFromLegacyActivities(activities: StaffActivity[], closedAt: number): StaffLoginInterval[] {
  const intervals: StaffLoginInterval[] = [];
  for (const activity of [...activities].sort((a, b) => a.timestamp - b.timestamp)) {
    if (activity.type === 'login' || activity.type === 'cash_opened') {
      if (!intervals.some((interval) => interval.staffId === activity.staffId && interval.logoutAt === undefined)) {
        intervals.push({ id: `legacy-${activity.id}`, staffId: activity.staffId, staffName: activity.staffName, loginAt: activity.timestamp });
      }
    } else if (activity.type === 'logout') {
      for (let index = intervals.length - 1; index >= 0; index -= 1) {
        const interval = intervals[index];
        if (interval.staffId === activity.staffId && interval.logoutAt === undefined) {
          intervals[index] = { ...interval, logoutAt: Math.max(activity.timestamp, interval.loginAt) };
          break;
        }
      }
    }
  }
  return intervals.map((interval) => interval.logoutAt ? interval : { ...interval, logoutAt: closedAt });
}

function staffTimesForFinalClose(session: CashSession, closedAt: number): StaffTimeRow[] {
  const intervals = session.staffLoginIntervals?.length
    ? session.staffLoginIntervals
    : intervalsFromLegacyActivities(session.activities ?? [], closedAt);

  // Every row is one real login period. If a person logs out and returns,
  // the inactive time is never counted as working time.
  return intervals
    .map((interval) => {
      const logoutAt = Math.max(interval.logoutAt ?? closedAt, interval.loginAt);
      return { name: interval.staffName, loginAt: interval.loginAt, logoutAt, durationMs: logoutAt - interval.loginAt };
    })
    .sort((a, b) => a.loginAt - b.loginAt);
}

async function generatePDF(
  session: CashSession,
  txList: Transaction[],
  sums: { txTotal: number; cashTxTotal: number; cardTxTotal: number; taxByRate: Record<number, number>; totalNet: number; deposits: number; withdrawals: number; expected: number; closingBalance: number; difference: number },
  exportedByName?: string,
  yearlyPfandOverview?: YearlyPfandOverview,
) {
  const taxEntries = Object.entries(sums.taxByRate).map(([rate, amount]) => [Number(rate), amount] as const).sort((a, b) => a[0] - b[0]);
  const totalTax = taxEntries.reduce((sum, [, amount]) => sum + amount, 0);
  const receiptPfandTax = txList.reduce((sum, transaction) => sum + transactionPfandTax(transaction), 0);
  // These are display values for the receipt only. They do not change the
  // sales, cash-balance, or tax calculations above.
  const pfandIncome = txList.reduce((sum, transaction) => sum + transaction.items
    .filter((item) => !item.isPfandRetoure)
    .reduce((itemSum, item) => itemSum + item.pfand, 0), 0);
  const pfandPayout = Math.abs(txList.reduce((sum, transaction) => sum + transaction.items
    .filter((item) => item.isPfandRetoure)
    .reduce((itemSum, item) => itemSum + item.price * item.quantity, 0), 0));
  // Only a cash transaction can change the physical till. A returned deposit
  // inside a card sale is settled through the card total and must not appear
  // as a cash payout in the cash-balance section.
  const cashPfandIncome = txList
    .filter((transaction) => transaction.paymentMethod === 'cash')
    .reduce((sum, transaction) => sum + transaction.items
      .filter((item) => !item.isPfandRetoure)
      .reduce((itemSum, item) => itemSum + item.pfand, 0), 0);
  const cashPfandPayout = Math.abs(txList
    .filter((transaction) => transaction.paymentMethod === 'cash')
    .reduce((sum, transaction) => sum + transaction.items
      .filter((item) => item.isPfandRetoure)
      .reduce((itemSum, item) => itemSum + item.price * item.quantity, 0), 0));
  const printOpeningView = openingCorrectionView(session);
  const openingLines = printOpeningView
    ? `<div class="sum"><span>Übernommen vom Vortag</span><span>${formatCurrency(printOpeningView.carriedBalance)}</span></div>` +
      printOpeningView.lines.map((line) => `<div class="sum"><span>Korrektur Anfangsbestand · ${escapeHtml(formatTime(line.timestamp))} · ${escapeHtml(line.employeeName ?? 'unbekannt')}${line.reason ? ` · Grund: ${escapeHtml(line.reason)}` : ''}</span><span>${signedAmountLabel(line.amount, formatCurrency)}</span></div>`).join('') +
      `<div class="sum bold"><span>= Anfangsbestand (Ist)</span><span>${formatCurrency(session.openingBalance)}</span></div>`
    : `<div class="sum"><span>Anfangsbestand</span><span>${formatCurrency(session.openingBalance)}</span></div>`;
  const pfandBalance = Math.round((pfandIncome - pfandPayout) * 100) / 100;
  const pfandResult = pfandBalance > 0
    ? `<div class="sum bold pfand-profit"><span>Pfandgewinn</span><span>+ ${formatCurrency(pfandBalance)}</span></div>`
    : pfandBalance < 0
      ? `<div class="sum bold pfand-loss"><span>Pfandverlust</span><span>- ${formatCurrency(Math.abs(pfandBalance))}</span></div>`
      : '<div class="sum bold"><span>Pfandsaldo</span><span>0,00 €</span></div>';
  const isFinal = session.closed;
  const finalTime = verifiedCloseTimestamp(session);
  if (isFinal && (finalTime === null || finalTime < session.openedAt)) {
    throw new Error('Tagesabschluss ohne verifizierbaren Abschlusszeitpunkt. PDF nicht erstellt.');
  }
  const documentTime = finalTime ?? Date.now();
  const receipt = formatDailyCloseReceiptNumber(session.dailyCloseReceiptNumber, session.dailyCloseReceiptLocation ?? session.location, documentTime, session.dailyCloseReceiptYear);
  // Use the same split representation as the on-screen overview: a mixed
  // sale with a returned deposit is two visible movements, never one false
  // "Pfandausgabe" containing an article sale.
  const transactionRows = txList
    .flatMap((transaction) => transactionMovementRecords(transaction))
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((record) => ({ timestamp: record.timestamp, staff: record.employeeName ?? 'Unbekannt', kind: record.kind, value: formatCurrency(record.amount), reason: record.details }))
    .map((row) => `<tr><td>${new Date(row.timestamp).toLocaleDateString('de-DE')}</td><td>${formatTime(row.timestamp)}</td><td>${escapeHtml(row.staff)}</td><td>${movementBadgeHTML(row.kind)}</td><td>${escapeHtml(row.value)}</td><td>${escapeHtml(row.reason)}</td></tr>`).join('');
  const cashMovementRows = [
    ...session.entries.map((entry) => ({ timestamp: entry.timestamp, staff: entry.employeeName ?? 'Unbekannt', kind: entry.type === 'deposit' ? 'Einlage' : entry.isPfandRetoure ? 'Pfand-Retoure' : 'Ausgabe', value: `${entry.type === 'deposit' ? '+' : '-'}${formatCurrency(entry.amount)}`, reason: entry.reason })),
    ...session.corrections.map((correction) => ({ timestamp: correction.timestamp, staff: correction.employeeName ?? 'Unbekannt', kind: 'Korrektur', value: `${formatCurrency(correction.oldAmount)} → ${formatCurrency(correction.newAmount)} (${correction.newAmount - correction.oldAmount > 0 ? '+' : ''}${formatCurrency(correction.newAmount - correction.oldAmount)})`, reason: correction.reason })),
  ].sort((a, b) => a.timestamp - b.timestamp)
    .map((row) => `<tr><td>${new Date(row.timestamp).toLocaleDateString('de-DE')}</td><td>${formatTime(row.timestamp)}</td><td>${escapeHtml(row.staff)}</td><td>${movementBadgeHTML(row.kind)}</td><td>${escapeHtml(row.value)}</td><td>${escapeHtml(row.reason)}</td></tr>`).join('');
  const staffRows = staffTimesForFinalClose(session, documentTime)
    .map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${formatTime(row.loginAt)}</td><td>${formatTime(row.logoutAt)}</td><td>${formatDuration(row.durationMs)}</td></tr>`).join('');
  const staffTotals = new Map<string, number>();
  for (const row of staffTimesForFinalClose(session, documentTime)) {
    staffTotals.set(row.name, (staffTotals.get(row.name) ?? 0) + row.durationMs);
  }
  const staffTotalRows = [...staffTotals.entries()].map(([name, duration]) =>
    `<div class="sum"><span>${escapeHtml(name)}: gesamte Anmeldezeit am Tag:</span><strong>${formatDuration(duration)}</strong></div>`,
  ).join('');
  const taxLines = taxEntries.map(([rate, amount]) => `<div class="sum"><span>davon MwSt ${rate}%</span><span>${formatCurrency(amount)}</span></div>`).join('');
  const status = isFinal ? 'Endgültig abgeschlossen' : 'Entwurf – noch nicht endgültig abgeschlossen';
  const statusClass = isFinal ? 'final' : 'draft';
  const overallDuration = isFinal && session.closedAt ? formatDuration(session.closedAt - session.openedAt) : 'wird beim endgültigen Abschluss berechnet';
  const reportPeriodLabel = isFinal ? `Endgültiger Tagesabschluss ${formatCashSessionTimestamp(documentTime)}` : 'Entwurf – noch kein Tagesabschluss';
  const yearlyPfandSaldo = yearlyPfandOverview?.pfandSaldo ?? 0;
  const yearlyPfandLabel = yearlyPfandSaldo > 0 ? 'Pfandgewinn' : yearlyPfandSaldo < 0 ? 'Pfandverlust' : 'Pfandsaldo';
  const yearlyPfandValue = yearlyPfandSaldo > 0
    ? `+ ${formatCurrency(yearlyPfandSaldo)}`
    : yearlyPfandSaldo < 0 ? `- ${formatCurrency(Math.abs(yearlyPfandSaldo))}` : formatCurrency(0);
  const yearlyPfandClass = yearlyPfandSaldo > 0 ? 'pfand-profit' : yearlyPfandSaldo < 0 ? 'pfand-loss' : '';
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${escapeHtml(`${session.location}_Tagesabschluss_${session.date.split('-').reverse().join('-')}`)}</title><style>
    *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#1e293b;line-height:1.4;font-size:12px;margin:0}h1{font-size:26px;margin:0;text-align:center;color:#1e3a5f}h2{font-size:15px;margin:22px 0 7px;border-bottom:1px solid #cbd5e1;padding-bottom:4px;break-after:avoid;page-break-after:avoid}.heading{text-align:center;margin-bottom:17px}.meta{font-size:15px;font-weight:700;color:#2563eb;margin-top:5px}.staff{font-size:13px;margin-top:4px}.status{display:inline-block;border-radius:5px;padding:4px 8px;font-weight:700;margin-bottom:8px}.draft{background:#fef3c7;color:#92400e}.final{background:#dcfce7;color:#166534}.receipt{font-size:13px;font-weight:700;color:#0f172a;margin-top:5px}.sum{display:flex;justify-content:space-between;padding:4px 0}.bold{font-weight:700;border-top:1px solid #64748b;margin-top:5px;padding-top:7px}.pfand-profit{color:#15803d}.pfand-loss{color:#dc2626}.box{border:1px solid #cbd5e1;border-radius:8px;padding:12px;margin-bottom:14px}.sales{background:#ecfdf5;border-color:#a7f3d0}.sales h2{margin-top:0;color:#047857;border-color:#a7f3d0}table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:10.5px}thead{display:table-header-group}th{text-align:left;border-bottom:2px solid #334155;padding:5px 4px}td{padding:4px;border-bottom:1px solid #e2e8f0;vertical-align:top}tr{break-inside:avoid;page-break-inside:avoid}tr:nth-child(even){background:#f8fafc}.report-block{break-inside:avoid;page-break-inside:avoid}.report-block h2{break-after:avoid;page-break-after:avoid}.report-block table{break-inside:avoid;page-break-inside:avoid}.staff-times{break-inside:avoid;page-break-inside:avoid}.staff-times h2{border-bottom:0;margin-bottom:7px;break-after:avoid;page-break-after:avoid}.staff-times table{break-inside:avoid;page-break-inside:avoid}.staff-times tbody tr{break-inside:avoid;page-break-inside:avoid}
  </style></head><body>
    <div class="heading" data-pdf-page-location="${escapeHtml(session.location)}" data-pdf-page-header="${escapeHtml(`Tagesabschluss · ${session.location} · ${reportPeriodLabel}`)}"><div class="status ${statusClass}">${status}</div><h1>Tagesabschluss</h1><div class="meta">${escapeHtml(session.location)} · ${escapeHtml(reportPeriodLabel)}</div><div class="staff">Mitarbeiter: <strong>${escapeHtml(exportedByName ?? session.closedByName ?? session.openedByName ?? 'Nicht angemeldet')}</strong></div><div class="box" style="margin-top:10px;text-align:left"><div class="sum"><strong>Kasseneröffnung</strong><strong>${escapeHtml(formatCashSessionTimestamp(session.openedAt))}</strong></div><div class="sum"><strong>Endgültiger Tagesabschluss</strong><strong>${isFinal ? escapeHtml(formatCashSessionTimestamp(documentTime)) : 'Noch nicht gebucht (Entwurf)'}</strong></div></div>${receipt ? `<div class="receipt">Belegnummer: ${receipt}</div>` : isFinal ? '<div class="receipt">Belegnummer: wird bei der nächsten Synchronisierung vergeben.</div>' : '<div class="receipt">Belegnummer: wird beim endgültigen Abschluss vergeben.</div>'}</div>
    <div class="box sales"><h2>Tagesumsatz</h2>
      <div class="sum bold"><span>Brutto-Umsatz (ohne Pfand)</span><span>${formatCurrency(sums.txTotal)}</span></div>
      <div class="sum"><span>davon Barumsatz (ohne Pfand)</span><span>${formatCurrency(sums.cashTxTotal)}</span></div>
      <div class="sum"><span>davon Kartenumsatz (ohne Pfand)</span><span>${formatCurrency(sums.cardTxTotal)}</span></div>
      <div class="sum"><span>Pfandeinnahmen</span><span>+ ${formatCurrency(pfandIncome)}</span></div>
      <div class="sum"><span>Pfand-Retouren</span><span>- ${formatCurrency(pfandPayout)}</span></div>${pfandResult}
      <div class="sum bold"><span>Gesamt kassiert (inkl. Pfand) = Bar + Karte</span><span>${formatCurrency(Math.round((sums.txTotal + pfandBalance) * 100) / 100)}</span></div>
      <div class="sum"><span>Netto-Umsatz (inkl. Pfand)</span><span>${formatCurrency(sums.totalNet)}</span></div>
      <div class="sum bold"><span>Enthaltene Mehrwertsteuer (Ware + Pfand)</span><span>${formatCurrency(totalTax)}</span></div>${taxLines}${
      Math.abs(receiptPfandTax) >= 0.005 ? `<div class="sum"><span>davon Mehrwertsteuer auf Pfand</span><span>${formatCurrency(receiptPfandTax)}</span></div>` : ''}
    </div>
    <h2>Kassenbestand</h2><div class="box">
      ${openingLines}
      <div class="sum"><span>Barumsatz</span><span>${formatCurrency(sums.cashTxTotal)}</span></div>
      <div class="sum"><span>Pfandeinnahmen (bar)</span><span>+ ${formatCurrency(cashPfandIncome)}</span></div>
      <div class="sum"><span>Pfandretouren (bar)</span><span>- ${formatCurrency(cashPfandPayout)}</span></div>
      <div class="sum"><span>Bareinlagen</span><span>+ ${formatCurrency(sums.deposits)}</span></div>
      <div class="sum"><span>Barausgaben</span><span>- ${formatCurrency(sums.withdrawals)}</span></div>
      <div class="sum bold"><span>Erwarteter Kassenbestand</span><span>${formatCurrency(sums.expected)}</span></div>
      <div class="sum bold"><span>Tatsächlicher Kassenbestand</span><span>${formatCurrency(sums.closingBalance)}</span></div>
      <div class="sum bold"><span>Differenz</span><span>${formatCurrency(sums.difference)}</span></div>
    </div>
    <section class="report-block"><h2>Transaktionen (${txList.length})</h2><table><thead><tr><th>Datum</th><th>Uhrzeit</th><th>Mitarbeiter</th><th>Vorgang</th><th>Betrag</th><th>Details</th></tr></thead><tbody>${transactionRows || '<tr><td colspan="6">Keine Transaktionen</td></tr>'}</tbody></table></section>
    <section class="report-block"><h2>Kassenbewegungen (${session.entries.length + session.corrections.length})</h2><table><thead><tr><th>Datum</th><th>Uhrzeit</th><th>Mitarbeiter</th><th>Vorgang</th><th>Betrag / Änderung</th><th>Grund</th></tr></thead><tbody>${cashMovementRows || '<tr><td colspan="6">Keine Kassenbewegungen</td></tr>'}</tbody></table></section>
    ${staffRows ? `<section class="staff-times"><h2>Mitarbeiterzeiten</h2><table><thead><tr><th>Mitarbeiter</th><th>Anmeldung</th><th>Abmeldung</th><th>Gesamtzeit</th></tr></thead><tbody>${staffRows}</tbody></table><div class="box">${staffTotalRows}</div></section>` : ''}
    <div class="box"><div class="sum bold"><span>Gesamtdauer der Kasse</span><span>${overallDuration}</span></div></div>
    ${yearlyPfandOverview ? `<section class="report-block"><h2>Pfand-Kontrollübersicht ${yearlyPfandOverview.year}</h2><div class="box"><div class="sum"><span>Pfandeinnahmen</span><span>+ ${formatCurrency(yearlyPfandOverview.pfandCollected)}</span></div><div class="sum"><span>Pfandretouren</span><span>- ${formatCurrency(yearlyPfandOverview.pfandReturned)}</span></div><div class="sum bold ${yearlyPfandClass}"><span>${yearlyPfandLabel}</span><span>${yearlyPfandValue}</span></div><p style="font-size:10px;color:#64748b;margin-top:7px">${escapeHtml(yearlyPfandOverview.scopeLabel)} · alle Buchungen im Kalenderjahr. Der Wert wird beim Zurücksetzen der Buchungen automatisch zurückgesetzt.</p></div></section>` : ''}
  </body></html>`;
  try {
    const pdf = await renderPdfHtml(html);
    const url = URL.createObjectURL(pdf);
    const printWindow = window.open(url, '_blank', 'width=900,height=700');
    if (!printWindow) { alert('Bitte Popups für diese Seite erlauben, um den PDF-Export zu nutzen.'); URL.revokeObjectURL(url); return; }
    // The rendered document already contains correct "Seite X von Y" labels.
    window.setTimeout(() => { try { printWindow.focus(); printWindow.print(); } catch { /* Browser may block printing */ } }, 900);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    alert('Der Tagesabschluss konnte nicht als PDF erzeugt werden. Bitte erneut versuchen.');
  }
}
