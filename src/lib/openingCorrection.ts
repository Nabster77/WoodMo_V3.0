import type { CashSession } from '../types';

/**
 * Anzeige einer Anfangsbestands-Korrektur als eigene Zeile oben in der
 * Kassenrechnung: Übernommen vom Vortag → Korrektur → Anfangsbestand (Ist).
 * Nur Darstellung; der gespeicherte Anfangsbestand enthält die Korrektur schon.
 */
export interface OpeningCorrectionLine {
  /** Änderung (neu − alt), negativ = Geld weniger in der Kasse. */
  amount: number;
  timestamp: number;
  employeeName?: string;
  reason?: string;
}

export interface OpeningCorrectionView {
  /** Bestand vor der ersten Korrektur (aus der Kassenübernahme). */
  carriedBalance: number;
  lines: OpeningCorrectionLine[];
  total: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function openingCorrectionView(session: Pick<CashSession, 'openingBalance' | 'corrections'>): OpeningCorrectionView | null {
  const corrections = [...(session.corrections ?? [])].sort((a, b) => a.timestamp - b.timestamp);
  if (corrections.length === 0) return null;
  const lines = corrections.map((correction) => ({
    amount: round2(correction.newAmount - correction.oldAmount),
    timestamp: correction.timestamp,
    employeeName: correction.employeeName,
    reason: correction.reason,
  }));
  const total = round2(lines.reduce((sum, line) => sum + line.amount, 0));
  return { carriedBalance: round2(session.openingBalance - total), lines, total };
}

export function signedAmountLabel(amount: number, format: (value: number) => string): string {
  return `${amount < 0 ? '−' : '+'} ${format(Math.abs(amount))}`;
}
