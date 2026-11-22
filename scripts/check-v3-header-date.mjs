import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { headerDateLong, headerDateShort, headerTime } from '../src/lib/headerDate.ts';

const pos = readFileSync('src/components/POS/POSScreen.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const ts = Date.parse('2026-11-14T12:00:00Z');
assert.equal(headerDateLong(ts), 'Samstag, 14. November 2026');
assert.equal(headerDateShort(ts), '14.11.2026');
assert.equal(headerDateLong(Date.parse('2027-01-01T10:00:00Z')), 'Freitag, 1. Januar 2027');
assert.equal(headerDateShort(Date.parse('2026-12-31T23:30:00Z')), '01.01.2027',
  'Date follows Berlin civil time at midnight; the active till does not close');
assert(app.includes('window.setInterval(update, 10_000)') &&
  app.includes("document.addEventListener('visibilitychange', update)"),
  'Header date refreshes while a cash session remains open');
assert(app.includes("{tab === 'pos' && (") && !pos.includes('formatDateLong(activeSession.openedAt)'),
  'Header is current-date display, not the old cash opening date');
assert(/min-\[\d+px\]:inline/.test(app) && app.includes('min-[1100px]:absolute') && !/navigator\.userAgent|isTablet/.test(app),
  'Responsiveness uses available viewport width, not device identity');
assert.equal(headerTime(Date.parse('2026-11-17T00:12:00Z')), '01:12');
assert(app.includes('{headerTime(headerNow)}'), 'Uhrzeit in der Kopfzeile');
console.log('V3-HEADER: Uhrzeit, langes Datum, kurzes Datum, Jahreswechsel, Tageswechsel und adaptive Anzeige geprüft.');
