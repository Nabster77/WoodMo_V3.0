// Eröffnungsfenster: Standort mit offener Kasse → „weiterführen“, nie eine zweite Kasse (Wunsch 18.11.2026).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeSessionForLocation } from '../src/lib/cashSessionSelection.ts';

const open = { id: 'br', location: 'Bregenz', date: '2026-11-18', openedAt: 1, closed: false, openingBalance: 1480.4, entries: [], corrections: [] };
const closedFn = { id: 'fn', location: 'Friedrichshafen', date: '2026-11-17', openedAt: 1, closed: true, closedAt: 2, openingBalance: 100, entries: [], corrections: [] };
assert.equal(activeSessionForLocation([open, closedFn], 'Bregenz')?.id, 'br');
assert.equal(activeSessionForLocation([open, closedFn], 'Friedrichshafen'), null);

const dialog = readFileSync(new URL('../src/components/POS/CashOpeningDialog.tsx', import.meta.url), 'utf8');
assert.match(dialog, /const existingSession = \(location === \(defaultLocation \?\? 'Friedrichshafen'\) \? deviceSession : null\) \?\? openSessions\?\.\[location\] \?\? null;/, 'gewählter Standort entscheidet');
assert.match(dialog, /if \(continuesOtherLocation && onContinueAt\) \{[\s\S]{0,200}onContinueAt\(location\);\s*return;/, 'weiterführen ohne neue Kasse');
assert.match(dialog, /\{existingSession \? 'Kasse weiterführen' : 'Kasse eröffnen'\}/);
assert.match(dialog, /<fieldset disabled=\{!!deviceSession\}/, 'Standortwahl nur gesperrt, wenn am Gerätestandort schon eine Kasse läuft');
const pos = readFileSync(new URL('../src/components/POS/POSScreen.tsx', import.meta.url), 'utf8');
assert.match(pos, /openSessions=\{openSessionsByLocation\} onContinueAt=/);
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(app, /Bregenz: activeSessionForLocation\(store\.cashSessions, 'Bregenz'\)/);
assert.match(app, /function continueOpenSessionAt\(location: Location\)[\s\S]{0,400}store\.switchLocation\(location\);[\s\S]{0,300}type: 'login'/, 'Anmeldung wird in der weitergeführten Kasse vermerkt');
// Der Cloud-Schutz beim Eröffnen bleibt als zweite Sicherung bestehen.
assert.match(app, /ist bereits eine Kasse geöffnet\. Sie wird übernommen/);
console.log('check-v3-continue-location: OK');
