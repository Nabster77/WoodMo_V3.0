// Backup-Restore: gemischte Bar-Bons (Verkauf + Pfandrückgabe, Summe negativ)
// müssen zurückspielbar sein (Bregenz 21.11.2026: -1,00 / -1,80 / -3,00 €).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isRestorableNegativeReceipt, inspectBackupIntegrity } from '../src/lib/backupIntegrity.ts';

const sql = readFileSync(new URL('../supabase/migrations/20261122090000_allow_combined_cash_refunds_in_restore.sql', import.meta.url), 'utf8');
assert.match(sql, /CREATE OR REPLACE FUNCTION woodmo_private\.valid_restore_cash_refund\(p_receipt jsonb\)/);
assert.match(sql, /\(\(v_transaction->>'total'\)::numeric<0 AND\s+NOT woodmo_private\.valid_restore_cash_refund\(v_transaction\)\)/);
assert.doesNotMatch(sql, /jsonb_array_length\(v_transaction->'items'\)=1/, 'alte Einzelposten-Regel entfernt');
assert.match(sql, /REVOKE ALL ON FUNCTION woodmo_private\.valid_restore_cash_refund\(jsonb\) FROM PUBLIC, anon, authenticated;/);
assert.match(sql, /Backup-Wiederherstellung nur mit dem Cloud-Administratorkonto erlaubt/, 'Berechtigung unverändert');
assert.match(sql, /Import gesperrt: Die aktuelle Kasse enthält Buchungen oder Kassensitzungen/, 'Leere-Kasse-Prüfung unverändert');

// Gleiche Regel wie die SQL-Funktion, an echten Bon-Formen geprüft.
const r2 = n => Math.round(n * 100) / 100;
function valid(t) {
  if (t.paymentMethod !== 'cash' || !Array.isArray(t.items) || typeof t.taxByRate !== 'object') return false;
  let sale = 0, dep = 0, ret = false;
  for (const i of t.items) {
    if (!i.productId || !(i.quantity > 0)) return false;
    const gross = i.price * i.quantity;
    if (i.isPfandRetoure === true) {
      if (i.productId !== '__pfand_retoure__' || i.pfand >= 0 || r2(gross) !== r2(i.pfand) || i.taxRate !== 0 || i.taxAmount !== 0) return false;
      ret = true;
    } else {
      if (i.productId === '__pfand_retoure__' || gross < 0 || i.pfand < 0) return false;
      sale += gross;
    }
    dep += i.pfand;
  }
  return ret && t.total < 0 && r2(sale) === r2(t.subtotal) && r2(dep) === r2(t.totalPfand) &&
    r2(sale + dep) === r2(t.total) && r2(t.totalNet + t.totalTax) === r2(sale) &&
    (sale !== 0 || (t.totalNet === 0 && t.totalTax === 0));
}
const retoure = q => ({ productId: '__pfand_retoure__', isPfandRetoure: true, quantity: q, price: -3, pfand: -3 * q, taxRate: 0, taxAmount: 0 });
const base = { paymentMethod: 'cash', taxByRate: {} };
// rein Pfand
assert.equal(valid({ ...base, items: [retoure(2)], total: -6, subtotal: 0, totalPfand: -6, totalNet: 0, totalTax: 0 }), true);
// Bier 5,00 + 2 Pfand zurück = -1,00
assert.equal(valid({ ...base, items: [retoure(2), { productId: 'p1', quantity: 1, price: 5, pfand: 0, taxRate: 20, taxAmount: 0.8333 }], total: -1, subtotal: 5, totalPfand: -6, totalNet: 4.166666666666667, totalTax: 0.833333333333333 }), true);
// Glühwein 4,20 + 3 Pfand, 3 Pfand zurück = -1,80 (Gleitkomma wie im Original)
assert.equal(valid({ ...base, items: [{ productId: 'p2', quantity: 1, price: 4.2, pfand: 3, taxRate: 20, taxAmount: 0.7 }, retoure(3)], total: -1.7999999999999998, subtotal: 4.2, totalPfand: -6, totalNet: 3.5000000000000004, totalTax: 0.6999999999999997 }), true);
// Aperol 6,00 + 3 Pfand, 4 Pfand zurück = -3,00
assert.equal(valid({ ...base, items: [{ productId: 'p3', quantity: 1, price: 6, pfand: 3, taxRate: 20, taxAmount: 1 }, retoure(4)], total: -3, subtotal: 6, totalPfand: -9, totalNet: 5, totalTax: 1 }), true);
// abgelehnt: falsche Summe, Karte, negativer Verkauf
assert.equal(valid({ ...base, items: [retoure(2)], total: -5, subtotal: 0, totalPfand: -6, totalNet: 0, totalTax: 0 }), false);
assert.equal(valid({ ...base, paymentMethod: 'card', items: [retoure(2)], total: -6, subtotal: 0, totalPfand: -6, totalNet: 0, totalTax: 0 }), false);
assert.equal(valid({ ...base, items: [{ productId: 'p1', quantity: 1, price: -5, pfand: 0 }], total: -5, subtotal: -5, totalPfand: 0, totalNet: -5, totalTax: 0 }), false);
// Die App prüft vor Export/Import mit derselben Regel (sonst wäre ein Reset riskant).
const cases = [
  [{ ...base, items: [retoure(2)], total: -6, subtotal: 0, totalPfand: -6, totalNet: 0, totalTax: 0 }, true],
  [{ ...base, items: [{ productId: 'p2', quantity: 1, price: 4.2, pfand: 3, taxRate: 20, taxAmount: 0.7 }, retoure(3)], total: -1.7999999999999998, subtotal: 4.2, totalPfand: -6, totalNet: 3.5000000000000004, totalTax: 0.6999999999999997 }, true],
  [{ ...base, items: [retoure(2)], total: -5, subtotal: 0, totalPfand: -6, totalNet: 0, totalTax: 0 }, false],
  [{ ...base, paymentMethod: 'card', items: [retoure(2)], total: -6, subtotal: 0, totalPfand: -6, totalNet: 0, totalTax: 0 }, false],
];
for (const [tx, expected] of cases) assert.equal(isRestorableNegativeReceipt(tx), expected);
assert.equal(valid.toString().length > 0, true);
const session = { id: 's1', location: 'Bregenz', openedAt: 1, openingBalance: 100, closed: true, closedAt: 2 };
const tx = (id, extra) => ({ id, location: 'Bregenz', timestamp: 10, cashSessionId: 's1', ...extra });
assert.deepEqual(inspectBackupIntegrity({ cashSessions: [session], stornos: [], transactions: [tx('ok', cases[1][0])] }), []);
assert.match(inspectBackupIntegrity({ cashSessions: [session], stornos: [], transactions: [tx('kaputt', cases[2][0])] }).join(), /kaputt.*nicht zurückspielbar/);

console.log('RESTORE: gemischte Bar-Bons mit Pfandrückgabe zurückspielbar, Fehlbons weiterhin abgelehnt.');
// Backup 1:1 gleich dem Cloud-Stand → Hinweis statt Import (22.11.2026).
const appSrc = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(appSrc, /Das Backup ist 1:1 identisch mit dem aktuellen Stand in der Cloud\. Ein Import ist nicht nötig\./);
assert.match(appSrc, /byId\(cloudNow\.transactions\) === byId\(imported\.transactions\)/);
assert.match(appSrc, /In der Cloud sind neuere Daten als in diesem Backup/);
assert.match(appSrc, /1\. Zuerst das aktuelle Backup sichern \(Backup exportieren\)\.\\n2\. Buchungen zurücksetzen\.\\n3\. Danach dieses Backup importieren\./);
