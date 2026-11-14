import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildImportPlan, exportWorkbook, exportSimpleWorkbook, readWorkbook, readImageZip, normalizeName } from '../src/lib/catalogTransfer';
import { seedCategories, seedProducts } from '../src/lib/seed';
import { DEFAULT_SHOTS, normalizeCategories } from '../src/lib/shotCatalog';
import { taxRateForProduct } from '../src/lib/tax';
import type { LocalCatalog } from '../src/lib/catalogSync';
import { unzipSync, zipSync } from 'fflate';
import { buildCatalogBundle } from '../src/lib/catalogBundleExport';
const base: LocalCatalog = {categories:normalizeCategories(seedCategories),products:structuredClone(seedProducts),shotOptions:structuredClone(DEFAULT_SHOTS),pfandSettings:{Friedrichshafen:.25,Bregenz:.2}};
const headers = ['Produktname App','VK 2026','Warengruppe','Preis durch Mitarbeiter oder fix','Steuer DE in %','Steuer AT in %'];
const product = ['Neu',4,'Neue Gruppe','fix',19,20];
const make = (rows: unknown[][]) => ({Tabelle1:[headers,...rows]});
const original = JSON.stringify(base);
const plan = buildImportPlan(make([product,['Rum (Schuss)',2,'SCHUSS','fix',19,20],['Einzelpreis',null,'Handwerk','individuell eintragen',7,10]]),base);
assert.deepEqual(plan.errors,[]);
assert.equal(plan.next.products.length,2,'Artikel, die in der Excel fehlen, werden entfernt');
assert.equal(plan.removed.filter(r=>r.kind==='Artikel').length,base.products.length);
assert.equal(plan.next.shotOptions.find(s=>s.id==='rum')?.price,2);
assert.equal(plan.next.shotOptions.find(s=>s.id==='rum')?.name,'Rum');
assert(!plan.next.products.some(p=>p.categoryId==='cat-system-schuss'));
assert.equal(plan.next.products.find(p=>p.name==='Einzelpreis')?.hasIndividualPrice,true);
assert.equal(JSON.stringify(base),original,'preview cannot mutate local data');
assert.deepEqual(buildImportPlan(make([product,product]),base).errors,[],'identische Doppelzeilen werden ignoriert');
assert(buildImportPlan(make([product,['Neu',5,'Neue Gruppe','fix',19,20]]),base).errors.some(e=>e.includes('Doppelter Name')),'gleicher Name mit anderen Werten bleibt ein Fehler');
for (const bad of [-1,'1,234',NaN,Infinity,'abc']) assert(buildImportPlan(make([['Bad',bad,'G','fix',19,20]]),base).errors.length);
assert(buildImportPlan(make([['Bad',4,'G','fix',20,19]]),base).errors.length);
assert(buildImportPlan(make([['Bad',4,'G','maybe',19,20]]),base).errors.length);
const at13 = buildImportPlan(make([['AT',4,'G','fix',7,13]]),base);
assert.deepEqual(at13.errors,[]); assert.equal(taxRateForProduct(at13.next.products.at(-1)!,'Bregenz'),13);
const ambiguous = structuredClone(base); ambiguous.products.push({...ambiguous.products[0],id:'duplicate'});
assert(buildImportPlan(make([['Cola 0,5l',4,'Getränke','fix',19,20]]),ambiguous).errors.length);
// Use a genuine 1x1 PNG. Fake JPG bytes must be rejected by the importer.
const validPng = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP48OEDAAWkAtFabOJuAAAAAElFTkSuQmCC','base64'));
const images = readImageZip(zipSync({'outer/nested/Neu(2).png':validPng,'ignored.txt':new Uint8Array([1])}));
assert.equal(images.length,1); assert.equal(normalizeName('Ätherische Öle(2)'),normalizeName('Ätherische Öle'));
const withImage = buildImportPlan(make([product]),base,images);
assert.equal(Object.keys(withImage.images).length,1);
const duplicates = [...images,{...images[0],path:'other/neu.jpg'}];
const ambiguousImages = buildImportPlan(make([product]),base,duplicates);
assert.deepEqual(ambiguousImages.errors,[], 'Artikelimport darf bei doppeltem Bild nicht abbrechen');
assert(ambiguousImages.warnings.some(w=>w.includes('mehrere gleich gute ZIP-Bilder')));
assert.equal(Object.keys(ambiguousImages.images).length,0,'mehrdeutige Bilder duerfen nicht stillschweigend hochgeladen werden');
const missing = buildImportPlan(make([['Other',1,'G','fix',19,20]]),base,images);
assert.equal(missing.errors.length,0); assert(missing.warnings.some(w=>w.includes('kein passendes ZIP-Bild')));
const existing = [{...images[0],path:'outer/Cola 0,5l.jpg'}];
assert.equal(Object.keys(buildImportPlan(make([['Cola 0,5l',4,'Getränke','fix',19,20]]),base,existing).images).length,1,'ZIP-Bild hat automatisch Vorrang vor vorhandenem Bild');
const {default: ExcelJS} = await import('exceljs');
const formulas = new ExcelJS.Workbook(); const formulaSheet=formulas.addWorksheet('Formel');
formulaSheet.getCell('A1').value={formula:'1+1',result:2};
await assert.rejects(readWorkbook(await formulas.xlsx.writeBuffer() as ArrayBuffer),/Formeln/);
const workbook = await exportWorkbook(base);
const roundtrip = buildImportPlan(await readWorkbook(workbook),base);
assert.deepEqual(roundtrip.errors,[]);
assert.deepEqual(roundtrip.next,base,'export/import must preserve all catalog data including optional defaults');
assert(roundtrip.rows.every(r=>r.status==='unverändert'));
const modified = structuredClone(base);
modified.products[0].taxRates = {Friedrichshafen:7,Bregenz:13};
modified.shotOptions[0].locationPrices = {Bregenz:2.75};
const twice = buildImportPlan(await readWorkbook(await exportWorkbook(modified)),modified);
assert.deepEqual(twice.next,modified,'explicit rates and shot overrides roundtrip');

