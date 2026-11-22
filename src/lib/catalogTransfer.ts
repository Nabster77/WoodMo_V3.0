import { Unzip, UnzipInflate } from 'fflate';
import type { Category, Product, ShotOption, Location, TaxClass } from '@/types';
import { stableStringify, type LocalCatalog } from './catalogSync';
import { normalizeCategories, SHOT_CATEGORY_ID, validShots } from './shotCatalog';
import { taxRateForProduct, taxRateForClass } from './tax';

export const locations = ['Friedrichshafen', 'Bregenz'] as const;
export type SheetRows = Record<string, unknown[][]>;
export type PreviewRow = { id?: string; kind: string; name: string; status: 'neu' | 'geändert' | 'unverändert' | 'entfernt'; changes: string[]; image?: string; tags?: string[] };
export type ImageEntry = { path: string; bytes: Uint8Array; mime: string };
export type ImportPlan = { base: LocalCatalog; next: LocalCatalog; rows: PreviewRow[]; errors: string[]; warnings: string[]; images: Record<string, ImageEntry>; removed: { kind: 'Artikel' | 'Warengruppe'; id: string; name: string; group?: string }[]; unmatched: string[] };
export const normalizeName = (v: unknown): string => String(v ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').toLocaleLowerCase('de-DE').replace(/\(\d+\)\s*$/, '').replace(/[^a-z0-9]/g, '');
/** Image filenames may spell German umlauts as ae/oe/ue instead of ä/ö/ü. */
function imageNameKey(value: string): string {
  return normalizeName(value.replace(/ä/gi, 'ae').replace(/ö/gi, 'oe').replace(/ü/gi, 'ue'));
}
function imageStem(path: string): string {
  return path.split('/').pop()!.replace(/\.[^.]+$/, '');
}
/** Known spelling mistakes that are corrected in article names on import. */
export function fixSpelling(name: string): string {
  return name.replace(/\s+/g, ' ').trim().replace(/\bKafee/g, 'Kaffee').replace(/\bKaffe\b/g, 'Kaffee').replace(/\bkafee/g, 'kaffee');
}
function distance(x: string, y: string): number {
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}
/** Two names count as the same when they differ by at most one typo (only for names of 5+ letters). */
function nearlySame(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 5 && distance(a, b) <= 1;
}
type Kind = 'schnaps' | 'likoer' | '';
type Size = 'small' | 'medium' | 'large' | 'xl' | '';
type NameInfo = { key: string; kind: Kind; size: Size };
const KIND_WORDS: Record<string, string> = { zirbenschnaps: 'zirbe', aromaboxen: 'aromabox', duftkloetze: 'duftklotz', duftklotze: 'duftklotz' };
/**
 * Splits an article or file name into its core name, the drink type and the size.
 * (S)/S = Schnaps, (L)/L = Likör; klein/mittel/groß/XL are sizes.
 */
function parseName(raw: string, hint = ''): NameInfo {
  let value = raw.replace(/\s*\((\d+)\)\s*$/, '').trim();
  let kind: Kind = '';
  let size: Size = '';
  const marker = (m: string) => { const v = m.toLocaleLowerCase('de-DE'); if (v === 's') kind = 'schnaps'; else if (v === 'l') kind = 'likoer'; else if (v === 'm') size = 'medium'; else if (v === 'xl') size = 'xl'; };
  value = value.replace(/\s*\(\s*(s|l|m|xl)\s*\)\s*/gi, (_, m) => { marker(m); return ' '; });
  value = value.replace(/(?:^|[\s_-])(s|l)\s*$/gi, (_, m) => { marker(m); return ' '; });
  value = value.replace(/\b(klein|mittel|medium|gro(?:ß|ss)|large|extra\s*(?:gro(?:ß|ss)|large))\b/gi, (m) => {
    const v = m.toLocaleLowerCase('de-DE');
    size = v === 'klein' ? 'small' : v === 'mittel' || v === 'medium' ? 'medium' : v.startsWith('extra') ? 'xl' : 'large';
    return ' ';
  });
  let key = imageNameKey(value);
  if (key === 'zirbenschnaps') kind = 'schnaps';
  key = KIND_WORDS[key] ?? key;
  if (!kind) {
    const h = normalizeName(hint);
    if (h.includes('schnaps')) kind = 'schnaps';
    else if (h.includes('likor') || h.includes('likoer')) kind = 'likoer';
  }
  return { key, kind, size };
}
const isBottleHint = (v: string) => /flasche/i.test(v);
/** Highest score wins; 0 = not the same product. */
function imageScore(article: string, group: string, file: string, kind: Kind = ''): number {
  const folder = file.includes('/') ? file.split('/').slice(0, -1).join('/') : '';
  const a = parseName(article, group);
  if (!a.kind && kind) a.kind = kind;
  const explicitFile = parseName(imageStem(file));
  const f = parseName(imageStem(file), explicitFile.kind ? '' : folder);
  if (!nearlySame(a.key, f.key)) return 0;
  if (a.kind && f.kind && a.kind !== f.kind) return 0;
  // Different article: "Kaffee" (Getränke) is not "Kaffee klein (L)" (Flaschen).
  // Size must match exactly, and a Likör/Schnaps image never goes to an article without that type.
  if (a.size !== f.size) return 0;
  if (f.kind && !a.kind) return 0;
  // A bottle image (folder „Flaschen…“) never goes to an article outside a bottle group,
  // e.g. hot drink „Kaffee“ (Getränke) never gets a Kaffee-Likör bottle.
  if (isBottleHint(folder) && !isBottleHint(group)) return 0;
  let score = a.key === f.key ? 100 : 94;
  if (a.kind && f.kind && a.kind === f.kind) score += 4;
  if (a.size && f.size) score += 4;
  if (isBottleHint(group) === isBottleHint(folder)) score += isBottleHint(group) ? 10 : 0; else score -= 10;
  const groupStem = normalizeName(group.replace(/\(.*\)/, ''));
  if (folder && groupStem && normalizeName(folder).includes(groupStem)) score += 3;
  return score;
}
function bestImage(article: string, group: string, archive: ImageEntry[], kind: Kind = ''): { file?: ImageEntry; ambiguous: ImageEntry[] } {
  const scored = archive.map(file => ({ file, score: imageScore(article, group, file.path, kind) })).filter(x => x.score > 0)
    .sort((x, y) => y.score - x.score || x.file.path.localeCompare(y.file.path, 'de'));
  if (!scored.length) return { ambiguous: [] };
  const top = scored.filter(x => x.score === scored[0].score);
  if (top.length > 1) return { ambiguous: top.map(x => x.file) };
  return { file: scored[0].file, ambiguous: [] };
}
function imageSuggestions(article: string, group: string, archive: ImageEntry[]): string[] {
  const a = parseName(article, group);
  return archive.map(f => ({ path: f.path, score: 1 - distance(a.key, parseName(imageStem(f.path)).key) / Math.max(a.key.length, 1) }))
    .filter(f => f.score >= 0.7).sort((x, y) => y.score - x.score).slice(0, 3).map(f => f.path);
}
const text = (v: unknown) => String(v ?? '').trim();
const field = (r: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) if (Object.prototype.hasOwnProperty.call(r, name)) return r[name];
  return undefined;
};
const hasField = (r: Record<string, unknown>, ...names: string[]) => names.some(name => Object.prototype.hasOwnProperty.call(r, name));
function flag(v: unknown, label: string): boolean {
  const value = text(v).toLocaleLowerCase('de-DE');
  if (!value || ['-', 'nein', 'false', '0'].includes(value)) return false;
  if (['x', 'schuss', 'pfand', 'ja', 'true', '1'].includes(value)) return true;
  throw new Error(`${label}: Bitte „x“ für aktiv oder eine leere Zelle für inaktiv verwenden.`);
}
const empty = (v: unknown) => v === undefined || v === null || v === '';
/** Excel-Spalte „Kennzeichnung“: leer, „Likör“ oder „Schnaps“. */
export function spiritType(v: unknown): 'likoer' | 'schnaps' | undefined {
  const value = text(v).toLocaleLowerCase('de-DE');
  if (!value || value === '-') return undefined;
  if (['likör', 'likoer', 'likor', 'l'].includes(value)) return 'likoer';
  if (['schnaps', 's'].includes(value)) return 'schnaps';
  throw new Error(`Kennzeichnung: Bitte „Likör“, „Schnaps“ oder eine leere Zelle verwenden (gefunden „${text(v)}“).`);
}
const spiritLabel = (v: Product['spiritType']) => v === 'likoer' ? 'Likör' : v === 'schnaps' ? 'Schnaps' : '';
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
function number(v: unknown, label: string, fallback?: number): number {
  if (empty(v) && fallback !== undefined) return fallback;
  const raw = typeof v === 'number' ? v : /^\d+(?:[.,]\d{1,2})?$/.test(text(v)) ? Number(text(v).replace(',', '.')) : NaN;
  if (!Number.isFinite(raw) || raw < 0 || raw > 99999 || Math.abs(raw * 100 - Math.round(raw * 100)) > 1e-6) throw new Error(`${label}: ungültiger Wert „${text(v)}“.`);
  return raw;
}
function bool(v: unknown, fallback: boolean): boolean {
  if (empty(v)) return fallback;
  if ([true, 1, 'ja', 'true'].includes(typeof v === 'string' ? v.toLowerCase() : v as boolean)) return true;
  if ([false, 0, 'nein', 'false'].includes(typeof v === 'string' ? v.toLowerCase() : v as boolean)) return false;
  throw new Error(`Ungültiger Ja/Nein-Wert „${text(v)}“.`);
}
function tax(v: unknown, location: Location, fallback?: number): number {
  const n = number(v, `Steuer ${location}`, fallback);
  if (!(location === 'Friedrichshafen' ? [0, 7, 19] : [0, 10, 13, 20]).includes(n)) throw new Error(`Nicht unterstützter Steuersatz ${n}% für ${location}.`);
  return n;
}
function match<T extends {id: string; name: string}>(items: T[], rawId: unknown, name: string, key = normalizeName): T | undefined {
  if (!empty(rawId)) {
    const byId = items.find(x => x.id === text(rawId));
    if (!byId) throw new Error(`Unbekannte ID „${text(rawId)}“. Für neue Einträge ID leer lassen.`);
    return byId;
  }
  const matches = items.filter(x => key(x.name) === key(name));
  if (matches.length > 1) throw new Error(`Name „${name}“ ist mehrdeutig. Bitte ID aus dem Export verwenden.`);
  return matches[0];
}
const shotKey = (v: unknown) => normalizeName(text(v).replace(/\(schuss\)/ig, '').replace(/[()]/g, ''));
function table(rows: unknown[][], required: string): { index: number; records: Record<string, unknown>[] } | null {
  const index = rows.findIndex(r => r.some(c => text(c) === required));
  if (index < 0) return null;
  const headers = rows[index].map(text);
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new Error('Doppelte Spaltenüberschrift.');
  return { index, records: rows.slice(index + 1).filter(r => r.some(c => !empty(c))).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]]))) };
}
export function buildImportPlan(sheets: SheetRows, base: LocalCatalog, archive: ImageEntry[] = []): ImportPlan {
  const next: LocalCatalog = structuredClone(base);
  const plan: ImportPlan = { base: structuredClone(base), next, rows: [], errors: [], warnings: [], images: {}, removed: [], unmatched: [] };
  const seen = new Set<string>();
  const matchedOld = new Set<string>();
  const names = new Set<string>();
  const uniqueName = (key: string) => { if (names.has(key)) throw new Error('Doppelter Name innerhalb derselben Warengruppe.'); names.add(key); };
  const catName = (id: unknown) => [...next.categories, ...base.categories].find(c => c.id === id)?.name ?? String(id ?? '—');
  const label: Record<string, string> = { name: 'Name', categoryId: 'Warengruppe', prices: 'Preis', taxRates: 'Steuer', taxClass: 'Steuerklasse', available: 'Verfügbar', sortOrder: 'Sortierung', hasShot: 'Schuss', pfand: 'Pfand', isPfandArticle: 'Pfandartikel', hasIndividualPrice: 'Preisart', shotPrices: 'Schusspreise', imageUrl: 'Bild', price: 'Preis', spiritType: 'Kennzeichnung', color: 'Farbe', icon: 'Symbol' };
  const tagOf: Record<string, string> = { name: 'Name', categoryId: 'Gruppe', prices: 'Preis', price: 'Preis' };
  const show = (k: string, v: unknown) => v === undefined ? '—' : k === 'spiritType' ? spiritLabel(v as Product['spiritType']) : k === 'categoryId' ? catName(v) : k === 'prices' && v && typeof v === 'object' ? Object.values(v as Record<string, number>).join(' / ') : stableStringify(v).replace(/^"|"$/g, '');
  function record(kind: string, value: {id: string; name?: string}, before: unknown, image?: string) {
    const key = `${kind}:${value.id}`;
    if (seen.has(key)) throw new Error(`Doppelter Eintrag „${value.name ?? value.id}“.`);
    seen.add(key);
    const old = before as Record<string, unknown> | undefined;
    const diff: [string, unknown][] = Object.entries(value).filter(([k, v]) => stableStringify(v) !== stableStringify(old?.[k]));
    // A removed Kennzeichnung must also appear in the preview.
    if (old?.spiritType !== undefined && !('spiritType' in value)) diff.push(['spiritType', undefined]);
    const changes = diff.map(([k, v]) => `${label[k] ?? k}: ${show(k, old?.[k])} → ${show(k, v)}`);
    const tags = [...new Set(diff.map(([k]) => tagOf[k]).filter(Boolean))];
    plan.rows.push({id: value.id, kind, name: value.name ?? value.id, status: !before ? 'neu' : changes.length || image ? 'geändert' : 'unverändert', changes, image, tags: !before ? ['neu'] : tags});
  }
  const upsert = <T extends {id: string}>(items: T[], value: T) => { const i = items.findIndex(x => x.id === value.id); if (i < 0) items.push(value); else items[i] = value; };
  const protect = (context: string, action: () => void) => { try { action(); } catch (e) { plan.errors.push(`${context}: ${(e as Error).message}`); } };
  // Exported category metadata is imported before products, including empty groups.
  if (sheets.Warengruppen) protect('Warengruppen', () => {
    const t = table(sheets.Warengruppen, 'Warengruppe');
    if (!t) throw new Error('Kopfzeile fehlt.');
    t.records.forEach((r, i) => protect(`Warengruppe Zeile ${i + 2}`, () => {
      const name = text(r.Warengruppe); if (!name) throw new Error('Name fehlt.');
      if (normalizeName(name) === 'schuss') { if (!empty(r.ID) && text(r.ID) !== SHOT_CATEGORY_ID) throw new Error('SCHUSS ist eine geschützte Systemgruppe.'); return; }
      if (text(r.ID) === SHOT_CATEGORY_ID) throw new Error('Die SCHUSS-Systemgruppe darf nicht umbenannt werden.');
      uniqueName(`category:${normalizeName(name)}`);
      const old = match(base.categories, r.ID, name);
      const c: Category = { id: old?.id ?? id('cat'), name, icon: text(r.Icon) || old?.icon || 'Package', color: text(r.Farbe) || old?.color || 'from-cyan-500 to-blue-600', sortOrder: number(r.Sortierung, 'Sortierung', old?.sortOrder ?? next.categories.length) };
      record('Warengruppe', c, old); upsert(next.categories, c);
    }));
  });
  let found = false;
  for (const [sheet, rows] of Object.entries(sheets)) {
    if (sheet === 'Warengruppen' || sheet === 'Einstellungen' || sheet === 'Pfand') continue;
    protect(sheet, () => {
      const t = table(rows, 'Produktname App'); if (!t) return; found = true;
      // Original 2026 layout: the two global deposits precede the header.
      for (const loc of locations) {
        const settings = rows.slice(0, t.index).filter(r => text(r[0]) === loc);
        if (settings.length > 1) throw new Error(`Pfand ${loc} mehrfach angegeben.`);
        if (settings.length) next.pfandSettings[loc] = number(settings[0][1], `Pfand ${loc}`);
      }
      // Step 1: find the existing article for every row (ID, then same group, then any group).
      // Articles that moved to another Warengruppe are moved, not duplicated.
      // Identical duplicate rows are ignored; same name with different values stays an error (see uniqueName).
      const rowSignatures = new Set<string>();
      const records = t.records.filter(r => {
        const sig = JSON.stringify(Object.entries(r).map(([k, v]) => [k, text(v)]));
        if (rowSignatures.has(sig)) { plan.warnings.push(`${fixSpelling(text(r['Produktname App']))}: doppelte, identische Zeile in der Excel ignoriert.`); return false; }
        rowSignatures.add(sig); return true;
      });
      const ambiguousRows = new Set<number>();
      const infos = records.map(r => ({ name: fixSpelling(text(r['Produktname App'])), group: text(r.Warengruppe), id: r.ID }));
      const usable = (x: { name: string; group: string }) => !!x.name && !!x.group && normalizeName(x.group) !== 'schuss';
      const pre: (Product | undefined)[] = infos.map(info => {
        if (!usable(info)) return undefined;
        if (!empty(info.id)) { const byId = base.products.find(x => x.id === text(info.id)); if (byId) matchedOld.add(byId.id); return byId; }
        const baseCat = base.categories.find(c => normalizeName(c.name) === normalizeName(info.group));
        if (!baseCat) return undefined;
        const same = base.products.filter(x => x.categoryId === baseCat.id && !matchedOld.has(x.id) && normalizeName(fixSpelling(x.name)) === normalizeName(info.name));
        if (same.length === 1) matchedOld.add(same[0].id);
        if (same.length > 1) ambiguousRows.add(infos.indexOf(info));
        return same.length === 1 ? same[0] : undefined;
      });
      const sameArticle = (a: string, b: string) => { const x = parseName(a), y = parseName(b); return x.kind === y.kind && x.size === y.size && nearlySame(x.key, y.key); };
      infos.forEach((info, i) => {
        if (pre[i] || !empty(info.id) || !usable(info)) return;
        const cands = base.products.filter(x => x.categoryId !== SHOT_CATEGORY_ID && !matchedOld.has(x.id) && sameArticle(x.name, info.name));
        let pick = cands.length === 1 ? cands[0] : undefined;
        if (cands.length > 1) {
          const stem = (v: string) => normalizeName(v.replace(/\(.*\)/, ''));
          const close = cands.filter(x => stem(base.categories.find(c => c.id === x.categoryId)?.name ?? '') === stem(info.group));
          if (close.length === 1) pick = close[0];
          else plan.warnings.push(`${info.name}: mehrere ähnliche Artikel im bisherigen Katalog; wird als neuer Artikel behandelt.`);
        }
        if (pick) { pre[i] = pick; matchedOld.add(pick.id); }
      });
      records.forEach((r, i) => protect(`${sheet}, Datenzeile ${i + 1}`, () => {
        const name = infos[i].name; const group = infos[i].group;
        if (!name || !group) throw new Error('Artikelname oder Warengruppe fehlt.');
        const isShot = normalizeName(group) === 'schuss';
        const priceKind = text(field(r, 'Preis fix / individuell', 'Preis durch Mitarbeiter oder fix')).toLocaleLowerCase('de-DE');
        if (!['fix', 'individuell eintragen', 'individuell'].includes(priceKind)) throw new Error('Preisart muss „fix“ oder „individuell“ sein.');
        if (isShot && priceKind !== 'fix') throw new Error('SCHUSS benötigt einen festen Preis.');
        const oldShot = isShot ? match(base.shotOptions, r.ID, name, shotKey) : undefined;
        let category = next.categories.find(c => normalizeName(c.name) === normalizeName(group));
        if (!isShot && next.categories.filter(c => normalizeName(c.name) === normalizeName(group)).length > 1) throw new Error(`Warengruppe „${group}“ mehrdeutig.`);
        if (!category && !isShot) {
          category = { id: id('cat'), name: group, icon: 'Package', color: 'from-cyan-500 to-blue-600', sortOrder: next.categories.length };
          next.categories.push(category); record('Warengruppe', category, undefined);
        }
        uniqueName(isShot ? `shot:${shotKey(name)}` : `product:${category!.id}:${normalizeName(name)}`);
        if (ambiguousRows.has(i)) throw new Error(`Name „${name}“ ist mehrdeutig. Bitte ID aus dem Export verwenden.`);
        const old = !isShot ? pre[i] : undefined;
        if (!isShot && !empty(r.ID) && !old) throw new Error(`Unbekannte ID „${text(r.ID)}“. Für neue Einträge ID leer lassen.`);
        if (old?.categoryId === SHOT_CATEGORY_ID) throw new Error('Normaler Artikel darf nicht in SCHUSS umgewandelt werden.');
        const individual = priceKind === 'individuell eintragen' || priceKind === 'individuell';
        const shared = number(field(r, 'VK', 'VK 2026'), 'Grundpreis', individual ? old?.prices.Friedrichshafen ?? 0 : oldShot?.price);
        const prices = { Friedrichshafen: number(r['VK DE'], 'VK DE', shared), Bregenz: number(r['VK AT'], 'VK AT', shared) };
        const rates = { Friedrichshafen: tax(r['Steuer DE in %'], 'Friedrichshafen', old ? taxRateForProduct(old, 'Friedrichshafen') : undefined), Bregenz: tax(r['Steuer AT in %'], 'Bregenz', old ? taxRateForProduct(old, 'Bregenz') : undefined) };
        if (isShot) {
          if (rates.Friedrichshafen !== 19 || rates.Bregenz !== 20) throw new Error('SCHUSS wird über den Basisartikel versteuert; erwartet werden 19% DE / 20% AT.');
          const value: ShotOption = { ...oldShot, id: oldShot?.id ?? id('shot'), name: oldShot && empty(r.ID) ? oldShot.name : name, price: shared };
          const overrides: Partial<Record<Location, number>> = {};
          for (const loc of locations) if (!empty(r[loc === 'Friedrichshafen' ? 'VK DE' : 'VK AT'])) overrides[loc] = prices[loc];
          if (Object.keys(overrides).length) value.locationPrices = overrides; else delete value.locationPrices;
          record('SCHUSS', value, oldShot); upsert(next.shotOptions, value); return;
        }
        const inferredClass: TaxClass = rates.Friedrichshafen === 0 ? 'zero' : rates.Friedrichshafen === 7 ? 'reduced' : 'standard';
        const cls = (text(r.Steuerklasse) || inferredClass) as TaxClass;
        if (!['standard','reduced','zero'].includes(cls)) throw new Error('Ungültige Steuerklasse.');
        const p: Product = { ...old, id: old?.id ?? id('p'), name, categoryId: category!.id, imageUrl: old?.imageUrl ?? '', taxClass: cls,
          prices, taxRates: rates, available: bool(r.Verfügbar, old?.available ?? true), sortOrder: number(r.Sortierung, 'Sortierung', old?.sortOrder ?? next.products.length),
          hasShot: hasField(r, 'Schuss') ? flag(r.Schuss, 'Schuss') : bool(r['Schuss erlaubt'], old?.hasShot ?? false), hasIndividualPrice: individual,
          isPfandArticle: hasField(r, 'Pfand') ? flag(r.Pfand, 'Pfand') : bool(r.Pfandartikel, old?.isPfandArticle ?? false), pfand: { Friedrichshafen: number(r['Pfand DE'], 'Pfand DE', old?.pfand.Friedrichshafen ?? 0), Bregenz: number(r['Pfand AT'], 'Pfand AT', old?.pfand.Bregenz ?? 0) } };
        if (!empty(r.Schusspreise)) {
          const parsed: unknown = JSON.parse(text(r.Schusspreise));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Schusspreise müssen ein JSON-Objekt sein.');
          p.shotPrices = Object.fromEntries(Object.entries(parsed).map(([k,v]) => [k, number(v, 'Schusspreis')]));
        }
        // Avoid rewriting legacy records merely to make implicit defaults explicit.
        if (!old?.taxRates && locations.every(loc => rates[loc] === taxRateForClass(cls, loc))) delete p.taxRates;
        if (old?.hasIndividualPrice === undefined && !p.hasIndividualPrice) delete p.hasIndividualPrice;
        if (old?.isPfandArticle === undefined && !p.isPfandArticle) delete p.isPfandArticle;
        if (old?.shotPrices === undefined && p.shotPrices && !Object.keys(p.shotPrices).length) delete p.shotPrices;
        // Kennzeichnung only changes when the column exists (older Excel files keep the current value).
        if (hasField(r, 'Kennzeichnung')) {
          const kind = spiritType(r.Kennzeichnung);
          if (kind) p.spiritType = kind; else delete p.spiritType;
        }
        const imageUrl = text(r.Bild);
        // The exported Bild column only fills gaps. An existing real image is never reverted by an
        // older address in the Excel (the file may be older than the last import); ZIP images decide instead.
        if (imageUrl && imageUrl !== p.imageUrl) {
          if (!/^(https?:\/\/|\/[^/])/.test(imageUrl)) throw new Error('Bild muss eine HTTP(S)-URL oder ein lokaler Asset-Pfad sein.');
          if (!p.imageUrl || /[?&]woodmoIllustration=1(?:&|$)/.test(p.imageUrl)) p.imageUrl = imageUrl;
        }
        // Images from the ZIP always win over existing images.
        let image: string | undefined;
        if (archive.length) {
          const found = bestImage(name, group, archive, p.spiritType ?? '');
          if (found.ambiguous.length) {
            plan.warnings.push(`${name}: mehrere gleich gute ZIP-Bilder gefunden (${found.ambiguous.map(f => f.path).join(', ')}). Bild nicht zugeordnet; bitte Bildnamen eindeutig machen.`);
          } else if (found.file) {
            plan.images[p.id] = found.file;
            image = found.file.path;
          } else if (!p.imageUrl || /[?&]woodmoIllustration=1(?:&|$)/.test(p.imageUrl)) {
            const hint = imageSuggestions(name, group, archive);
            plan.warnings.push(`${name}: kein passendes ZIP-Bild; es wird ein eigenes Symbol erzeugt.${hint.length ? ` Ähnliche Dateien (nicht übernommen): ${hint.join(', ')}.` : ''}`);
          }
        }
        record('Artikel', p, old, image); upsert(next.products, p);
      }));
    });
  }
  if (!found) plan.errors.push('Keine Tabelle mit der Kopfzeile „Produktname App“ gefunden.');
  // Pfand je Standort: Blatt „Pfand“ (neu) oder „Einstellungen“ (ältere Exporte).
  const pfandSheet = sheets.Pfand ?? sheets.Einstellungen;
  if (pfandSheet) protect(sheets.Pfand ? 'Pfand' : 'Einstellungen', () => {
    const t = table(pfandSheet, 'Standort'); if (!t) throw new Error('Kopfzeile fehlt.');
    const used = new Set<string>();
    for (const r of t.records) {
      const loc = text(r.Standort) as Location;
      if (!locations.includes(loc) || used.has(loc)) throw new Error('Ungültiger oder doppelter Standort.');
      used.add(loc); next.pfandSettings[loc] = number(r.Pfand, 'Globaler Pfand');
    }
  });
  for (const loc of locations) if (base.pfandSettings[loc] !== next.pfandSettings[loc]) plan.rows.push({kind: 'Pfandeinstellung', name: loc, status: 'geändert', changes: [`${base.pfandSettings[loc]} → ${next.pfandSettings[loc]}`]});
  // Keep effective deposits coherent for existing and newly imported deposit articles.
  for (const p of next.products) if (p.isPfandArticle) {
    const old = base.products.find(x => x.id === p.id);
    const before = structuredClone(p); p.pfand = { ...next.pfandSettings };
    const preview = plan.rows.find(r => r.kind === 'Artikel' && r.id === p.id);
    if (stableStringify(before.pfand) !== stableStringify(p.pfand)) {
      if (preview) { preview.status = old ? 'geändert' : 'neu'; preview.changes.push(`Pfand (global): ${stableStringify(p.pfand)}`); }
      else record('Artikel', p, old);
    }
  }
  { const used = new Set(Object.values(plan.images).map(i => i.path)); plan.unmatched = archive.map(f => f.path).filter(path => !used.has(path) && !/(^|\/)schuss(\/|$)|\(\s*schuss\s*\)\.[a-z0-9]+$/i.test(path)); }
  if (!validShots(next.shotOptions)) plan.errors.push('SCHUSS-Einstellungen enthalten ungültige oder doppelte Sorten.');
  next.categories = normalizeCategories(next.categories);
  // Articles missing from the new file are deleted (the file is the truth). Shot options are never deleted.
  if (found && !plan.errors.length) {
    const groupOf = (id: string) => base.categories.find(c => c.id === id)?.name ?? '';
    for (const p of base.products) {
      if (matchedOld.has(p.id) || p.categoryId === SHOT_CATEGORY_ID) continue;
      next.products = next.products.filter(x => x.id !== p.id);
      plan.removed.push({ kind: 'Artikel', id: p.id, name: p.name, group: groupOf(p.categoryId) });
      plan.rows.push({ id: p.id, kind: 'Artikel', name: p.name, status: 'entfernt', changes: [`Fehlt in der neuen Excel (Warengruppe ${groupOf(p.categoryId)}) – wird gelöscht.`], tags: ['entfernt'] });
    }
    for (const c of base.categories) {
      if (c.id === SHOT_CATEGORY_ID || seen.has(`Warengruppe:${c.id}`)) continue;
      const had = base.products.some(p => p.categoryId === c.id);
      if (!had || next.products.some(p => p.categoryId === c.id)) continue;
      next.categories = next.categories.filter(x => x.id !== c.id);
      plan.removed.push({ kind: 'Warengruppe', id: c.id, name: c.name });
      plan.rows.push({ id: c.id, kind: 'Warengruppe', name: c.name, status: 'entfernt', changes: ['Keine Artikel mehr in dieser Warengruppe – wird gelöscht.'], tags: ['entfernt'] });
    }
  }
  for (const s of base.shotOptions) if (!seen.has(`SCHUSS:${s.id}`)) plan.rows.push({kind: 'SCHUSS', name: s.name, status: 'unverändert', changes: ['Nicht in der Datei; bleibt erhalten.']});
  return plan;
}

function zipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6) || (bytes[2] === 7 && bytes[3] === 8));
}
function validImageSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/png') return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/webp') return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  if (mime === 'image/bmp') return bytes.length >= 2 && bytes[0] === 66 && bytes[1] === 77;
  return false;
}
export async function readWorkbook(bytes: ArrayBuffer): Promise<SheetRows> {
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Excel-Datei ist größer als 10 MB.');
  if (!zipSignature(new Uint8Array(bytes))) throw new Error('Ungültige Excel-Datei. Bitte eine echte .xlsx-Datei auswählen.');
  // Bound decompressed XML before passing the archive to the workbook parser.
  let total = 0; let count = 0; let failed: Error | null = null;
  const check = new Unzip(file => {
    if (++count > 1000) throw new Error('Excel-Datei enthält zu viele ZIP-Einträge.');
    file.ondata = (error, chunk) => {
      if (error) { failed = error; return; }
      total += chunk.length;
      if (total > 80 * 1024 * 1024) { file.terminate(); throw new Error('Excel-Datei entpackt größer als 80 MB.'); }
    };
    file.start();
  });
  check.register(UnzipInflate); check.push(new Uint8Array(bytes), true);
  if (failed) throw failed;
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes); }
  catch { throw new Error('Die ausgewählte Datei ist keine gültige Excel-Arbeitsmappe (.xlsx). Bitte die richtige Datei auswählen.'); }
  const sheets: SheetRows = {};
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > 10000 || sheet.columnCount > 80) throw new Error('Excel-Tabelle überschreitet 10.000 Zeilen oder 80 Spalten.');
    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: true }, row => {
      const cells: unknown[] = [];
      row.eachCell({includeEmpty: true}, (cell, n) => {
        const v = cell.value;
        if (v && typeof v === 'object') throw new Error(`${sheet.name}!${cell.address}: Formeln und komplexe Zellwerte sind nicht erlaubt. Bitte als Werte speichern.`);
        cells[n - 1] = v;
      }); rows.push(cells);
    }); sheets[sheet.name] = rows;
  }
  return sheets;
}
export async function exportTemplateWorkbook(): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Preisliste');
  sheet.addRow(['Artikel_Verkaufspreise_2026']);
  sheet.addRow(['', 'Pfand']);
  sheet.addRow(['Friedrichshafen', 1]);
  sheet.addRow(['Bregenz', 2]);
  sheet.addRow([]);
  sheet.addRow(['Produktname App', 'VK', 'Warengruppe', 'Preis fix / individuell', 'Steuer DE in %', 'Steuer AT in %', 'Schuss', 'Pfand']);
  sheet.addRow(['Glühwein Rot', 4.5, 'Getränke', 'fix', 19, 20, 'x', 'x']);
  sheet.addRow(['Glühwein Weiß', 4.5, 'Getränke', 'fix', 19, 20, 'x', 'x']);
  sheet.addRow(['Küchenbretter', 0, 'Handwerk', 'individuell', 19, 20, '', '']);
  sheet.getRow(6).font = {bold: true};
  sheet.columns.forEach(column => {column.width = 24;});
  return await workbook.xlsx.writeBuffer() as ArrayBuffer;
}
/**
 * Simple export in the layout of the 2026 price list: deposit rows on top, the 8 familiar columns, no IDs.
 * Columns "VK DE / VK AT" are added only when prices differ between the two locations.
 * The importer recognizes articles by name; hidden settings (availability, order, images) stay as they are.
 */
