import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Kassenkonflikt nur am selben Standort: Friedrichshafen und Bregenz dürfen gleichzeitig offen sein.
// Befund Testserver 17.11.2026: offene Kasse Bregenz wurde als Konflikt für eine Kasse Friedrichshafen gemeldet.
const outbox = readFileSync('src/lib/outbox.ts', 'utf8');
const block = outbox.slice(outbox.indexOf('const otherCloud ='), outbox.indexOf('if (otherCloud)'));
assert.match(block, /row\.id !== opening\.id && row\.location === opening\.location/);
assert.match(outbox, /\.in\('location', locations\)/);
console.log('OUTBOX: Kassenkonflikt nur bei offener Cloud-Kasse am selben Standort.');