// Warengruppe wechselt: Artikel wird verschoben statt doppelt angelegt; Tippfehler Kafee -> Kaffee.
{
  const g = (id: string, name: string) => ({id, name, icon: 'Package', color: 'x', sortOrder: 0});
  const mk = (name: string, cat: string, id: string) => ({...base.products[0], id, name, categoryId: cat, imageUrl: '', sortOrder: 0});
  const moved: LocalCatalog = {...structuredClone(base), categories: normalizeCategories([g('c-k','Kurze'), g('c-f','Schnaps (Flaschen)')]), products: [mk('Obstler','c-k','p1'), mk('Obstler','c-f','p2'), mk('Kaffee (L)','c-k','p3'), mk('Alt','c-k','p4')]};
  const rows = [['Obstler',4,'Kurze (Schnaps)','fix',19,20],['Obstler',26,'Schnaps (Flaschen)','fix',19,20],['Kafee (L)',4,'Kurze (Likör)','fix',19,20]];
  const result = buildImportPlan(make(rows), moved);
  assert.deepEqual(result.errors, []);
  assert.equal(result.next.products.length, 3, 'keine Duplikate');
  assert.equal(result.next.products.find(p => p.id === 'p2')!.categoryId, 'c-f', 'Flaschen-Obstler bleibt in seiner Gruppe');
  assert.notEqual(result.next.products.find(p => p.id === 'p1')!.categoryId, 'c-k', 'Kurze-Obstler wurde verschoben');
  assert.equal(result.next.products.find(p => p.id === 'p3')!.name, 'Kaffee (L)', 'Schreibweise korrigiert');
  assert.deepEqual(result.removed.map(r => r.name).sort(), ['Alt', 'Kurze']);
  assert(!result.next.categories.some(c => c.id === 'c-k'), 'leere Warengruppe entfernt');
  assert(result.next.categories.some(c => c.id === 'cat-system-schuss'), 'SCHUSS bleibt');
  // Bilder: (S)=Schnaps, (L)=Likör, Tippfehler, Ordner Flaschen.
  const png = {bytes: validPng, mime: 'image/png'};
  const archive2 = ['Getränke/Obstler (S).png','Flaschenbilder/Obstler.jpeg','Getränke/Kaffee (L).png','Flaschenbilder/Kafee groß.jpeg','Getränke/Zirbenschnaps.png','Getränke/Zirbe (L).png'].map(path => ({path, ...png}));
  const pic = buildImportPlan(make([['Obstler',4,'Kurze (Schnaps)','fix',19,20],['Obstler',26,'Schnaps (Flaschen)','fix',19,20],['Kafee (L)',4,'Kurze (Likör)','fix',19,20],['Kaffee groß',28,'Likör (Flaschen)','fix',19,20],['Zirbe (S)',4,'Kurze (Schnaps)','fix',19,20],['Zirbe (L)',4,'Kurze (Likör)','fix',19,20]]), moved, archive2);
  const pathOf = (name: string, group: string) => { const p = pic.next.products.find(x => x.name === name && pic.next.categories.find(c => c.id === x.categoryId)?.name === group); return p && pic.images[p.id]?.path; };
  assert.equal(pathOf('Obstler','Kurze (Schnaps)'), 'Getränke/Obstler (S).png');
  const schussArchive = [...archive2, 'Getränke/Rum (Schuss).png', 'Getränke/Whiskey (Schuss).PNG', 'Winzer Glühwein.png'].map(x => typeof x === 'string' ? { path: x, ...png } : x);
  const schussPlan = buildImportPlan(make([['Obstler',4,'Kurze (Schnaps)','fix',19,20]]), moved, schussArchive);
  assert(!schussPlan.unmatched.some(x => /schuss/i.test(x)), 'Schuss-Bilder werden nicht als unpassend gemeldet');
  assert(schussPlan.unmatched.includes('Winzer Glühwein.png'), 'echte unpassende Bilder werden weiter gemeldet');
  assert.equal(pathOf('Obstler','Schnaps (Flaschen)'), 'Flaschenbilder/Obstler.jpeg');
  assert.equal(pathOf('Kaffee (L)','Kurze (Likör)'), 'Getränke/Kaffee (L).png');
  assert.equal(pathOf('Kaffee groß','Likör (Flaschen)'), 'Flaschenbilder/Kafee groß.jpeg');
  assert.equal(pathOf('Zirbe (S)','Kurze (Schnaps)'), 'Getränke/Zirbenschnaps.png');
  assert.equal(pathOf('Zirbe (L)','Kurze (Likör)'), 'Getränke/Zirbe (L).png');
}

