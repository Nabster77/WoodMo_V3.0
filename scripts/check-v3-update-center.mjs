// Update-Zentrale: Zugang nur für Administratoren, Update-Weg unverändert,
// Prüfliste vor dem Update und Prüfbericht danach. Keine Kassendaten werden verändert.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fingerprint, sameFingerprint, sameBuild, buildLabel } from '../src/lib/updateCenter.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const vite = read('vite.config.ts');
const center = read('src/components/UpdateCenter.tsx');
const lib = read('src/lib/updateCenter.ts');
const home = read('src/components/WoodmoHome.tsx');
const app = read('src/App.tsx');

// Bewährter Update-Weg bleibt: automatisch, skipWaiting, version.json NICHT im Offline-Speicher.
assert.match(vite, /registerType: 'autoUpdate'/);
assert.match(vite, /skipWaiting: true/);
assert.match(vite, /globPatterns: \['\*\*\/\*\.\{js,css,html,ico,png,svg,webp,woff,woff2\}'\]/, 'version.json darf nicht vorab gespeichert werden');
assert.match(vite, /fileName: 'version\.json'/);
assert.match(vite, /__WOODMO_BUILD__: JSON\.stringify\(WOODMO_BUILD\)/);
assert.match(lib, /version\.json\?t=\$\{Date\.now\(\)\}`, \{ cache: 'no-store'/, 'Online-Version am Zwischenspeicher vorbei lesen');

// Zugang: kleiner Knopf auf der Startseite, nur persönliches Administrator-Passwort.
assert.match(home, /onUpdateCenter && \(/);
assert.match(home, /aria-label="Update-Zentrale \(nur Administrator\)"/);
assert.match(center, /allowManagerPassword=\{false\}/);
assert.match(center, /user\.active && user\.role === 'administrator'/);
assert.match(center, /if \(administrator\) setUnlocked\(true\)/);

// Prüfliste: Internet, alles übertragen, keine Kasse offen sind Pflicht; Backup/Speicherort Hinweis.
assert.match(center, /required: true, state: online \? 'ok' : 'fail', title: 'Internet verbunden'/);
assert.match(center, /title: 'Alle Buchungen übertragen'/);
assert.match(center, /required: true, state: sessionOpen \? 'fail' : 'ok', title: 'Keine Kasse offen auf diesem Gerät'/);
assert.match(center, /required: false, state: backupToday/);
assert.match(center, /title: 'Speicherort für PDFs'/);
assert.match(center, /const blocked = checks\.some\(\(check\) => check\.required && check\.state !== 'ok'\)/);
assert.match(center, /disabled=\{blocked \|\| onlineBuild === 'wait'\}/);

// Abbruch: alte Version bleibt, Hinweis, kein Vorher-Stand bleibt hängen.
assert.match(lib, /worker\.state === 'redundant'/);
assert.match(center, /clearUpdateCheck\(\);\s*setStep\(null\);/);
assert.match(center, /Die bisherige Version läuft unverändert weiter\. Daten sind nicht betroffen\./);

// Prüfbericht nach Neustart; Backup-Zeitpunkt wird nur gemerkt (nie blockierend).
assert.match(app, /const \[updateReport, setUpdateReport\] = useState\(\(\) => readUpdateCheck\(\)\)/);
assert.match(app, /markBackupExported\(\);\s*if \(backupTarget\.mode === 'folder'\)/);
assert.doesNotMatch(lib + center, /from\('pos_|\.insert\(|\.upsert\(|\.delete\(|rpc\(/, 'Update-Zentrale schreibt nie in die Cloud');

// Rechenkern des Prüfberichts.
const tx = [{ total: 4.2 }, { total: 14.4 }, { total: 0.1 }];
const sessions = [{ closed: true }, { closed: false }];
const fp = fingerprint(tx, sessions);
assert.deepEqual(fp, { receipts: 3, sessions: 2, closedSessions: 1, totalCents: 1870 });
assert.equal(sameFingerprint(fp, { ...fp }), true);
assert.equal(sameFingerprint(fp, { ...fp, receipts: 2 }), false);
const a = { commit: 'abc1234', builtAt: '2026-11-17T22:00:00.000Z', title: '', notes: [] };
assert.equal(sameBuild(a, { ...a }), true);
assert.equal(sameBuild(a, { ...a, builtAt: '2026-11-17T22:05:00.000Z' }), false);
assert.equal(buildLabel(a), '17.11.2026, 23:00 Uhr · abc1234');

// Automatischer Wechsel ohne Zutun am Tablet: nach dem Update lädt die offene App einmal selbst neu,
// nur bei einem echten Update (vorher aktive Version), nie beim ersten Installieren.
const reloadSw = read('public/sw-reload.js');
assert.match(vite, /importScripts: \['sw-reload\.js'\]/);
assert.match(reloadSw, /woodmoIsUpdate = Boolean\(self\.registration && self\.registration\.active\)/);
assert.match(reloadSw, /if \(!woodmoIsUpdate\) return;/);
assert.match(reloadSw, /await self\.clients\.claim\(\);[\s\S]*client\.navigate\(client\.url\)/);
console.log('V3-UPDATE-ZENTRALE: Admin-Zugang, unveränderter Update-Weg, Prüfliste, Abbruch und Prüfbericht geprüft.');
