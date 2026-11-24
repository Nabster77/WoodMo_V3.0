import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// The application uses Vite's automatic JSX runtime. Inspect source directly
// instead of mounting JSX under Node's different default loader.
const home = readFileSync('src/components/WoodmoHome.tsx','utf8');
assert.equal((home.match(/<button type="button" onClick=\{on(Cash|Admin)\}/g) ?? []).length, 2,
  'Home has exactly two main tiles.');
assert.equal((home.match(/<button type="button" onClick=/g) ?? []).length, 4,
  'Besides the two tiles only the small Update and Setup links exist.');
assert.match(home, /onClick=\{onUpdate\}/);
assert.match(home, /onClick=\{onSetup\}/);
assert.match(home, /text-\[11px\] font-semibold text-slate-500/, 'Update-Zentrale link stays small and unobtrusive.');
for (const label of ['Kasse eröffnen', 'Kasse fortsetzen', 'Verwaltung',
  'Administrator', 'Cloud / Abgleich prüfen']) {
  assert.ok(home.includes(label), `Home text missing: ${label}`);
}

const app = readFileSync('src/App.tsx', 'utf8');
const pos = readFileSync('src/components/POS/POSScreen.tsx', 'utf8');
const cashOpen = readFileSync('src/components/POS/CashOpeningDialog.tsx','utf8');
const cart = readFileSync('src/components/POS/CartItemRow.tsx','utf8');

assert.match(app, /const \[homeVisible, setHomeVisible\] = useState\(true\)/,
  'Start screen must be the initial route');
assert.match(app, /posVisited && \(/, 'POS stays mounted once it has been entered');
assert.match(app, /homeVisible \|\| tab !== 'pos' \? 'hidden' : 'h-full min-h-0'/,
  'The POS is hidden, not unmounted, when navigating Home/Admin');
assert.match(app, /onHome=\{goHome\}/);
assert.match(cashOpen, /onClick=\{onClose\}/,
  'Cash opening has a way back Home');
assert.match(cashOpen, /Zur Startseite/);
assert.match(app, /onAdmin=\{\(\) => openManagementFromCashOpening/,
  'Admin tile must enter original credential gate');
assert.match(app, /setOpeningManagementAccess\(null\)/,
  'Personal admin passwords must be possible');
assert.match(app, /persistFinalizedCashSession\(closed\)/,
  'Finalized close remains cloud-confirmed');
assert.match(app, /await saveJournalPdfIfAllowed\(/,
  'Local close PDF retention remains enabled');
assert.match(pos, /sm:grid-cols-\[minmax\(0,1\.85fr\)_minmax\(220px,1fr\)\]/,
  'Portrait tablet left/right split must be defined');
assert.match(pos, /aria-label="Warengruppen"/);
assert.match(pos, /aria-selected=\{activeCat === cat.id && !search\}/,
  'Category selection must remain visible');
assert.match(pos, /requestDailyClose\(\)/,
  'The original daily-close confirmation path must stay wired');
assert.match(cart, /onEditShot/);
assert.match(cart, /onInc/);
assert.match(cart, /onDec/);
assert.match(cart, /onRemove/);
const adminTagesinfo = readFileSync('src/components/Admin/AdminScreen.tsx','utf8');
assert.match(adminTagesinfo, />Umsatz \(ohne Pfand\)</, 'Tagesinfo: Umsatz ohne Pfand klar benannt');
assert.match(adminTagesinfo, />Pfand-Saldo</, 'Tagesinfo: Pfand als Saldo benannt');
assert.match(adminTagesinfo, /Gesamt kassiert \(inkl\. Pfand\)[\s\S]{0,400}formatCurrency\(cashTotal \+ cardTotal\)/, 'Tagesinfo: Gesamt kassiert = Bar + Karte');
const closeDialog = readFileSync('src/components/POS/DailyCloseDialog.tsx','utf8');
assert.match(closeDialog, /Kassenbestand \(nur Bargeld\)[\s\S]{0,2200}label="= Erwarteter Kassenbestand"/, 'Abschluss: Kassenbestand nur aus Bargeld, von oben nach unten');
assert.match(closeDialog, />Tagesumsatz<[\s\S]{0,800}Davon Kartenzahlungen/, 'Abschluss: Umsatz getrennt, Karte klar ausgewiesen');
assert.match(closeDialog, /Kartenzahlungen zählen zum Umsatz, nicht zum Bargeld/, 'Abschluss: Karte nicht im Bargeld');
const journalPdfSrc = readFileSync('src/lib/journalPdf.ts','utf8');
assert.equal((journalPdfSrc.match(/Gesamt kassiert \(inkl\. Pfand\)/g) ?? []).length, 3, 'Journal-PDF: Gesamt kassiert je Standort, gesamt und im Vergleich');
assert.match(closeDialog, /Gesamt kassiert \(inkl\. Pfand\) = Bar \+ Karte<\/span><span>\$\{formatCurrency\(Math\.round\(\(sums\.txTotal \+ pfandBalance\)/, 'Tagesabschluss-PDF: Gesamt kassiert');
console.log('V3-LAYOUT: Home mit zwei Kacheln, Login/Home, Warenkorb-Erhalt bei Navigation, 65/35-Aufteilung und Kassenfunktionen geprüft.');