// Veraltete Bildadresse in der Excel darf ein vorhandenes Bild nicht zurücksetzen.
{
  const withImage: LocalCatalog = structuredClone(base);
  withImage.products[0].imageUrl = 'https://x.supabase.co/storage/v1/object/public/article-images/new.png';
  const cat = withImage.categories.find(c => c.id === withImage.products[0].categoryId)!;
  const sheet = {Tabelle1:[[...headers,'Bild'],[withImage.products[0].name,withImage.products[0].prices.Friedrichshafen,cat.name,'fix',19,20,'https://x.supabase.co/storage/v1/object/public/article-images/old.png']]};
  const stale = buildImportPlan(sheet, withImage);
  assert.equal(stale.next.products.find(p => p.id === withImage.products[0].id)!.imageUrl.endsWith('new.png'), true, 'altes Bild aus der Excel setzt nichts zurück');
}

// Einfacher Export (Layout der Preisliste, ohne IDs) lässt sich ohne Verlust wieder importieren.
{
  const withLocation: LocalCatalog = structuredClone(base);
  withLocation.products[0].prices.Bregenz = withLocation.products[0].prices.Friedrichshafen + 1;
  const simple = buildImportPlan(await readWorkbook(await exportSimpleWorkbook(withLocation)), withLocation);
  assert.deepEqual(simple.errors, []);
  assert.equal(simple.removed.length, 0, 'einfacher Export löscht nichts');
  assert.deepEqual(simple.next.products, withLocation.products, 'Preise je Standort bleiben erhalten');
  assert.deepEqual(simple.next.shotOptions, withLocation.shotOptions);
  const plain = buildImportPlan(await readWorkbook(await exportSimpleWorkbook(base)), base);
  assert(plain.rows.every(r => r.status === 'unverändert'), 'einfacher Export ohne Änderungen = alles unverändert');
}
if (process.argv[2]) {
 const bytes = fs.readFileSync(process.argv[2]);
 const archive = process.argv[3] ? readImageZip(fs.readFileSync(process.argv[3])) : [];
 const actual = buildImportPlan(await readWorkbook(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),base,archive);
 assert.deepEqual(actual.errors,[]);
 assert.equal(actual.next.products.length,51);
 assert.equal(actual.next.shotOptions.length,4);
 assert.equal(actual.next.pfandSettings.Bregenz,3);
 console.log(`Originaldateien: ${actual.next.products.length} Artikel, ${actual.rows.filter(r=>r.kind==='SCHUSS'&&r.status==='geändert').length} SCHUSS-Änderungen, ${Object.keys(actual.images).length} Bildzuordnungen, ${actual.warnings.length} Bildhinweise.`);
}
console.log('Katalogtests erfolgreich: Vorschau, Duplikate, Preis-/Steuervalidierung, SCHUSS-Schutz, ZIP-Unterordner, Bildschutz und vollständiger Excel-Roundtrip.');

