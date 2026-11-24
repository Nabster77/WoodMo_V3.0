import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canClearResetQuarantine, isStaleOutboxEntry, summarizeResetQuarantine } from '../src/lib/resetQuarantine.ts';

let passed=0;
const check=(label,fn)=>{fn();passed++;console.log('BESTANDEN: '+label);};
const row=(id,table,gen)=>({table,row:{id,booking_generation:gen,location:'Friedrichshafen',data:{id}}});
const entries=[row('old-sale','pos_transactions',1),row('recent-sale','pos_transactions',2),
  row('old-open','pos_cash_sessions',1),row('legacy-sale','pos_transactions',undefined)];
check('01 Alte Offline-Bons werden als Archivkandidaten erkannt',()=>{
  assert.equal(isStaleOutboxEntry(entries[0],3),true);
  assert.equal(isStaleOutboxEntry(entries[1],3),true);
});
check('02 Offline-Kasse bleibt als Archivkandidat erhalten',()=>{
  assert.equal(isStaleOutboxEntry(entries[2],3),true);
});
check('03 Altbeleg ohne Generation wird NICHT still gelöscht',()=>{
  assert.equal(isStaleOutboxEntry(entries[3],3),true);
});
check('04 Gültige aktuelle Generation bleibt in Uploadwarteschlange',()=>{
  assert.equal(isStaleOutboxEntry(row('new','pos_transactions',3),3),false);
});
check('05 Keine Umsortierung auf Grund abweichender Geräteuhr',()=>{
  assert.equal(isStaleOutboxEntry({...entries[0],row:{...entries[0].row,timestamp:1e15}},3),true);
});
check('06 Reset-Snapshot erhält auch lokale Einträge ohne Outboxbeleg',()=>{
  const records=[
    {key:'outbox:1',archivedAt:1,targetGeneration:3,kind:'pending-outbox',entry:entries[0]},
    {key:'outbox:2',archivedAt:1,targetGeneration:3,kind:'pending-outbox',entry:entries[0]},
    {key:'outbox:3',archivedAt:1,targetGeneration:3,kind:'pending-outbox',entry:entries[2]},
    {key:'snapshot:generation-3',archivedAt:1,targetGeneration:3,kind:'local-snapshot',
      transactions:[{id:'only-local'},{id:'old-sale'}],cashSessions:[{id:'old-open'}]},
  ];
  const info=summarizeResetQuarantine(records);
  assert.deepEqual(info,{pendingReceipts:1,pendingSessions:1,localSnapshots:1,localReceipts:2,archivedEntries:4});
});
check('07 Ohne Quarantäne keine falsche Buchungswarnung',()=>{
  assert.deepEqual(summarizeResetQuarantine([]),
    {pendingReceipts:0,pendingSessions:0,localSnapshots:0,localReceipts:0,archivedEntries:0});
});
const snapshot=(gen)=>({key:'snapshot:generation-'+gen,archivedAt:1,targetGeneration:gen,kind:'local-snapshot',
  transactions:[{id:'t'+gen}],cashSessions:[{id:'s'+gen}]});
