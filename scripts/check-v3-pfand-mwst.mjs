// WOODMO V3: Umsatzsteuer auf Pfand (ab 17.11.2026).
// Regel: Pfand teilt den Steuersatz des Getränks; Pfand-Retoure ist eine
// Entgeltminderung mit dem Normalsatz des Standorts. Gespeichert in eigenen
// Feldern (pfandTaxByRate/pfandNet), damit ältere Bons und die DB-Prüfung für
// reine Pfandausgaben (taxByRate = {}, totalTax = 0) unverändert gültig bleiben.
// Start: node scripts/run-pfand-mwst.mjs (löst @/-Pfade auf).
import assert from 'node:assert/strict';
import { buildCheckoutTransactions, checkoutTotals } from '../src/lib/checkoutTransactions.ts';
import { getTaxByRate, mergeTaxByRate, transactionNet, transactionTax, transactionPfandTax, pfandReturnTaxRate } from '../src/lib/tax.ts';
import { projectFinancialTransactions } from '../src/lib/stornoReportProjection.ts';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('BESTANDEN:', name); }
const cents = (v) => Math.round(v * 100);
let serial = 0;
const makeId = () => { serial++; return 'tx-pfand-' + String(serial).padStart(4, '0'); };
const product = (id, name, price, pfand, taxRates) => ({
  id, name, categoryId: 'cat-drinks', imageUrl: '', taxClass: 'standard', available: true, sortOrder: 1,
  hasShot: false, prices: { Friedrichshafen: price, Bregenz: price }, pfand: { Friedrichshafen: pfand, Bregenz: pfand },
  ...(taxRates ? { taxRates } : {}),
});
const line = (p, quantity, loc = 'Bregenz') => ({ product: p, quantity, shot: null, unitPrice: p.prices[loc], unitPfand: p.pfand[loc] });
const retoure = (amount, count) => ({
  product: { ...product('__pfand_retoure__', 'Pfand-Retoure', 0, 0), taxClass: 'zero', categoryId: '__pfand__' },
  quantity: count, shot: null, unitPrice: -(amount / count), unitPfand: 0, isPfandRetoure: true,
});
const gluehwein = product('p-gw', 'Glühwein Rot', 4.2, 3);
const schoko = product('p-zs', 'Zirbenschokolade', 6, 0, { Friedrichshafen: 7, Bregenz: 10 });
const rates = (map) => Object.fromEntries([...map.entries()].sort((a, b) => a[0] - b[0]).map(([r, v]) => [r, cents(v)]));
const balanced = (t) => cents(t.total) === cents(transactionNet(t) + transactionTax(t));

