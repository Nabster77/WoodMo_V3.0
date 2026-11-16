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
assert.match(tile, />LIKÖR</);
assert.match(tile, />SCHNAPS</);
assert.match(tile, /product\.spiritType === 'likoer'/);
assert.match(pos, /const TILE_IMAGES_KEY = 'pos_tile_images'/);
assert.match(pos, /compact=\{!showImages\}/);
assert.match(pos, /'Bilder aus' : 'Bilder an'/);
assert.match(readFileSync('src/components/POS/CartItemRow.tsx', 'utf8'), /<SpiritBadge kind=\{item\.product\.spiritType\} \/>/);
console.log('KOMPAKT-ANSICHT: Umschalter Bilder an/aus pro Gerät, Likör-Kennzeichnung geprüft.');
console.log('ARTIKELBILDER: quadratisches Vollbild, randlos, kontrastreiche Preis/Pfand-Texte und Touch-/Drag-Funktionen geprüft.');
assert.match(pos, /const kindRank = \(p: Product\) => p\.spiritType === 'schnaps' \? 0 : p\.spiritType === 'likoer' \? 1 : 2;/);
