import type { CashSession, Location, Transaction } from '../types';
import { sessionTransactions } from './sessionTransactions.ts';

/**
 * Kassen-Übersicht und Tagesinfo zeigen den GANZEN Tag eines Standorts.
 * An einem Tag kann es mehrere Kassensitzungen geben (z. B. eine versehentlich
 * geöffnete und wieder abgeschlossene leere Kasse). Der Umsatz aller Sitzungen
 * wird zusammengerechnet; Bestände gelten je Sitzung.
 * Buchungen werden weiterhin über ihre Sitzung zugeordnet (auch nach Mitternacht).
 */
export interface DaySessionPart {
  session: CashSession;
  transactions: Transaction[];
  cashBalance: number;
}

export interface DayOverview {
  /** Alle nicht verworfenen Sitzungen des Tages, älteste zuerst. */
  parts: DaySessionPart[];
  /** Neueste Sitzung (Status OFFEN/ABGESCHLOSSEN, aktueller Kassenbestand). */
  latest: DaySessionPart | null;
  /** Alle Buchungen des Tages, neueste zuerst, ohne Doppelte. */
  transactions: Transaction[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function sessionCashBalance(session: CashSession, sessionTx: readonly Transaction[]): number {
  return round2(session.openingBalance +
    session.entries.reduce((sum, entry) => sum + (entry.type === 'deposit' ? entry.amount : -entry.amount), 0) +
    sessionTx.filter((tx) => tx.paymentMethod === 'cash').reduce((sum, tx) => sum + tx.total, 0));
}

export function buildDayOverview(
  cashSessions: readonly CashSession[],
  transactions: readonly Transaction[],
  date: string,
  location: Location,
): DayOverview {
  const sessions = cashSessions
    .filter((session) => session.date === date && session.location === location && !session.discarded)
    .sort((a, b) => a.openedAt - b.openedAt);
  const seen = new Set<string>();
  const parts: DaySessionPart[] = sessions.map((session) => {
    const own = sessionTransactions(transactions, session).filter((tx) => !seen.has(tx.id));
    for (const tx of own) seen.add(tx.id);
    return { session, transactions: own, cashBalance: sessionCashBalance(session, own) };
  });
  const all = parts.flatMap((part) => part.transactions).sort((a, b) => b.timestamp - a.timestamp);
  return { parts, latest: parts[parts.length - 1] ?? null, transactions: all };
}

/**
 * Anfangsbestand für Journal-Zeiträume: je Standort und Tag zählt nur die
 * ERSTE Kassensitzung (der echte Morgenbestand). Weitere Sitzungen am selben
 * Tag übernehmen nur den Endbestand der vorigen und dürfen nicht doppelt zählen.
 */
export function openingBalanceOfDays(sessions: readonly CashSession[]): number {
  const first = new Map<string, CashSession>();
  for (const session of sessions) {
    if (session.discarded) continue;
    const key = `${session.location}|${session.date}`;
    const current = first.get(key);
    if (!current || session.openedAt < current.openedAt) first.set(key, session);
  }
  return round2([...first.values()].reduce((sum, session) => sum + session.openingBalance, 0));
}