const pending={key:'outbox:9',archivedAt:1,targetGeneration:8,kind:'pending-outbox',entry:entries[0]};
check('08 Löschen erlaubt: nur Altstände, genau diese vorher gesichert',()=>{
  const records=[snapshot(7),snapshot(8)];
  assert.deepEqual(canClearResetQuarantine(records,['snapshot:generation-7','snapshot:generation-8']),{ok:true});
});
check('09 Löschen gesperrt ohne vorheriges Sichern',()=>{
  assert.equal(canClearResetQuarantine([snapshot(7)],null).ok,false);
});
check('10 Löschen gesperrt bei nicht übertragenen Bons (evtl. einzige Kopie)',()=>{
  const verdict=canClearResetQuarantine([snapshot(7),pending],['snapshot:generation-7','outbox:9']);
  assert.equal(verdict.ok,false);
  assert.match(verdict.reason,/nicht übertragene/);
});
check('11 Löschen gesperrt, wenn seit dem Sichern ein neuer Altstand dazukam',()=>{
  assert.equal(canClearResetQuarantine([snapshot(7),snapshot(8)],['snapshot:generation-7']).ok,false);
});
check('12 Leere Quarantäne: nichts zu löschen',()=>{
  assert.equal(canClearResetQuarantine([],[]).ok,false);
});
check('13 Löschen berührt nur den Quarantäne-Speicher, nie die Upload-Warteschlange',()=>{
  const outbox=readFileSync('src/lib/outbox.ts','utf8');
  const fn=outbox.slice(outbox.indexOf('export async function clearResetQuarantine'));
  const body=fn.slice(0,fn.indexOf('\n}\n'));
  assert.match(body,/db\.transaction\(QUARANTINE_STORE, 'readwrite'\)/);
  assert.doesNotMatch(body,/\bSTORE\b(?!_)/,'outbox store must not be opened');
  assert.match(body,/canClearResetQuarantine\(entries, exportedKeys\)/,'rule re-checked inside the delete transaction');
});
check('14 Bezahlen: kein Extra-Fenster, Warenkorb wird sofort geleert, keine Doppelbuchung',()=>{
  const modal=readFileSync('src/components/POS/CheckoutModal.tsx','utf8');
  const pos=readFileSync('src/components/POS/POSScreen.tsx','utf8');
  assert.doesNotMatch(modal,/Weiter kassieren|Buchung lokal gesichert/);
  assert.match(modal,/if \(saving \|\| paid\) return;/);
  assert.match(modal,/const result = await onComplete\(transactions\);[\s\S]*setPaid\(true\);[\s\S]*onPaid\(result(?:, paidHint)?\);/,
    'onPaid only after the booking was saved');
  const finish=pos.slice(pos.indexOf('function finishCheckout'));
  assert.match(finish.slice(0,finish.indexOf('\n  }\n')),/setShowCheckout\(false\);\s*setCart\(\[\]\);/);
  assert.match(pos,/onPaid=\{finishCheckout\}/);
  assert.match(modal,/Rückgeld/,'change still shown before booking');
  assert.match(modal,/Pfand bar auszahlen/,'cash Pfand payout still shown before booking');
  // 16.11.2026: one tap books, no extra "Verkauf buchen?" question; short fading success hint.
  assert.doesNotMatch(modal,/Verkauf buchen\?|confirmBooking/,'no second confirmation window');
  assert.match(modal,/Bezahlen abschließen & buchen/);
  assert.match(modal,/onClick=\{\(\) => void handleConfirm\(\)\}/,'green button books directly');
  assert.match(pos,/Zahlung erfolgreich/);
  assert.match(pos,/pointer-events-none fixed left-1\/2 top-1\/2/,'success hint centered, never blocks the next tap');
});
console.log('WOODMO V3 OFFLINE-RESET-QUARANTÄNE: '+passed+'/'+passed+' VERHALTENSTESTS BESTANDEN.');

// 24.11.: Überholter offener Kassenstand (Cloud hat die Kasse schon abgeschlossen)
// zählt nicht als „nicht übertragen“ und blockiert das Löschen nach dem Sichern nicht.
{
  const superseded = { key: 'superseded:1', archivedAt: 1, targetGeneration: 8, kind: 'superseded-session',
    entry: { table: 'pos_cash_sessions', row: { id: 'session-alt', booking_generation: 8, location: 'Bregenz', data: { closed: false } } } };
  const info = summarizeResetQuarantine([superseded]);
  assert.equal(info.pendingSessions, 0);
  assert.equal(info.pendingReceipts, 0);
  assert.deepEqual(canClearResetQuarantine([superseded], ['superseded:1']), { ok: true });
  assert.equal(canClearResetQuarantine([superseded], null).ok, false);
  console.log('WOODMO V3 ÜBERHOLTE KASSENSTÄNDE: Archiv ohne Warnhinweis geprüft.');
}
