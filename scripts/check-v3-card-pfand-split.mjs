// WOODMO V3: Kartenzahlung mit Pfand-Retoure.
// Regel ab 22.11.2026: zurückgegebene Becher werden zuerst mit dem Pfand der
// neuen Ware verrechnet (Karte), nur der Überschuss wird bar ausgezahlt
// (eigener Beleg „Pfandausgabe“, gemeinsame paymentSplitId). Prüft Rechnung, Kassenbestand, Unveränderlichkeit der
// bisherigen Fälle und die Backup-Wiederherstellung (isolierte PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { buildCheckoutTransactions, cardPfandCashPayout, checkoutTotals, isCardWithCashPfandPayout } from '../src/lib/checkoutTransactions.ts';
import { prepareCleanGenerationRestore } from '../src/lib/cleanGenerationRestore.ts';
import { inspectBackupIntegrity } from '../src/lib/backupIntegrity.ts';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('BESTANDEN:', name); }
const cents = (v) => Math.round(v * 100);
let serial = 0;
const makeId = () => { serial++; return 'tx-test-' + String(serial).padStart(4, '0'); };

const product = (id, name, price, pfand, taxClass = 'standard') => ({
  id, name, categoryId: 'cat-drinks', imageUrl: '', taxClass, available: true, sortOrder: 1,
  hasShot: false, prices: { Friedrichshafen: price, Bregenz: price }, pfand: { Friedrichshafen: pfand, Bregenz: pfand },
});
const line = (p, quantity) => ({ product: p, quantity, shot: null, unitPrice: p.prices.Bregenz, unitPfand: p.pfand.Bregenz });
const retoure = (amount, count) => ({
  product: { ...product('__pfand_retoure__', 'Pfand-Retoure', 0, 0, 'zero'), categoryId: '__pfand__' },
  quantity: count, shot: null, unitPrice: -(amount / count), unitPfand: 0, isPfandRetoure: true,
});
const gluehwein = product('p-gw', 'Glühwein Weiß', 4.5, 3);
// Kassenbestand-Formel wie src/lib/finalizedCashSession.ts (nur Barbelege zählen).
const cashEffect = (txs) => txs.filter((t) => t.paymentMethod === 'cash').reduce((s, t) => s + t.total, 0);
const cardEffect = (txs) => txs.filter((t) => t.paymentMethod === 'card').reduce((s, t) => s + t.total, 0);

// Fall aus dem Screenshot 14.11.: 2× Glühwein Weiß + 5× Pfand-Retoure, Bregenz (20 %).
const screenshot = [line(gluehwein, 2), retoure(15, 5)];

