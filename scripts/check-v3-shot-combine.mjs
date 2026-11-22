import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyShotChoice, shotParts, shotSummary, NO_SHOT_ID, REMOVE_ALL_SHOTS_ID } from '../src/lib/shotCombine.ts';

// Mehrere Schüsse in einem Getränk (Wunsch 18.11.2026).
const rum = { id: 'rum', name: 'Rum', price: 2.5 };
const whiskey = { id: 'whiskey', name: 'Whiskey', price: 2.5 };
const none = { id: NO_SHOT_ID, name: 'Ohne Schuss', price: 0 };
const removeAll = { id: REMOVE_ALL_SHOTS_ID, name: 'Alle Schüsse entfernen', price: 0 };

// „Ohne Schuss“: nichts hinzufügen, nichts berechnen.
assert.equal(applyShotChoice(null, none), null);
const one = applyShotChoice(null, rum);
assert.deepEqual(one, { id: 'rum', name: 'Rum', price: 2.5 });
assert.equal(applyShotChoice(one, none), one, 'Ohne Schuss ändert vorhandene Schüsse nicht');

// Zweiter Schuss kommt dazu.
const two = applyShotChoice(one, whiskey);
assert.deepEqual(two, { id: 'rum+whiskey', name: 'Rum + Whiskey', price: 5 });
assert.deepEqual(shotParts(two), ['Rum', 'Whiskey']);
const three = applyShotChoice(two, rum);
assert.equal(three.name, '2× Rum + Whiskey', 'Sorte und Anzahl auf Bon/Journal');
assert.deepEqual(shotParts(three), ['Rum', 'Rum', 'Whiskey']);
assert.deepEqual(shotParts({ id: 'x', name: 'Rum + Rum', price: 5 }), ['Rum', 'Rum'], 'alte Bons lesbar');
assert.deepEqual(shotSummary(one, 3), { total: 3, label: 'Rum' }, 'Warenkorb: + 3× Schuss Rum');
assert.deepEqual(shotSummary(two, 2), { total: 4, label: '2× Rum, 2× Whiskey' });
assert.equal(shotSummary(null, 3), null);
assert.equal(three.price, 7.5);

// Alle entfernen.
assert.equal(applyShotChoice(three, removeAll), null);
assert.deepEqual(shotParts(null), []);
assert.deepEqual(shotParts(none), []);

// Rechnung: Glühwein 4,20 + Rum 2,50 + Whiskey 2,50 = 9,20 (+ Pfand separat).
assert.equal(Math.round((4.2 + two.price) * 100) / 100, 9.2);

// Bon-Text und Speicherung bleiben im bisherigen Format (kein neues Feld, keine SQL-Änderung).
const checkout = readFileSync(new URL('../src/lib/checkoutTransactions.ts', import.meta.url), 'utf8');
assert.match(checkout, /`\$\{item\.product\.name\} \+ \$\{item\.shot\.name\}`/, 'Bon: „Glühwein + Rum + Whiskey“');
const pos = readFileSync(new URL('../src/components/POS/POSScreen.tsx', import.meta.url), 'utf8');
assert.match(pos, /const nextShot = applyShotChoice\(item\.shot, shot\);/);
assert.match(pos, /current=\{shotCartIndex !== null \? cart\[shotCartIndex\]\?\.shot \?\? null : null\}/);
const dialog = readFileSync(new URL('../src/components/POS/ShotSelectionDialog.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(dialog, /Ohne Schuss|Kein weiterer Schuss/, '„Ohne Schuss“ entfernt');
assert.match(dialog, /Schussauswahl \{location\}/);
assert.match(dialog, /Alle Schüsse entfernen/);
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
assert.match(types, /shotName\?: string;/, 'Bon-Feld unverändert');
const row = readFileSync(new URL('../src/components/POS/CartItemRow.tsx', import.meta.url), 'utf8');
assert.match(row, />\+ Pfand</, 'Warenkorb: kurz „+ Pfand“');
assert.match(row, /\+ \{shots\.total\}× Schuss \{shots\.label\}/, 'Warenkorb: „+ 3× Schuss Rum“');
const journal = readFileSync(new URL('../src/lib/journalPdf.ts', import.meta.url), 'utf8');
assert.match(journal, /`\$\{item\.productId\}-\$\{item\.price\}-\$\{item\.name\}`/, 'Journal: Schusssorten nicht zusammengelegt');
console.log('check-v3-shot-combine: OK');
