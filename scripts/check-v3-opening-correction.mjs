import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openingCorrectionView, signedAmountLabel } from '../src/lib/openingCorrection.ts';

// Bregenz 17.11.2026: übernommen 1.428,20, morgens auf 359,00 korrigiert.
const at = Date.parse('2026-11-17T06:32:41+01:00');
const session = { openingBalance: 359, corrections: [{ id: 'c', oldAmount: 1428.2, newAmount: 359, timestamp: at, employeeName: 'Moritz', reason: 'Hhu' }] };
const view = openingCorrectionView(session);
assert.equal(view.carriedBalance, 1428.2);
assert.equal(view.total, -1069.2);
assert.equal(view.lines.length, 1);
assert.equal(view.lines[0].employeeName, 'Moritz');
assert.equal(signedAmountLabel(-1069.2, (v) => v.toFixed(2)), '− 1069.20');
assert.equal(signedAmountLabel(5, (v) => v.toFixed(2)), '+ 5.00');
// Rechnung von oben nach unten: 1.428,20 − 1.069,20 = 359,00; + 1.122,40 bar − 1,00 Entnahme = 1.480,40.
assert.equal(Math.round((view.carriedBalance + view.total) * 100) / 100, 359);
assert.equal(Math.round((359 + 1122.4 - 1) * 100) / 100, 1480.4);

// Zwei Korrekturen: Übernahme = Bestand vor der ersten.
const two = openingCorrectionView({ openingBalance: 300, corrections: [
  { oldAmount: 350, newAmount: 300, timestamp: 2 }, { oldAmount: 400, newAmount: 350, timestamp: 1 }] });
assert.equal(two.carriedBalance, 400);
assert.equal(two.total, -100);
assert.deepEqual(two.lines.map((l) => l.amount), [-50, -50]);
assert.equal(openingCorrectionView({ openingBalance: 100, corrections: [] }), null);

// Überall angezeigt: Tagesabschluss (Bildschirm + Druck), PDF, Tagesinfo.
const close = readFileSync(new URL('../src/components/POS/DailyCloseDialog.tsx', import.meta.url), 'utf8');
const pdf = readFileSync(new URL('../src/lib/journalPdf.ts', import.meta.url), 'utf8');
const report = readFileSync(new URL('../src/lib/dailyReport.ts', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/components/Admin/AdminScreen.tsx', import.meta.url), 'utf8');
for (const [name, src] of [['Tagesabschluss', close], ['PDF', pdf], ['Tagesinfo', admin]]) {
  assert.ok(/Übernommen vom Vortag/.test(src), `${name}: Übernahme fehlt`);
  assert.ok(/Korrektur Anfangsbestand/.test(src), `${name}: Korrekturzeile fehlt`);
  assert.ok(/nfangsbestand \(Ist\)/.test(src), `${name}: Ist-Anfangsbestand fehlt`);
}
assert.ok(!/Korrekturen am Anfangsbestand \(bereits enthalten\)/.test(close + pdf), "alte verwirrende Zeile entfernt");
assert.match(report, /openingCorrections: openingCorrectionView\(session\)\?\.lines/);
console.log('check-v3-opening-correction: OK');
