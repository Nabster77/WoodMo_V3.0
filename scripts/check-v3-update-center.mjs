import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const vite = read('vite.config.ts');
const app = read('src/App.tsx');
const home = read('src/components/WoodmoHome.tsx');
const setup = read('src/components/DeviceSetupDialog.tsx');
const dialog = read('src/components/InitialSyncDialog.tsx');
const check = read('src/lib/startupDataCheck.ts');

assert.match(vite, /registerType: 'prompt'/);
assert.match(vite, /skipWaiting: false/);
assert.match(vite, /clientsClaim: false/);
assert.match(vite, /navigateFallback: `\$\{base\}index\.html`/);
assert.match(vite, /woodmo-update-approval-v1/);
assert.match(vite, /WOODMO_APPROVED_UPDATE/);
assert.match(app, /void publishedUpdate\(\)\.then/);
assert.match(app, /await preparePublishedUpdate\(candidate\)/);
assert.match(app, /const result = await syncNow\(true\)/);
assert.match(app, /await activatePublishedUpdate\(candidate\)/);
assert.match(dialog, /Jetzt updaten/);
assert.match(dialog, /Cloud-Synchronisierung erfolgreich/);
assert.match(dialog, /Bestätigen und App neu starten/);
assert.doesNotMatch(check, /setItem|saveJSON|flushOutbox|syncNow|upsert|\.clear\(/);
assert.match(home, /Kassen-App Version \{APP_VERSION\}/);
assert.match(vite, /fileName: 'version\.json'/);
assert.match(vite, /name: 'WOODMO Kassen-App Version 3\.0'/);

console.log('UPDATES: Hintergrundprüfung, bestätigte Aktivierung und Cloud-Abgleich geprüft.');
