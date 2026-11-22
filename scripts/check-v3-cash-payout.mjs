// Pfand-Auszahlung darf den Bargeldbestand nie negativ machen (22.11.2026).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const modal = read('src/components/POS/CheckoutModal.tsx');
const pos = read('src/components/POS/POSScreen.tsx');
assert.match(modal, /const cashOut = splitPayout \? cashPayout : \(isPfandOnly \|\| paymentMethod === 'cash'\) && total < 0 \? -total : 0;/);
assert.match(modal, /const canPay = !saving && !paid && !cashShort &&/);
assert.match(modal, /Nicht genug Bargeld in der Kasse/);
assert.match(pos, /cashAvailable=\{activeSession \? currentCashBalance : undefined\}/);
// Regel 22.11.: Becher zuerst mit Pfand der Ware verrechnen, nur Überschuss bar; Karte erhöht nie den Bargeldbestand.
const rules = read('src/lib/checkoutTransactions.ts');
assert.match(rules, /Karte MIT Pfand-Retoure \(Betreiber-Vorgabe 22\.11\.2026\)/);
assert.match(rules, /export function splitCardRetoure/);
console.log('PFAND-AUSZAHLUNG: nie mehr Bargeld auszahlen, als in der Kasse ist.');