await test('01 Anzeige-Summen wie im Bezahldialog (Ware 9 €, Pfand 6 €, MwSt Ware 1,50 € − Pfand-Saldo 1,50 € = 0 €, Saldo 0 €)', () => {
  const t = checkoutTotals(screenshot, 'Bregenz');
  assert.equal(cents(t.subtotal), 900);
  assert.equal(cents(t.totalPfand), 600);
  assert.equal(cents(t.pfandRetoure), -1500);
  assert.equal(cents(t.total), 0);
  assert.equal(cents(t.goodsTotal), 1500);
  // Ab 17.11.2026 inkl. Pfand-USt: Ware +1,50 €, Pfand +1,00 €, Retoure −2,50 €.
  assert.equal(cents(t.totalTax), 150, 'USt der Ware unverändert');
  assert.equal(cents(t.pfandTax), -150);
  assert.deepEqual(t.taxLines.map((l) => [l.rate, cents(l.tax)]), [[20, 0]]);
});
await test('02 Karte + Pfand-Retoure ergibt zwei Belege mit gemeinsamer paymentSplitId', () => {
  assert.equal(isCardWithCashPfandPayout(screenshot, 'card'), true);
  const txs = buildCheckoutTransactions({ items: screenshot, location: 'Bregenz', paymentMethod: 'card', now: 1794672964000, makeId });
  assert.equal(txs.length, 2);
  const [card, payout] = txs;
  assert.equal(card.paymentMethod, 'card');
  assert.equal(card.paymentSplitRole, 'card-goods');
  assert.equal(payout.paymentMethod, 'cash');
  assert.equal(payout.paymentSplitRole, 'cash-pfand-payout');
  assert.ok(card.paymentSplitId && card.paymentSplitId === payout.paymentSplitId);
  assert.notEqual(card.id, payout.id);
  assert.ok(payout.timestamp > card.timestamp, 'Pfandausgabe nach dem Kartenbeleg');
});
await test('03 Kartenbeleg: Ware 9 € + Pfand 6 € − 2 verrechnete Becher 6 € = 9 €, MwSt Ware 1,50 €', () => {
  const [card] = buildCheckoutTransactions({ items: screenshot, location: 'Bregenz', paymentMethod: 'card', makeId });
  assert.equal(card.items.length, 2);
  assert.equal(card.items.filter((i) => i.isPfandRetoure)[0].quantity, 2);
  assert.equal(cents(card.total), 900);
  assert.equal(cents(card.subtotal), 900);
  assert.equal(cents(card.totalPfand), 0, 'Pfand-Saldo auf der Karte 0');
  assert.equal(cents(card.totalTax), 150);
  assert.equal(cents(card.taxByRate[20]), 150);
});
await test('04 Pfandausgabe bar nur für 3 übrige Becher: −9 €, Ware-MwSt 0, Pfand-USt −1,50 €', () => {
  const [, payout] = buildCheckoutTransactions({ items: screenshot, location: 'Bregenz', paymentMethod: 'card', makeId });
  assert.equal(cents(payout.total), -900);
  assert.equal(cents(payout.totalPfand), -900);
  assert.equal(payout.subtotal, 0);
  assert.equal(payout.totalTax, 0);
  assert.deepEqual(payout.taxByRate, {});
  assert.equal(payout.items.length, 1);
  assert.equal(payout.items[0].quantity, 3);
  assert.equal(cents(payout.pfandTaxByRate[20]), -150);
  assert.equal(cents(payout.pfandNet), -750);
});
await test('05 Kassenbestand sinkt nur um 9 €, Karte +9 €, Saldo unverändert 0 €', () => {
  const txs = buildCheckoutTransactions({ items: screenshot, location: 'Bregenz', paymentMethod: 'card', makeId });
  assert.equal(cents(cashEffect(txs)), -900);
  assert.equal(cents(cardEffect(txs)), 900);
  assert.equal(cents(txs.reduce((s, t) => s + t.total, 0)), 0);
  assert.equal(cents(cardPfandCashPayout(screenshot)), 900, 'Anzeige „Pfand bar auszahlen“');
});
await test('06 Retoure größer als Einkauf: Karte nie negativ, nur Rest bar ausgezahlt', () => {
  const items = [line(gluehwein, 1), retoure(15, 5)];
  const txs = buildCheckoutTransactions({ items, location: 'Bregenz', paymentMethod: 'card', makeId });
  assert.equal(cents(cardEffect(txs)), 450);
  assert.equal(cents(cashEffect(txs)), -1200);
  assert.ok(txs.every((t) => t.paymentMethod !== 'card' || t.total >= 0), 'keine negative Kartenbuchung');
});
await test('06b 1 Kaffee + 1 Becher zurück per Karte: nur Kaffeepreis, keine Barauszahlung', () => {
  const kaffee = product('p-k', 'Kaffee', 4, 3);
  const items = [line(kaffee, 1), retoure(3, 1)];
  assert.equal(isCardWithCashPfandPayout(items, 'card'), false, 'keine grüne Meldung');
  const txs = buildCheckoutTransactions({ items, location: 'Bregenz', paymentMethod: 'card', makeId });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].paymentMethod, 'card');
  assert.equal(txs[0].paymentSplitId, undefined);
  assert.equal(cents(txs[0].total), 400);
  assert.equal(cents(txs[0].totalPfand), 0);
  assert.equal(cents(cashEffect(txs)), 0, 'Karte berührt den Bargeldbestand nicht');
});
await test('06c 2 Kaffee per Karte ohne Rückgabe: Pfand mit Karte bezahlt, nichts in die Kasse', () => {
  const kaffee = product('p-k', 'Kaffee', 4, 3);
  const txs = buildCheckoutTransactions({ items: [line(kaffee, 2)], location: 'Bregenz', paymentMethod: 'card', makeId });
  assert.equal(txs.length, 1);
  assert.equal(cents(cardEffect(txs)), 1400);
  assert.equal(cents(cashEffect(txs)), 0);
});
await test('07 Unverändert: Karte ohne Retoure = ein Kartenbeleg', () => {
  const txs = buildCheckoutTransactions({ items: [line(gluehwein, 2)], location: 'Bregenz', paymentMethod: 'card', makeId });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].paymentMethod, 'card');
  assert.equal(txs[0].paymentSplitId, undefined);
  assert.equal(cents(txs[0].total), 1500);
});
await test('08 Unverändert: Bar mit Retoure = ein verrechneter Barbeleg', () => {
  assert.equal(isCardWithCashPfandPayout(screenshot, 'cash'), false);
  const txs = buildCheckoutTransactions({ items: screenshot, location: 'Bregenz', paymentMethod: 'cash', given: 0, makeId });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].paymentMethod, 'cash');
  assert.equal(cents(txs[0].total), 0);
  assert.equal(txs[0].items.length, 2);
});
await test('09 Unverändert: nur Pfand-Retoure = Pfandausgabe bar, auch wenn Karte gewählt war', () => {
  const txs = buildCheckoutTransactions({ items: [retoure(15, 5)], location: 'Bregenz', paymentMethod: 'card', makeId });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].paymentMethod, 'cash');
  assert.equal(cents(txs[0].total), -1500);
});
await test('10 Bezahldialog nutzt die gemeinsame Funktion, App speichert beide Belege in einem Schritt', () => {
  const modal = readFileSync('src/components/POS/CheckoutModal.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(modal, /buildCheckoutTransactions\(\{ items, location, paymentMethod, given \}\)/);
  assert.match(modal, /Pfand bar auszahlen/);
  assert.match(app, /await enqueueEntries\(booked\.map\(/, 'beide Belege in einer IndexedDB-Transaktion');
});

// Start: node scripts/run-card-pfand-split.mjs (löst @/-Pfade auf).
// Backup-Wiederherstellung muss geteilte Belege annehmen (Validierung aus 20261114080000).
const db = new PGlite();
const admin = '6dfda066-31a0-4a40-8f1b-b82d886487c3';
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT ''${admin}''::uuid';
    INSERT INTO auth.users VALUES ('${admin}','admin@kasse.local');
    CREATE TABLE public.pos_booking_resets(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,reset_at bigint);
    CREATE TABLE public.pos_transactions(id text PRIMARY KEY,location text,booking_generation bigint,timestamp bigint,data jsonb);
    CREATE TABLE public.pos_cash_sessions(id text PRIMARY KEY,location text,booking_generation bigint,date text,data jsonb);
    CREATE TABLE public.pos_staff_users(id uuid PRIMARY KEY,deleted boolean,data jsonb);
    INSERT INTO public.pos_booking_resets(id,reset_at) VALUES(1,1794600000000);
  `);
  for (const file of ['20261113115500_woodmo_v3_protected_storno.sql', '20261114034000_allow_archived_booking_reset.sql',
    '20261114050000_restore_clean_v3_backup.sql', '20261114080000_allow_valid_pfand_return_restore.sql',
    '20261114160000_restore_sessions_one_by_one.sql']) {
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  await test('11 Backup mit Karte + Pfandausgabe bar wird vollständig wiederhergestellt', async () => {
    const openedAt = 1794672000000;
    const txs = buildCheckoutTransactions({ items: screenshot, location: 'Bregenz', paymentMethod: 'card', now: openedAt + 60000, makeId })
      .map((t) => ({ ...t, cashSessionId: 'br-1', employeeId: '5bffe378-a2ec-4bf4-83aa-37d0145229f6', employeeName: 'SZ' }));
    const session = { id: 'br-1', location: 'Bregenz', date: '2026-11-14', openedAt, openingBalance: 100,
      closed: true, closedAt: openedAt + 120000, closingBalance: 91, entries: [], corrections: [],
      dailyCloseFinalizedAt: openedAt + 120000, dailyCloseSnapshot: { transactions: txs, stornos: [], finalizedAt: openedAt + 120000 } };
    const backup = { transactions: txs, cashSessions: [session], stornos: [] };
    assert.deepEqual(inspectBackupIntegrity(backup), []);
    const mapped = prepareCleanGenerationRestore(backup, () => crypto.randomUUID());
    await db.query('SELECT public.restore_pos_clean_backup_v3($1::jsonb,1,$2::timestamptz)',
      [JSON.stringify(mapped), '2026-11-14T16:30:00Z']);
    const { rows } = await db.query(`SELECT data->>'paymentMethod' pm, (data->>'total')::numeric total
      FROM public.pos_transactions WHERE booking_generation=1 ORDER BY timestamp`);
    assert.deepEqual(rows.map((r) => [r.pm, Number(r.total)]), [['card', 9], ['cash', -9]]);
  });
} finally {
  await db.close();
}
console.log(`WOODMO V3 KARTE + PFAND VERRECHNET, REST BAR: ${passed}/13 BESTANDEN.`);
