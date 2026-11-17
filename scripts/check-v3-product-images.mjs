import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tile = readFileSync('src/components/POS/ProductTile.tsx', 'utf8');

// The confirmed WOODMO visual: a square card where the square source photo
// fills the entire tile. On 800×800 source photos aspect-square+cover does NOT
// crop the subject. A dark caption overlays the lower part of the SAME image.
assert.match(tile, /aspect-square/);
assert.match(tile, /className="absolute inset-0 h-full w-full object-cover object-center"/);
assert.doesNotMatch(tile, /object-contain|bg-gray-50 p-2/);
assert.match(tile, /absolute inset-x-0 bottom-0/);
assert.match(tile, /bg-slate-950\/85/);
assert.match(tile, /text-white backdrop-blur/);
assert.match(tile, /text-sm font-bold leading-tight text-white sm:text-base/);
assert.match(tile, /text-blue-400 sm:text-base/);
assert.match(tile, /text-xs font-medium leading-tight text-green-400/);
assert.match(tile, /product\.hasShot/);
assert.match(tile, /product\.isPfandArticle/);
assert.match(tile, /taxRateForProduct\(product, location\)/);
assert.match(tile, /alt=\{product.name\}/);
assert.match(tile, /formatCurrency\(price\)/);
assert.match(tile, /disabled=\{isDisabled\}/);
assert.match(tile, /dragMode/);
// Kompakt-Ansicht (Bilder aus) und Likör-Hervorhebung.
const pos = readFileSync('src/components/POS/POSScreen.tsx', 'utf8');
assert.match(tile, /compact\?: boolean/);
assert.match(tile, /export function SpiritBadge/);
assert.match(tile, /kind === 'likoer' \? 'LIKÖR' : 'SCHNAPS'/);
assert.match(tile, /const color = spiritColor\(kind\);/);
assert.match(tile, /bg-green-400 text-slate-950`\}>PFAND</);
const spirit = readFileSync('src/lib/spiritColors.ts', 'utf8');
assert.match(spirit, /SPIRIT_COLORS = \{ likoer: '#8b5cf6', schnaps: '#ef4444' \}/);
assert.match(pos, /calc\(\$\{longestCategoryName \* 1\.1\}ch \+ 3\.75rem\)/);
assert.match(pos, /const TILE_IMAGES_KEY = 'pos_tile_images'/);
assert.match(pos, /compact=\{!showImages\}/);
assert.match(pos, /'Bilder aus' : 'Bilder an'/);
assert.match(readFileSync('src/components/POS/CartItemRow.tsx', 'utf8'), /<SpiritBadge kind=\{item\.product\.spiritType\} \/>/);
console.log('KOMPAKT-ANSICHT: Umschalter Bilder an/aus pro Gerät, Likör-Kennzeichnung geprüft.');
console.log('ARTIKELBILDER: quadratisches Vollbild, randlos, kontrastreiche Preis/Pfand-Texte und Touch-/Drag-Funktionen geprüft.');
assert.match(pos, /const kindRank = \(p: Product\) => p\.spiritType === 'schnaps' \? 0 : p\.spiritType === 'likoer' \? 1 : 2;/);
// Warenkorb zuklappbar (pro Gerät), Pfand-Retoure, Bonliste und Bezahlen bleiben erreichbar.
assert.match(pos, /const CART_COLLAPSED_KEY = 'pos_cart_collapsed'/);
assert.match(pos, /aria-label=\{cartCollapsed \? 'Warenkorb aufklappen' : 'Warenkorb zuklappen'\}/);
assert.match(pos, /cart\.length > 0 && !cartCollapsed && <div/);
assert.match(pos, /onClick=\{\(\) => setShowPfandRetoure\(true\)\}/);
assert.match(pos, /onClick=\{\(\) => activeSession && currentStaff && setShowCheckout\(true\)\}/);
console.log('WARENKORB: zuklappbar, Summe sichtbar, Pfand-Retoure/Bonliste/Bezahlen bleiben.');
// Aktive Warengruppe: Überschrift größer und in Gruppenfarbe, Rahmen + Überschrift pulsieren gleich.
const css = readFileSync('src/index.css', 'utf8');
assert.match(css, /@keyframes woodmo-cat-glow-dark/);
assert.match(css, /\.dark \.woodmo-cat-pulse-text \{ animation-name: woodmo-cat-text-dark; \}/);
assert.match(pos, /'woodmo-cat-active bg-slate-900 text-white dark:bg-white dark:text-slate-900'/);
assert.match(pos, /<span className="woodmo-cat-pulse-text text-slate-900 dark:text-white">\{cat\.name\}<\/span>/);
assert.doesNotMatch(pos, /categoryAccent/);
assert.match(tile, /dark:border-white\/85/);
console.log('WARENGRUPPE: Schwarz-Weiß, aktive Gruppe und Überschrift pulsieren weiß, Kacheln weiß umrandet.');
// Zugeklappter Warenkorb: Positionsliste mit Schuss-Auswahl.
assert.match(pos, /aria-label=\{`Schuss für Position \$\{index \+ 1\} wählen`\}/);
assert.match(pos, /!item\.isPfandRetoure && item\.product\.hasShot && \(/);
console.log('WARENKORB ZU: Positionen mit Schuss-Auswahl.');
assert.match(pos, /aria-label=\{cartCollapsed \? 'Warenkorb aufklappen \(Pfeil\)' : 'Warenkorb zuklappen \(Pfeil\)'\}/);
console.log('WARENKORB: Griff mit Pfeil am linken Rand.');
// Warenkorb-Breite ziehen und fixieren (pro Gerät), Pfand überall im gleichen Grün.
assert.match(pos, /const CART_WIDTH_KEY = 'pos_cart_width'/);
assert.match(pos, /const CART_PINNED_KEY = 'pos_cart_pinned'/);
assert.match(pos, /if \(!drag \|\| cartPinned \|\| cartCollapsed\) return;/);
assert.match(pos, /sm:grid-cols-\[minmax\(0,1fr\)_var\(--cart-w\)\]/);
assert.doesNotMatch(pos + readFileSync('src/components/POS/CartItemRow.tsx', 'utf8'), /teal-/);
console.log('WARENKORB: Breite ziehen/fixieren, Pfand einheitlich grün.');
assert.match(pos, /'✓ Fertig verschieben' : 'Kacheln verschieben'/);
assert.match(pos, /loadJSON<boolean>\(TILE_IMAGES_KEY, false\) === true/);
// Sicherheitsarchiv (früher „Offline-Quarantäne“): Hinweis nur für Administratoren und nur bei echten offenen Daten.
{
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /resetArchive && \(resetArchive\.pendingReceipts > 0 \|\| resetArchive\.pendingSessions > 0\) &&\s*\(currentStaff\?\.role === 'administrator' \|\| adminUnlocked\)/);
  assert.doesNotMatch(app, /Offline-Quarantäne:/);
  console.log('SICHERHEITSARCHIV: Hinweis nur für Admins und nur bei nicht übertragenen Bons/Kassen.');
}
