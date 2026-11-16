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
assert.match(tile, /text-xs font-medium leading-tight text-slate-200/);
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
assert.match(tile, /spiritColor\(product\.spiritType, bottle\)/);
const spirit = readFileSync('src/lib/spiritColors.ts', 'utf8');
assert.match(spirit, /shot: \{ likoer: '#d946ef', schnaps: '#dc2626' \}/);
assert.match(spirit, /bottle: \{ likoer: '#8b5cf6', schnaps: '#0284c7' \}/);
assert.match(pos, /calc\(\$\{longestCategoryName \* 1\.1\}ch \+ 3\.75rem\)/);
assert.match(pos, /const TILE_IMAGES_KEY = 'pos_tile_images'/);
assert.match(pos, /compact=\{!showImages\}/);
assert.match(pos, /'Bilder aus' : 'Bilder an'/);
assert.match(readFileSync('src/components/POS/CartItemRow.tsx', 'utf8'), /<SpiritBadge kind=\{item\.product\.spiritType\} bottle=\{bottle\} \/>/);
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
assert.match(css, /@keyframes woodmo-cat-ring/);
assert.match(css, /\.woodmo-cat-pulse-text \{ color: var\(--cat-accent\)/);
assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.woodmo-cat-pulse-ring/);
assert.match(pos, /woodmo-cat-pulse-ring/);
assert.match(pos, /<span className="woodmo-cat-pulse-text">\{cat\.name\}<\/span>/);
console.log('WARENGRUPPE: Überschrift und Rahmen pulsieren in der Gruppenfarbe.');
// Zugeklappter Warenkorb: Positionsliste mit Schuss-Auswahl.
assert.match(pos, /aria-label=\{`Schuss für Position \$\{index \+ 1\} wählen`\}/);
assert.match(pos, /!item\.isPfandRetoure && item\.product\.hasShot && \(/);
console.log('WARENKORB ZU: Positionen mit Schuss-Auswahl.');