export async function exportSimpleWorkbook(catalog: LocalCatalog): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Preisliste');
  const differs = catalog.products.some(p => p.prices.Friedrichshafen !== p.prices.Bregenz) ||
    catalog.shotOptions.some(s => s.locationPrices && Object.keys(s.locationPrices).length > 0);
  const headers = ['Produktname App', 'VK', 'Warengruppe', 'Preis fix / individuell', 'Steuer DE in %', 'Steuer AT in %', 'Schuss', 'Pfand', ...(differs ? ['VK DE', 'VK AT'] : [])];
  sheet.addRow(['Artikel_Verkaufspreise_2026']);
  sheet.addRow(['', 'Pfand']);
  sheet.addRow(['Friedrichshafen', catalog.pfandSettings.Friedrichshafen]);
  sheet.addRow(['Bregenz', catalog.pfandSettings.Bregenz]);
  sheet.addRow([]);
  sheet.addRow(headers);
  const categories = [...catalog.categories].filter(c => c.id !== SHOT_CATEGORY_ID).sort((a, b) => a.sortOrder - b.sortOrder);
  for (const c of categories) {
    for (const p of catalog.products.filter(x => x.categoryId === c.id).sort((a, b) => a.sortOrder - b.sortOrder)) {
      sheet.addRow([p.name, p.hasIndividualPrice ? '' : p.prices.Friedrichshafen, c.name, p.hasIndividualPrice ? 'individuell' : 'fix',
        taxRateForProduct(p, 'Friedrichshafen'), taxRateForProduct(p, 'Bregenz'), p.hasShot ? 'x' : '', p.isPfandArticle ? 'x' : '',
        ...(differs ? [p.prices.Friedrichshafen, p.prices.Bregenz] : [])]);
    }
  }
  for (const shot of catalog.shotOptions) {
    sheet.addRow([`${shot.name} (Schuss)`, shot.price, 'SCHUSS', 'fix', 19, 20, '', '',
      ...(differs ? [shot.locationPrices?.Friedrichshafen ?? '', shot.locationPrices?.Bregenz ?? ''] : [])]);
  }
  sheet.getRow(6).font = {bold: true};
  sheet.columns.forEach(column => {column.width = 24;});
  return await workbook.xlsx.writeBuffer() as ArrayBuffer;
}
export async function exportWorkbook(catalog: LocalCatalog): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const add = (name: string, rows: unknown[][]) => {
    const sheet = workbook.addWorksheet(name);
    rows.forEach(row => sheet.addRow(row));
    sheet.columns.forEach(column => {column.width = 22;});
    return sheet;
  };
  const headers = ['Produktname App', 'VK', 'Warengruppe', 'Preis fix / individuell',
    'Steuer DE in %', 'Steuer AT in %', 'Schuss', 'Pfand',
    'ID', 'VK DE', 'VK AT', 'Pfand DE', 'Pfand AT', 'Verfügbar',
    'Sortierung', 'Bild', 'Steuerklasse', 'Schusspreise', 'Kennzeichnung'];
  const rows: unknown[][] = [
    ['Artikel_Verkaufspreise_2026'],
    ['', 'Pfand'],
    ['Friedrichshafen', catalog.pfandSettings.Friedrichshafen],
    ['Bregenz', catalog.pfandSettings.Bregenz],
    [],
    headers,
    ...catalog.products.map(p => [
      p.name, p.prices.Friedrichshafen,
      catalog.categories.find(c => c.id === p.categoryId)?.name ?? '',
      p.hasIndividualPrice ? 'individuell' : 'fix',
      taxRateForProduct(p, 'Friedrichshafen'), taxRateForProduct(p, 'Bregenz'),
      p.hasShot ? 'x' : '', p.isPfandArticle ? 'x' : '',
      p.id, p.prices.Friedrichshafen, p.prices.Bregenz,
      p.pfand.Friedrichshafen, p.pfand.Bregenz, p.available,
      p.sortOrder, p.imageUrl, p.taxClass, JSON.stringify(p.shotPrices ?? {}), spiritLabel(p.spiritType)
    ])
  ];
  const sheet = add('Preisliste', rows);
  sheet.getRow(6).font = {bold: true};
  add('SCHUSS', [
    ['ID', 'Produktname App', 'Warengruppe', 'VK', 'VK DE', 'VK AT',
      'Preis fix / individuell', 'Steuer DE in %', 'Steuer AT in %'],
    ...catalog.shotOptions.map(shot => [
      shot.id, shot.name, 'SCHUSS', shot.price,
      shot.locationPrices?.Friedrichshafen ?? '',
      shot.locationPrices?.Bregenz ?? '', 'fix', 19, 20
    ])
  ]);
  add('Warengruppen', [
    ['ID', 'Warengruppe', 'Icon', 'Farbe', 'Sortierung'],
    ...catalog.categories.map(c => [c.id, c.name, c.icon, c.color, c.sortOrder])
  ]);
  add('Pfand', [
    ['Standort', 'Pfand'],
    ...locations.map(loc => [loc, catalog.pfandSettings[loc]])
  ]);
  return await workbook.xlsx.writeBuffer() as ArrayBuffer;
}

