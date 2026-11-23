import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDayOverview, sessionCashBalance } from '../src/lib/dayOverview.ts';

// Ein Tag mit drei Kassensitzungen (wie Bregenz am 17.11.2026):
// Sitzung A mit Verkäufen und Abschluss, danach zwei leere Kassen.
const d = (h, m) => Date.parse(`2026-11-17T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+01:00`);
const session = (id, opened, closed, opening, extra = {}) => ({
  id, location: 'Bregenz', date: '2026-11-17', openedAt: opened, closedAt: closed, closed: closed != null,
  openingBalance: opening, entries: [], corrections: [], activities: [], ...extra,
});
const A = session('A', d(6, 31), d(21, 8), 359, { entries: [{ id: 'w', type: 'withdrawal', amount: 1, timestamp: d(21, 8) }] });
const B = session('B', d(21, 45), d(22, 39), 1480.4);
const C = session('C', d(22, 44), d(22, 51), 1480.4);
const other = session('X', d(7, 0), null, 100, { location: 'Friedrichshafen' });
const discarded = session('Z', d(23, 0), d(23, 1), 0, { discarded: true });
const yesterday = session('Y', d(6, 0) - 86400000, d(20, 0) - 86400000, 50, { date: '2026-11-16' });
const tx = (id, sessionId, at, total, method, extra = {}) => ({
  id, location: 'Bregenz', cashSessionId: sessionId, timestamp: at, total, subtotal: total, totalPfand: 0,
  paymentMethod: method, items: [], taxByRate: {}, ...extra,
});
const txs = [
  tx('t1', 'A', d(12, 0), 10, 'cash'),
  tx('t2', 'A', d(13, 0), 20, 'card'),
  tx('t3', 'A', d(14, 0), 7, 'cash', { subtotal: 4, totalPfand: 3 }),
  tx('legacy', undefined, d(15, 0), 5, 'cash'),
  tx('fn', 'X', d(12, 30), 99, 'cash', { location: 'Friedrichshafen' }),
  tx('old', 'Y', d(12, 0) - 86400000, 50, 'cash'),
];
const sessions = [C, A, other, discarded, B, yesterday];

const day = buildDayOverview(sessions, txs, '2026-11-17', 'Bregenz');
assert.deepEqual(day.parts.map((p) => p.session.id), ['A', 'B', 'C'], 'Alle Sitzungen des Tages, älteste zuerst, ohne verworfene/fremde');
assert.equal(day.latest.session.id, 'C', 'Status kommt von der neuesten Sitzung');
assert.deepEqual(day.transactions.map((t) => t.id), ['legacy', 't3', 't2', 't1'], 'Umsatz des ganzen Tages, neueste zuerst');
assert.deepEqual(day.parts.map((p) => p.transactions.length), [4, 0, 0], 'Leere Kassen haben 0 Verkäufe');
assert.equal(day.parts[0].cashBalance, 359 - 1 + 10 + 7 + 5, 'Bestand Sitzung A');
assert.equal(day.latest.cashBalance, 1480.4, 'Bestand der letzten Kasse');
assert.equal(new Set(day.transactions.map((t) => t.id)).size, day.transactions.length, 'Keine Buchung doppelt');

// Ein normaler Tag mit nur einer Kasse bleibt wie bisher.
const single = buildDayOverview([A], txs, '2026-11-17', 'Bregenz');
assert.equal(single.parts.length, 1);
assert.deepEqual(single.transactions.map((t) => t.id), ['legacy', 't3', 't2', 't1']);
assert.equal(sessionCashBalance(A, single.parts[0].transactions), single.parts[0].cashBalance);
// Bar-Storno senkt den Kassenbestand wie in Kasse und Tagesabschluss (23.11.).
assert.equal(sessionCashBalance(A, single.parts[0].transactions, Infinity, [{ cashSessionId: A.id, cashEffect: -7.2, timestamp: 1 }]),
  Math.round((single.parts[0].cashBalance - 7.2) * 100) / 100);
assert.equal(sessionCashBalance(A, single.parts[0].transactions, Infinity, [{ cashSessionId: 'andere', cashEffect: -7.2, timestamp: 1 }]), single.parts[0].cashBalance);

// Ohne Sitzung: leer.
const none = buildDayOverview(sessions, txs, '2026-11-18', 'Bregenz');
assert.equal(none.latest, null);
assert.equal(none.transactions.length, 0);

// Verwaltung nutzt den ganzen Tag für Karte, Tagesinfo und PDF.
const admin = readFileSync(new URL('../src/components/Admin/AdminScreen.tsx', import.meta.url), 'utf8');
assert.match(admin, /buildDayOverview\(cashSessions, transactions, selectedDate, loc, stornos\)/, 'Kassen-Übersicht zählt Bar-Stornos mit');
assert.match(admin, /Umsatz des Tages \(ohne Pfand\)/);
assert.doesNotMatch(admin, /Umsatz dieser Kassensitzung/);
assert.match(admin, /day\.parts\.map\(\(part\) => part\.session\)/, 'PDF bekommt alle Sitzungen des Tages');
assert.match(admin, /parts=\{locationData\.find/, 'Tagesinfo bekommt alle Sitzungen');
assert.match(admin, /Kassensitzung \$\{index \+ 1\} von \$\{parts\.length\}/);

assert.match(admin, /formatDailyCloseReceiptNumber\(session\.dailyCloseReceiptNumber/, 'Tagesinfo zeigt volle Belegnummer TA-…');
console.log('check-v3-day-overview: OK');

// Journal: Anfangsbestand zählt je Standort/Tag nur die erste Kasse.
const { openingBalanceOfDays } = await import('../src/lib/dayOverview.ts');
assert.equal(openingBalanceOfDays([A, B, C]), 359, '17.11.: nur der Morgenbestand 359,00');
assert.equal(openingBalanceOfDays([A, B, C, other, yesterday, discarded]), 359 + 100 + 50, 'je Standort und Tag');
assert.equal(openingBalanceOfDays([]), 0);
const journal = readFileSync(new URL('../src/components/Journal/JournalScreen.tsx', import.meta.url), 'utf8');
assert.match(journal, /const totalOpeningBalance = openingBalanceOfDays\(relevantSessions\);/);
console.log('check-v3-day-overview (Journal-Anfangsbestand): OK');

// Journal: „Heute“ springt über Mitternacht; „Letzte Woche“ (Mo–So) als Wochenjournal (18.11.2026).
assert.match(journal, /const \[today, setToday\] = useState/);
assert.match(journal, /\}, \[period, customFrom, customTo, today\]\);/);
assert.match(journal, /<option value="lastweek">Letzte Woche<\/option>/);
assert.match(journal, /buildJournalFileName\(period === 'lastweek' \? 'weekly' : period/);
// Kassen-Übersicht: „PDF-Export“ speichert das PDF, „Drucken“ öffnet den Druck (vorher vertauscht).
const adminButtons = readFileSync(new URL('../src/components/Admin/AdminScreen.tsx', import.meta.url), 'utf8');
assert.match(adminButtons, /onClick=\{onExport\}[\s\S]{0,600}PDF-Export/);
assert.match(adminButtons, /onClick=\{onPrint\}[\s\S]{0,600}Drucken/);
console.log('check-v3-day-overview (Journal-Datum, Vorwoche, Knöpfe): OK');

