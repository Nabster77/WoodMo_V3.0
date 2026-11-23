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
assert.match(dialog, /Jetzt installieren/);
assert.match(dialog, /Cloud-Synchronisierung erfolgreich/);
assert.match(dialog, /Bestätigen und App neu starten/);
assert.doesNotMatch(check, /setItem|saveJSON|flushOutbox|syncNow|upsert|\.clear\(/);
assert.match(home, /Kassen-App Version \{APP_VERSION\}/);
assert.match(vite, /fileName: 'version\.json'/);
assert.match(vite, /name: 'WOODMO Kassen-App Version 3\.0'/);

// Live tablets on 3.33 have no approval step: the first switch must still install and reload once.
assert.match(vite, /woodmoGuardMarker/);
assert.match(vite, /if \(!await caches\.match\(woodmoGuardMarker[\s\S]*?woodmoLegacySwitch = true;\s*await self\.skipWaiting\(\);/);
assert.match(vite, /cache\.put\(woodmoGuardMarker[\s\S]*?if \(!woodmoLegacySwitch\) return;[\s\S]*?client\.navigate\(client\.url\)/);
assert.doesNotMatch(read('src/releaseNotes.json'), /"version"/, 'Versionsnummer kommt aus der PR-Nummer (3.<PR>)');

console.log('UPDATES: Hintergrundprüfung, bestätigte Aktivierung und Cloud-Abgleich geprüft.');
// Gespeicherter Ordner wird verwendet (23.11.); nur ohne/fehlenden Ordner kommt die Abfrage.
assert.match(app, /if \(readDeviceSetup\(\)\?\.archiveMode === 'folder' && await archiveFolderStatus\(\) !== 'missing'\)/);
assert.match(read('src/components/DeviceSetupDialog.tsx'), /\{selection \? 'Bestätigen' : 'Ordner wählen'\}/, 'eine Schaltfläche: Ordner wählen -> Bestätigen');
assert.match(app, /setInitialSetupPending\(true\);\s*if \(canOpenSetup\) setUpdatePhase\('folder'\);/);
assert.match(app, /await activatePublishedUpdate\(candidate\);\s*setInitialSetupPending\(false\);/);
assert.match(app, /if \(updatePhase === 'folder'\) setUpdatePhase\('prepared'\);/, 'Abbrechen kehrt nur zurück');
// Manueller PDF-Export nennt immer den Speicherort.
const pdfFile = read('src/lib/journalPdfFile.ts');
assert.match(pdfFile, /alert\('PDF gespeichert:\\n' \+ savedAt\)/);
assert.match(pdfFile, /\[folder\.name, archiveRootName\(archiveDate\(data\)\), \.\.\.archiveSubfolders\(data\), saved\]\.join\(' › '\)/);
// Update wartet: Hintergrund-Erkennung, „Später installieren“, Update-Knopf auf dem Startbildschirm.
assert.match(app, /window\.setInterval\(check, 15 \* 60_000\)/);
assert.match(app, /addEventListener\('visibilitychange', check\)/);
assert.match(app, /onDismiss=\{\(\) => \{ updateDeferred\.current = true; setUpdatePhase\(null\); \}\}/);
assert.match(app, /homeVisible && !currentStaff && updatePhase/, 'Dialog nie während eines Kassenvorgangs');
assert.match(app, /updateWaiting=\{candidate\?\.version\}/);
assert.match(home, /'● Update wartet' : 'Update'/);
assert.match(dialog, /'Später installieren'/);
assert.match(dialog, /label: 'Jetzt installieren'/);
assert.match(dialog, /Installiert: <strong>Version \{installedVersion\}/);
assert.match(read('src/lib/appVersion.ts'), /export async function preflightPublishedUpdate[\s\S]*?await preparePublishedUpdate\(candidate\);\s*return true;\s*\} catch \{\s*return false;/);