/** fflate exposes legacy CP437 ZIP entry names as byte-valued characters. */
const cp437High = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
function decodeZipPath(path: string): string {
  // Decode only legacy byte-valued paths. Already-correct Unicode paths remain intact.
  if (!/[\u0080-\u009f]/.test(path)) return path;
  return Array.from(path, char => {
    const n = char.charCodeAt(0);
    return n >= 128 && n <= 255 ? cp437High[n - 128] : char;
  }).join('');
}

/** Streaming decompression with limits checked BEFORE accepting each output chunk. */
export function readImageZip(bytes: Uint8Array): ImageEntry[] {
  if (bytes.length > 100 * 1024 * 1024) throw new Error('ZIP ist größer als 100 MB.');
  if (!zipSignature(bytes)) throw new Error('Ungültige Bilder-ZIP. Bitte eine echte .zip-Datei mit Produktbildern auswählen.');
  const result: ImageEntry[] = []; let total = 0; let entries = 0; let failure: Error | null = null;
  const unzip = new Unzip(file => {
    const decodedPath = decodeZipPath(file.name);
    if (++entries > 1000) throw new Error('ZIP enthält mehr als 1.000 Einträge.');
    if (decodedPath.endsWith('/') || decodedPath.startsWith('__MACOSX/') || /(^|\/)\./.test(decodedPath)) return;
    const ext = decodedPath.split('.').pop()?.toLowerCase();
    const mime = ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',bmp:'image/bmp'} as Record<string,string>)[ext ?? ''];
    if (!mime) return;
    let size = 0; const chunks: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (err) { failure = err; return; }
      size += chunk.length; total += chunk.length;
      if (size > 20 * 1024 * 1024 || total > 200 * 1024 * 1024) { file.terminate(); throw new Error('Ein Bild überschreitet die technische Verarbeitungsgrenze von 20 MB oder das entpackte Archiv überschreitet 200 MB.'); }
      chunks.push(chunk);
      if (final) { const data = new Uint8Array(size); let offset = 0; for (const c of chunks) {data.set(c,offset); offset += c.length;} if (!validImageSignature(data, mime)) { failure = new Error(`„${decodedPath}“ hat kein gültiges Bildformat (${ext}). Bitte das Bild neu speichern.`); return; } result.push({path:decodedPath,bytes:data,mime}); }
    }; file.start();
  }); unzip.register(UnzipInflate); unzip.push(bytes, true);
  if (failure) throw failure;
  if (!result.length) throw new Error('Die Bilder-ZIP enthält keine unterstützten Bilder (PNG, JPG, JPEG, WebP oder BMP).');
  return result;
}