test('01 Bregenz: 2 Glühwein + 6 € Pfand → USt 1,40 € Ware + 1,00 € Pfand', () => {
  const [t] = buildCheckoutTransactions({ items: [line(gluehwein, 2)], location: 'Bregenz', paymentMethod: 'cash', given: 20, makeId });
  assert.equal(cents(t.total), 1440);
  assert.deepEqual(rates(new Map(Object.entries(t.taxByRate).map(([r, v]) => [Number(r), v]))), { 20: 140 }, 'Ware unverändert');
  assert.equal(cents(t.totalTax), 140);
  assert.deepEqual(Object.keys(t.pfandTaxByRate), ['20']);
  assert.equal(cents(t.pfandTaxByRate[20]), 100);
});
test('01b Werte gerundet: Pfand netto 5,00 €, USt 1,00 €; Bon = Netto + USt', () => {
  const [t] = buildCheckoutTransactions({ items: [line(gluehwein, 2)], location: 'Bregenz', paymentMethod: 'cash', given: 20, makeId });
  assert.equal(cents(t.pfandNet), 500);
  assert.equal(cents(transactionPfandTax(t)), 100);
  assert.deepEqual(rates(getTaxByRate(t)), { 20: 240 });
  assert.equal(cents(transactionNet(t)), 1200);
  assert.ok(balanced(t));
  assert.equal(t.items[0].pfandTaxRate, 20);
  assert.equal(cents(t.items[0].pfandTax), 100);
});
test('02 Bar mit Retoure: Pfand-Saldo −3 € → USt −0,50 €; Bon 1,20 € = Netto 1,00 € + USt 0,20 €', () => {
  const [t] = buildCheckoutTransactions({ items: [line(gluehwein, 1), retoure(6, 2)], location: 'Bregenz', paymentMethod: 'cash', given: 1.2, makeId });
  assert.equal(cents(t.total), 120);
  assert.deepEqual(rates(getTaxByRate(t)), { 20: 20 });
  assert.equal(cents(transactionNet(t)), 100);
  assert.ok(balanced(t));
  const ret = t.items.find((i) => i.isPfandRetoure);
  assert.equal(ret.taxRate, 0, 'Retoure-Zeile bleibt steuerfrei als Ware');
  assert.equal(ret.pfandTaxRate, 20);
  assert.equal(cents(ret.pfandTax), -100);
});
test('03 Karte + Pfandausgabe bar: Kartenbeleg Pfand-USt +1,00 €, Pfandausgabe −2,50 €; DB-Felder der Pfandausgabe bleiben 0', () => {
  const [card, payout] = buildCheckoutTransactions({ items: [line(gluehwein, 2), retoure(15, 5)], location: 'Bregenz', paymentMethod: 'card', makeId });
  assert.equal(cents(transactionPfandTax(card)), 100);
  assert.equal(cents(transactionPfandTax(payout)), -250);
  assert.equal(cents(payout.pfandNet), -1250);
  assert.deepEqual(payout.taxByRate, {});
  assert.equal(payout.totalTax, 0);
  assert.equal(payout.totalNet, 0);
  assert.equal(payout.subtotal, 0);
  assert.equal(payout.items[0].taxRate, 0);
  assert.equal(payout.items[0].taxAmount, 0);
  assert.ok(balanced(card) && balanced(payout));
});
test('04 Friedrichshafen: Pfand mit 19 %, reine Retoure ebenfalls 19 %', () => {
  assert.equal(pfandReturnTaxRate('Friedrichshafen'), 19);
  assert.equal(pfandReturnTaxRate('Bregenz'), 20);
  const [t] = buildCheckoutTransactions({ items: [line(gluehwein, 1, 'Friedrichshafen')], location: 'Friedrichshafen', paymentMethod: 'cash', given: 7.2, makeId });
  assert.deepEqual(Object.keys(t.pfandTaxByRate), ['19']);
  assert.equal(cents(transactionPfandTax(t)), 48);
  const [r] = buildCheckoutTransactions({ items: [retoure(3, 1)], location: 'Friedrichshafen', paymentMethod: 'cash', makeId });
  assert.deepEqual(Object.keys(r.pfandTaxByRate), ['19']);
  assert.equal(cents(transactionPfandTax(r)), -48);
  assert.ok(balanced(t) && balanced(r));
});
test('05 Artikel ohne Pfand (10 %): keine Pfand-USt, Ware wie bisher', () => {
  const [t] = buildCheckoutTransactions({ items: [line(schoko, 1)], location: 'Bregenz', paymentMethod: 'card', makeId });
  assert.deepEqual(t.pfandTaxByRate, {});
  assert.equal(t.pfandNet, 0);
  assert.equal(t.items[0].pfandTaxRate, undefined);
  assert.deepEqual(rates(getTaxByRate(t)), { 10: 55 });
  assert.ok(balanced(t));
});
test('06 Anzeige im Bezahldialog = gebuchte Werte (MwSt je Satz inkl. Pfand)', () => {
  const items = [line(gluehwein, 2), line(schoko, 1), retoure(3, 1)];
  const totals = checkoutTotals(items, 'Bregenz');
  for (const method of ['cash', 'card']) {
    const txs = buildCheckoutTransactions({ items, location: 'Bregenz', paymentMethod: method, given: 30, makeId });
    assert.deepEqual(totals.taxLines.map((l) => [l.rate, cents(l.tax)]),
      [...mergeTaxByRate(txs).entries()].sort((a, b) => a[0] - b[0]).map(([r, v]) => [r, cents(v)]), method);
  }
});
test('07 Storno kehrt Ware UND Pfand-USt exakt um (Summe 0)', () => {
  const [t] = buildCheckoutTransactions({ items: [line(gluehwein, 3), retoure(3, 1)], location: 'Bregenz', paymentMethod: 'cash', given: 20, now: 1000, makeId });
  const storno = { id: 's-1', originalTransactionId: t.id, cashSessionId: 'x', location: 'Bregenz', timestamp: 2000,
    employeeId: 'e', employeeName: 'E', reason: 'Test', paymentMethod: 'cash', grossAmount: t.total, cashEffect: -t.total, cardEffect: 0,
    originalSnapshot: t };
  const all = projectFinancialTransactions([t], [storno], 0, 5000);
  assert.equal(all.length, 2);
  assert.deepEqual(rates(mergeTaxByRate(all)), { 20: 0 });
  assert.equal(cents(all.reduce((s, x) => s + transactionNet(x), 0)), 0);
  assert.equal(cents(all.reduce((s, x) => s + transactionPfandTax(x), 0)), 0);
});
test('08 Ältere Bons ohne Pfand-Felder: Berichte unverändert (Korrekturblatt nötig)', () => {
  const old = { id: 'old', timestamp: 1, items: [], subtotal: 8.4, taxByRate: { 20: 1.4 }, totalNet: 7, totalTax: 1.4,
    totalPfand: 6, total: 14.4, paymentMethod: 'cash', location: 'Bregenz' };
  assert.deepEqual(rates(getTaxByRate(old)), { 20: 140 });
  assert.equal(cents(transactionNet(old)), 700);
  assert.equal(transactionPfandTax(old), 0);
});
test('09 Viele zufällige Bons: Bon-Betrag = Netto + USt (auf den Cent), Pfand-Saldo × Satz', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 2000; i++) {
    const loc = rnd(2) ? 'Bregenz' : 'Friedrichshafen';
    const items = [];
    if (rnd(4)) items.push(line(gluehwein, 1 + rnd(6), loc));
    if (rnd(3) === 0) items.push(line(schoko, 1 + rnd(3), loc));
    if (rnd(3) === 0) { const c = 1 + rnd(8); items.push(retoure(3 * c, c)); }
    if (!items.length) continue;
    const method = rnd(2) ? 'cash' : 'card';
    const txs = buildCheckoutTransactions({ items, location: loc, paymentMethod: method, given: 0, makeId });
    for (const t of txs) assert.ok(balanced(t), `Bon ${t.id} nicht ausgeglichen`);
    const saldo = txs.reduce((s, t) => s + t.items.reduce((a, it) => a + it.pfand, 0), 0);
    const rate = loc === 'Bregenz' ? 20 : 19;
    assert.equal(cents(txs.reduce((s, t) => s + transactionPfandTax(t), 0)), cents(saldo - saldo / (1 + rate / 100)));
  }
});
console.log(`WOODMO V3 PFAND-UMSATZSTEUER: ${passed}/10 BESTANDEN.`);
