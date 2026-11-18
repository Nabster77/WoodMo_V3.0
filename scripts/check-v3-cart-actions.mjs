import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pos = readFileSync('src/components/POS/POSScreen.tsx','utf8');
const search = pos.slice(pos.indexOf('{/* Werkzeuge in einer Reihe:'), pos.indexOf('{/* Product grid */}'));
const cart = pos.slice(pos.indexOf('{/* Right: cart */}'),pos.indexOf('{/* Dialogs */}'));
assert(search.includes('Artikel suchen...'));
assert(!search.includes('setShowPfandRetoure(true)') && !search.includes('setShowBonliste(true)'),
  'Pfand and Storno actions must not take space away from product search');
assert(cart.includes('<h2 className="min-w-0 truncate font-bold text-gray-900 dark:text-gray-100">Warenkorb</h2>'));
assert(cart.indexOf('Warenkorb</h2>')<cart.indexOf('setShowPfandRetoure(true)'));
assert(cart.indexOf('setShowPfandRetoure(true)')<cart.indexOf('setShowBonliste(true)'));
assert(cart.includes('Pfand-Retoure'));
assert(cart.includes('Bonliste / Storno'));
// Aufgeklappt nebeneinander; zugeklappt (schmale Spalte) untereinander, immer sichtbar.
assert(cart.includes("mt-2 grid gap-2 ${cartCollapsed ? 'grid-cols-2 sm:grid-cols-1' : 'grid-cols-2'}"),'Both touch actions always displayed');
assert((cart.match(/min-h-9 min-w-0/g)||[]).length>=2,'Pfand-Retoure und Bonliste: kompakt (Nutzerwunsch 17.11.), aber mindestens 36 px hoch');
assert((cart.match(/disabled=\{!activeSession \|\| !currentStaff\}/g)||[]).length>=2);
assert(pos.includes('<PfandRetoureDialog'));
assert(pos.includes('<BonlisteDialog'));
assert(pos.includes('onCommit={onCommitStorno}'));
console.log('Warenkorb: Pfand-Retoure und Bonliste/Storno sichtbar, gut erreichbar, sicher gesperrt ohne Kasse und weiterhin korrekt verdrahtet.');

// Griff am Warenkorb blendet sich nach 5 Sekunden aus; schmaler Streifen holt ihn zurück (Wunsch 18.11.2026).
const posHandle = readFileSync('src/components/POS/POSScreen.tsx', 'utf8');
assert.match(posHandle, /const HANDLE_VISIBLE_MS = 5000;/);
assert.match(posHandle, /\{!handleVisible && \(\s*<button type="button" onClick=\{showHandle\} aria-label="Warenkorb-Griff anzeigen"/);
assert.match(posHandle, /\{handleVisible && <button type="button" onPointerDown=\{onHandleDown\}/);
console.log('WARENKORB-GRIFF: blendet nach 5 s aus, Streifen zeigt ihn wieder.');

// Einlage ohne Begründung; Ausgabe weiter mit Grund (Wunsch 18.11.2026).
const entryDialog = readFileSync('src/components/POS/CashEntryDialog.tsx', 'utf8');
assert.match(entryDialog, /onSave\(a, isDeposit \? 'Einlage' : reason\.trim\(\)\)/);
assert.match(entryDialog, /\{!isDeposit && <div>\s*<label[^>]*>Beschreibung \/ Grund<\/label>/);
assert.match(entryDialog, /disabled=\{!validAmount \|\| \(!isDeposit && !reason\.trim\(\)\)\}/);
console.log('EINLAGE: ohne Begründung, Ausgabe mit Grund.');

// Dunkler Modus ist Standard; hell nur nach eigener Wahl auf dem Gerät (Wunsch 18.11.2026).
const themeHook = readFileSync('src/hooks/useTheme.ts', 'utf8');
assert.doesNotMatch(themeHook, /prefers-color-scheme/);
assert.match(themeHook, /if \(userChose && \(stored === 'light' \|\| stored === 'dark'\)\) return stored;\s*return 'dark';/);
assert.match(themeHook, /saveJSON\(STORAGE_KEYS\.themeUserChoice, true\);/);
assert.match(readFileSync('index.html', 'utf8'), /<html lang="de" class="dark">/);
console.log('DARK-MODUS: Standard dunkel, hell nur nach eigener Wahl.');