// V3 reverse workflow: Excel + correctly named image ZIP in one export package.
const ownStorage = 'https://my-test-project.supabase.co';
const imageProduct = {...base.products[0], imageUrl:ownStorage+'/storage/v1/object/public/article-images/woodmo-roundtrip.png'};
const roundtripCatalog: LocalCatalog = {...base, products:[imageProduct, {...base.products[1], imageUrl:''}]};
const realFetch = globalThis.fetch;
try {
  globalThis.fetch = (async (url: string | URL | Request) => {
    assert.equal(String(url), imageProduct.imageUrl);
    return new Response(validPng, {status:200, headers:{'content-type':'image/png'}});
  }) as typeof fetch;
  const packageResult = await buildCatalogBundle(roundtripCatalog,undefined,ownStorage);
  assert.equal(packageResult.exportedImages, 1);
  assert.equal(packageResult.missingImages.length, 1);
  const files = unzipSync(packageResult.bytes);
  assert(files['WOODMO_Katalog.xlsx']);
  assert(files['WOODMO_Bilder.zip']);
  const inside = readImageZip(files['WOODMO_Bilder.zip']);
  assert.equal(inside.length,1);
  assert(inside[0].path.includes(imageProduct.name + '.png'));
  assert(/^Bilder\/[^/]+\/[^/]+\.png$/.test(inside[0].path),'Export: Unterordner je Warengruppe');
  const excelBytes = files['WOODMO_Katalog.xlsx'];
  const imported = buildImportPlan(
    await readWorkbook(excelBytes.buffer.slice(excelBytes.byteOffset,excelBytes.byteOffset+excelBytes.byteLength) as ArrayBuffer),
    roundtripCatalog,inside);
  assert.deepEqual(imported.errors,[]);
  assert(imported.images[imageProduct.id]);
  // A missing image MUST be listed inside the exported ZIP, not silently
  // omitted or allowed to abort the other valid images.
  globalThis.fetch = (async () => new Response('Not Found',{status:404})) as typeof fetch;
  const missingResult = await buildCatalogBundle(roundtripCatalog,undefined,ownStorage);
  assert.equal(missingResult.exportedImages,0);
  assert.equal(missingResult.missingImages.length,2);
  const missingZip = unzipSync(unzipSync(missingResult.bytes)['WOODMO_Bilder.zip']);
  assert(missingZip['FEHLENDE_BILDER.txt']);
  assert.match(new TextDecoder().decode(missingZip['FEHLENDE_BILDER.txt']),new RegExp(imageProduct.name));
  console.log('V3-EXCEL+BILDER-RÜCKIMPORT: Paket, Dateiname, ZIP, Vorschau und Fehlerfall bestanden.');
} finally {
  globalThis.fetch = realFetch;
}
