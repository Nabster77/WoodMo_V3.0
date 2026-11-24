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

/** Bargeldwirkung eines Stornobelegs (Bar-Storno negativ). Nur die Felder, die der Kassenbestand braucht. */
export type StornoCashEffect = { cashSessionId: string; cashEffect: number; timestamp: number };

export function sessionCashBalance(session: CashSession, sessionTx: readonly Transaction[], before = Infinity, stornos: readonly StornoCashEffect[] = []): number {
  const laterCorrections = session.corrections.filter((correction) => correction.timestamp >= before)
    .reduce((sum, correction) => sum + correction.newAmount - correction.oldAmount, 0);
  const entries = session.entries.filter((entry) => entry.timestamp < before)
    .reduce((sum, entry) => sum + (entry.type === 'deposit' ? entry.amount : -entry.amount), 0);
  const sales = sessionTx.filter((tx) => tx.paymentMethod === 'cash' && tx.timestamp < before)
    .reduce((sum, tx) => sum + tx.total, 0);
  // Fix 23.11.: Bar-Stornos zählen wie in der Kasse und im Tagesabschluss mit.
  const stornoCash = stornos.filter((storno) => storno.cashSessionId === session.id && storno.timestamp < before)
    .reduce((sum, storno) => sum + storno.cashEffect, 0);
  return round2(session.openingBalance - laterCorrections + entries + sales + stornoCash);
}

export function buildDayOverview(
  cashSessions: readonly CashSession[],
  transactions: readonly Transaction[],
  date: string,
  location: Location,
  stornos: readonly StornoCashEffect[] = [],
): DayOverview {
  const start = new Date(date + 'T00:00:00');
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  const sessions = cashSessions
    .filter((session) => session.location === location && !session.discarded && session.openedAt < next.getTime() && (session.closedAt ?? Infinity) >= start.getTime())
    .sort((a, b) => a.openedAt - b.openedAt);
  const seen = new Set<string>();
  // 24.11.: Eine noch offene Kasse (Tagesabschluss steht aus) gehört zum heutigen
  // Tag, auch wenn sie früher eröffnet wurde. Heute zeigt sie den bisher erfassten
  // Umsatz der ganzen laufenden Sitzung. Frühere Tage bleiben nach Kalendertag getrennt.
  const isTodayOrLater = Date.now() < next.getTime();
  const parts: DaySessionPart[] = sessions.map((session) => {
    const sessionTx = sessionTransactions(transactions, session);
    const running = !session.closed && !session.dailyCloseFinalizedAt && isTodayOrLater;
    const own = sessionTx.filter((tx) =>
      (running || (tx.timestamp >= start.getTime() && tx.timestamp < next.getTime())) && !seen.has(tx.id));
    for (const tx of own) seen.add(tx.id);
    return { session, transactions: own, cashBalance: sessionCashBalance(session, sessionTx, next.getTime(), stornos) };
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
