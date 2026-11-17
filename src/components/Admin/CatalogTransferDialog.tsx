import { Fragment, useState } from 'react';
import type { LocalCatalog } from '@/lib/catalogSync';
import type { CatalogImportSession } from '@/lib/catalogEngine';
import { buildImportPlan, exportWorkbook, exportSimpleWorkbook, exportTemplateWorkbook, readImageZip, readWorkbook, type ImageEntry, type ImportPlan } from '@/lib/catalogTransfer';
import { uploadArticleImage } from '@/lib/imageUpload';
import { supabase } from '@/lib/supabaseClient';
import { createCatalogIllustration } from '@/lib/catalogIllustration';
import { buildCatalogBundle, buildCatalogImagesZip } from '@/lib/catalogBundleExport';

const MAX_IMAGE_BYTES = 500 * 1024;
const MAX_IMAGE_SIDE = 800;

/**
 * Normalize each ZIP image before preview/commit: at most 800 px / 500 KB and always square.
 * Non-square images are placed on a square canvas without cropping (background = edge color
 * of the picture, transparent if the picture is transparent), so the product stays fully visible in the tile.
 */
async function prepareZipImage(image: ImageEntry): Promise<ImageEntry> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(image.bytes)], {type:image.mime}));
  } catch {
    throw new Error(`Bild „${image.path}“ konnte nicht geöffnet werden. Bitte eine gültige Bilddatei verwenden.`);
  }
  try {
    const isSquare = bitmap.width === bitmap.height;
    if (isSquare && image.bytes.byteLength <= MAX_IMAGE_BYTES && bitmap.width <= MAX_IMAGE_SIDE) return image;
    const factor = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    let side = Math.max(1, Math.round(Math.max(bitmap.width, bitmap.height) * factor));
    const drawW = Math.max(1, Math.round(bitmap.width * factor));
    const drawH = Math.max(1, Math.round(bitmap.height * factor));
    // Edge color: average of the four corners; transparent images stay transparent.
    let fill: string | null = null;
    if (!isSquare) {
      const probe = document.createElement('canvas');
      probe.width = bitmap.width; probe.height = bitmap.height;
      const pctx = probe.getContext('2d', { willReadFrequently: true });
      if (pctx) {
        pctx.drawImage(bitmap, 0, 0);
        const corners = [[0,0],[bitmap.width-1,0],[0,bitmap.height-1],[bitmap.width-1,bitmap.height-1]].map(([x,y]) => pctx.getImageData(x, y, 1, 1).data);
        if (corners.every(c => c[3] > 250)) {
          const avg = [0,1,2].map(i => Math.round(corners.reduce((sum, c) => sum + c[i], 0) / 4));
          fill = `rgb(${avg[0]}, ${avg[1]}, ${avg[2]})`;
        }
      }
    }
    for (let attempt = 0; attempt < 12; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = side; canvas.height = side;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Bildkonvertierung nicht verfügbar.');
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, side, side); }
      const scale = side / Math.max(drawW, drawH);
      const w = Math.max(1, Math.round(drawW * scale)); const h = Math.max(1, Math.round(drawH * scale));
      ctx.drawImage(bitmap, Math.round((side - w) / 2), Math.round((side - h) / 2), w, h);
      // WebP preserves transparent product backgrounds and usually compresses well.
      const quality = Math.max(0.42, 0.88 - (attempt % 4) * 0.15);
      let blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality));
      if (!blob || blob.type !== 'image/webp') {
        blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      }
      if (blob && blob.size <= MAX_IMAGE_BYTES) {
        return {path:image.path, bytes:new Uint8Array(await blob.arrayBuffer()), mime:blob.type};
      }
      if (attempt % 4 === 3) side = Math.max(1, Math.floor(side * 0.8));
    }
    throw new Error(`Bild „${image.path}“ konnte nicht unter 500 KB komprimiert werden.`);
  } finally {
    bitmap.close();
  }
}

export interface CatalogTransferProps {
  catalog: LocalCatalog;
  testMode: boolean;
  onPrepare: () => Promise<CatalogImportSession>;
  onCommit: (session: CatalogImportSession, next: LocalCatalog) => Promise<void>;
  onClose: () => void;
}
export function CatalogTransferDialog({ catalog, testMode, onPrepare, onCommit, onClose }: CatalogTransferProps) {
  const [excel, setExcel] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [zipSummary, setZipSummary] = useState('');
  const [generated, setGenerated] = useState<Record<string, {url:string; bytes:Uint8Array}>>({});
  const [confirmedDelete, setConfirmedDelete] = useState(false);
  const [autoIllustrations, setAutoIllustrations] = useState(true);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [session, setSession] = useState<CatalogImportSession | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<{done:number;total:number;stage:string} | null>(null);
  const [message, setMessage] = useState('');
  const [importError, setImportError] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [fileError, setFileError] = useState('');
  const [done, setDone] = useState(false);
  const invalidate = () => {setGenerated({});setZipSummary('');setPlan(null); setSession(null); setConfirmed(false); setConfirmedDelete(false); setDone(false); setImportError(''); setImportProgress(null); setLog([]); setMessage('');};
  const stale = session && JSON.stringify(session.base) !== JSON.stringify(catalog);
  function chooseFile(file: File | null, kind: 'excel' | 'zip') {
    invalidate();
    if (!file) {
      if (kind === 'excel') setExcel(null); else setZip(null);
      return;
    }
    const expected = kind === 'excel' ? '.xlsx' : '.zip';
    const limit = kind === 'excel' ? 10 : 100;
    if (!file.name.toLocaleLowerCase('de-DE').endsWith(expected)) {
      if (kind === 'excel') setExcel(null); else setZip(null);
      setFileError(`Falsches Dateiformat: Für ${kind === 'excel' ? 'Excel' : 'Bilder'} bitte eine ${expected}-Datei auswählen. „${file.name}“ wurde nicht übernommen.`);
      return;
    }
    if (file.size > limit * 1024 * 1024) {
      if (kind === 'excel') setExcel(null); else setZip(null);
      setFileError(`„${file.name}“ ist zu groß. Maximum: ${limit} MB.`);
      return;
    }
    if (kind === 'excel') setExcel(file); else setZip(file);
  }
  async function preview() {
    if (!excel) return;
    setBusy(true); invalidate();
    try {
      if (excel.size > 10 * 1024 * 1024) throw new Error('Excel-Datei ist größer als 10 MB.');
      if (zip && zip.size > 100 * 1024 * 1024) throw new Error('ZIP ist größer als 100 MB.');
      const sheets = await readWorkbook(await excel.arrayBuffer());
      const sourceImages = zip ? readImageZip(new Uint8Array(await zip.arrayBuffer())) : [];
      const images: ImageEntry[] = [];
      for (const image of sourceImages) images.push(await prepareZipImage(image));
      const counts = new Map<string, number>();
      for (const image of images) { const folder = image.path.includes('/') ? image.path.split('/')[0] : '(Hauptordner)'; counts.set(folder, (counts.get(folder) ?? 0) + 1); }
      setZipSummary(zip ? `ZIP „${zip.name}“: ${images.length} Bilder erkannt (${Array.from(counts, ([folder, count]) => `${folder}: ${count}`).join(', ') || 'keine Bilddateien'}).` : 'Keine ZIP-Datei ausgewählt.');
      const snapshot = testMode ? {base: structuredClone(catalog), cloud: []} : await onPrepare();
      setSession(snapshot); setPlan(buildImportPlan(sheets, snapshot.base, images));
    } catch (e) {setFileError((e as Error).message);} finally {setBusy(false);}
  }
  async function generateImage(productId: string, name: string) {
    if (!supabase || !plan || busy || testMode || generated[productId]) return;
    setBusy(true); setMessage('');
    try {
      const {data,error} = await supabase.functions.invoke('generate-catalog-image',{body:{name}});
      if (error || !data?.image || data.mime !== 'image/png') throw new Error('KI-Bilddienst nicht eingerichtet oder nicht erreichbar.');
      const binary = atob(data.image as string);
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      const blob = new Blob([new Uint8Array(bytes)],{type:'image/png'});
      const url = URL.createObjectURL(blob);
      setGenerated(prev => ({...prev,[productId]:{url,bytes}}));
    } catch (e) {setMessage((e as Error).message);}
    finally {setBusy(false);}
  }
  function discardGenerated(productId: string) {
    const item = generated[productId];
    if (item) URL.revokeObjectURL(item.url);
    setGenerated(prev => {const next={...prev};delete next[productId];return next;});
  }
  async function commit() {
    if (!plan || !session || !confirmed || (plan.removed.length && !confirmedDelete) || plan.errors.length || stale || testMode || busy || done) return;
    setBusy(true); setMessage(''); setImportError(''); setLog([]);
    const addLog = (line: string) => setLog(prev => [...prev, line]);
    const imageCount = Object.keys(plan.images).length + Object.keys(generated).length + (autoIllustrations ? plan.next.products.filter(p => !p.imageUrl && !plan.images[p.id] && !generated[p.id] && plan.rows.some(r => r.kind === 'Artikel' && r.id === p.id)).length : 0);
    const totalSteps = imageCount + 1;
    let completedSteps = 0;
    setImportProgress({done:0,total:totalSteps,stage:'Bilder vorbereiten'});
    let uploaded = 0;
    try {
      const next = structuredClone(plan.next);
      // Validate and decode each image. Unique object names preserve old storage objects.
      for (const [productId, image] of Object.entries(plan.images)) {
        // Images were already validated and resized individually during preview.
        const file = new File([new Uint8Array(image.bytes)], image.path.split('/').pop()!, {type: image.mime});
        const articleName = next.products.find(p => p.id === productId)?.name ?? image.path;
        setImportProgress({done:completedSteps,total:totalSteps,stage:`Lade Bild hoch: ${articleName}`});
        const url = await uploadArticleImage(file);
        if (!url) throw new Error(`Bild „${image.path}“ konnte nicht hochgeladen werden. Katalog wurde nicht importiert. Bereits hochgeladene neue Bilder bleiben unreferenziert; vorhandene Bilder bleiben erhalten.`);
        uploaded++; completedSteps++; setImportProgress({done:completedSteps,total:totalSteps,stage:'ZIP-Bilder hochladen'});
        next.products.find(p => p.id === productId)!.imageUrl = url;
      }
      for (const [productId, generatedImage] of Object.entries(generated)) {
        const product = next.products.find(p => p.id === productId);
        if (!product || product.imageUrl) continue;
        const url = await uploadArticleImage(new File([new Uint8Array(generatedImage.bytes)], 'ki-bild.png', {type:'image/png'}));
        if (!url) throw new Error('KI-Bild konnte nicht gespeichert werden; Katalog wurde nicht importiert.');
        uploaded++; completedSteps++; setImportProgress({done:completedSteps,total:totalSteps,stage:'Bilder hochladen'}); product.imageUrl = url;
      }
      if (autoIllustrations) {
        for (const product of next.products) {
          if (product.imageUrl || plan.images[product.id] || generated[product.id]) continue;
          if (!plan.rows.some(r => r.kind === 'Artikel' && r.id === product.id)) continue;
          setImportProgress({done:completedSteps,total:totalSteps,stage:`Erzeuge Symbol: ${product.name}`});
          const illustration = await createCatalogIllustration(product.name);
          const url = await uploadArticleImage(illustration);
          if (!url) throw new Error(`Illustration für „${product.name}“ konnte nicht gespeichert werden.`);
          uploaded++; completedSteps++; setImportProgress({done:completedSteps,total:totalSteps,stage:'Illustrationen hochladen'}); product.imageUrl = `${url}${url.includes('?') ? '&' : '?'}woodmoIllustration=1`;
        }
      }
      setImportProgress({done:completedSteps,total:totalSteps,stage:'Speichere Katalog in der Datenbank …'});
      await onCommit(session, next);
      const isReal = (x: { changes: string[] }) => x.changes.some(c => !c.startsWith('Bild'));
      for (const r of plan.rows.filter(x => x.status === 'neu')) addLog(`✓ Füge ${r.kind === 'Warengruppe' ? 'Warengruppe' : 'Artikel'} hinzu: ${r.name}`);
      for (const r of plan.rows.filter(x => x.status === 'geändert' && isReal(x))) addLog(`✓ Erneuere ${r.kind === 'Warengruppe' ? 'Warengruppe' : r.kind === 'Artikel' ? 'Artikel' : r.kind}: ${r.name}${r.tags?.length ? ` (${r.tags.join(', ')})` : ''}`);
      for (const r of plan.removed) addLog(`✓ Lösche ${r.kind === 'Warengruppe' ? 'Warengruppe' : 'Artikel'}: ${r.name}`);
      const imageOnly = plan.rows.filter(x => x.status === 'geändert' && !isReal(x) && x.image).length;
      if (imageOnly) addLog(`✓ Erneuere Bilder: ${imageOnly} Artikel`);
      setImportProgress({done:totalSteps,total:totalSteps,stage:'Import abgeschlossen'});
      setDone(true); setConfirmed(false); setConfirmedDelete(false); setMessage(`Import abgeschlossen.${plan.removed.length ? ` ${plan.removed.length} Einträge gelöscht.` : ''}`);
    } catch (e) {
      setImportError(`${(e as Error).message}${uploaded ? ` ${uploaded} neue Bilddateien wurden hochgeladen und können unreferenziert sein. Vor erneutem Import synchronisieren und Vorschau neu erstellen.` : ''}`); setConfirmed(false);
      // After an uncertain network result, force a fresh cloud read rather than retrying stale data.
      setSession(null);
    } finally {setBusy(false);}
  }
  async function downloadTemplate() {
    setBusy(true); setMessage('');
    try {
      const bytes = await exportTemplateWorkbook();
      const url = URL.createObjectURL(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const a = document.createElement('a');
      a.href = url; a.download = 'WOODMO-Excel-Mustervorlage.xlsx'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {setMessage((e as Error).message);} finally {setBusy(false);}
  }
  async function download() {
    setBusy(true); setMessage('');
    try {
      const bytes = await exportSimpleWorkbook(catalog);
      const url = URL.createObjectURL(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const a = document.createElement('a'); a.href = url; a.download = `WOODMO-Katalog-${new Date().toLocaleDateString('en-CA')}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {setMessage((e as Error).message);} finally {setBusy(false);}
  }
  async function downloadFull() {
    setBusy(true); setMessage('');
    try {
      const bytes = await exportWorkbook(catalog);
      const url = URL.createObjectURL(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const a = document.createElement('a'); a.href = url; a.download = `WOODMO-Katalog-vollstaendig-${new Date().toLocaleDateString('en-CA')}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {setMessage((e as Error).message);} finally {setBusy(false);}
  }
  async function downloadImagesOnly() {
    setBusy(true); setMessage('');
    try {
      const result = await buildCatalogImagesZip(catalog, import.meta.env.VITE_SUPABASE_URL, stage => setMessage(stage));
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `WOODMO_Bilder_${new Date().toLocaleDateString('en-CA')}.zip`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMessage(`Bilder-ZIP gespeichert: ${result.exportedImages} echte Bilder. ${result.missingImages.length} nicht gesichert/ohne Bild. Details in FEHLENDE_BILDER.txt im ZIP. ${result.missingImages.slice(0, 5).join('; ')}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Bilder-ZIP konnte nicht erstellt werden.');
    } finally { setBusy(false); }
  }
  async function downloadBundle() {
    setBusy(true); setMessage('');
    try {
      const result = await buildCatalogBundle(catalog, stage => setMessage(stage));
      const blob = new Blob([new Uint8Array(result.bytes)], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `WOODMO_Katalog_mit_Bildern_${new Date().toLocaleDateString('en-CA')}.zip`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMessage(`Exportpaket erstellt: Excel und Bilder-ZIP mit ${result.exportedImages} Bildern. ${result.missingImages.length} Artikel ohne gesichertes Bild; Details in FEHLENDE_BILDER.txt im inneren ZIP. Zum Bearbeiten zuerst die äußere ZIP entpacken.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Katalogpaket konnte nicht erstellt werden.');
    } finally { setBusy(false); }
  }

  const button = 'rounded-xl border border-gray-400 px-4 py-2 disabled:opacity-40';
  const primary = 'rounded-xl bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-40';
  const groups = plan ? [
    { title: 'Neu angelegt', rows: plan.rows.filter(r => r.status === 'neu') },
    { title: 'Preis geändert', rows: plan.rows.filter(r => r.status === 'geändert' && r.tags?.includes('Preis')) },
    { title: 'Warengruppe gewechselt', rows: plan.rows.filter(r => r.status === 'geändert' && r.tags?.includes('Gruppe')) },
    { title: 'Name geändert (auch Rechtschreibung)', rows: plan.rows.filter(r => r.status === 'geändert' && r.tags?.includes('Name')) },
    { title: 'Bild aus dem ZIP', rows: plan.rows.filter(r => r.image) },
  ] : [];
  const removedArticles = plan?.removed.filter(r => r.kind === 'Artikel') ?? [];
  const removedGroups = plan?.removed.filter(r => r.kind === 'Warengruppe') ?? [];
  const unchanged = plan?.rows.filter(r => r.status === 'unverändert').length ?? 0;
  const importBlocked = !confirmed || (!!plan?.removed.length && !confirmedDelete) || busy || done || !session || !!stale || testMode || !!plan?.errors.length;
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="catalog-transfer-title">
    <div className="flex max-h-[94vh] w-full max-w-3xl flex-col rounded-2xl bg-white p-4 text-gray-900 shadow-2xl dark:bg-gray-800 dark:text-white">
      <div className="flex items-center justify-between gap-4"><h2 id="catalog-transfer-title" className="text-lg font-bold">Artikel per Excel ändern</h2>{!done && <button disabled={busy} onClick={onClose} className={button}>Schließen</button>}</div>
      {helpOpen && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="catalog-help-title">
        <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white p-5 text-gray-900 shadow-2xl dark:bg-gray-800 dark:text-white">
          <h3 id="catalog-help-title" className="text-lg font-bold">So geht’s</h3>
          <div className="mt-3 space-y-4 overflow-auto text-sm leading-relaxed">
            <div><p className="font-bold">1. Excel und Bilder holen</p><p>Unter „Aktuellen Stand exportieren“ auf „Excel + Bilder exportieren“ klicken und die ZIP-Datei entpacken.</p></div>
            <div><p className="font-bold">2. Excel bearbeiten</p><p>Preise, Namen und Warengruppen ändern oder Zeilen ergänzen. <strong>Eine gelöschte Zeile löscht den Artikel.</strong> Die Zeilen mit dem Pfand oben und die Spaltenüberschriften nicht verändern.</p></div>
            <div><p className="font-bold">3. Bilder austauschen (optional)</p><p>Neues Bild mit dem Namen des Artikels in den Ordner der Warengruppe legen, z. B. „Handwerk/Duftvase.jpg“. Den Hauptordner wieder als ZIP packen. Groß-/Kleinschreibung, Umlaute und kleine Tippfehler sind egal. (S) oder S bedeutet Schnaps, (L) oder L bedeutet Likör.</p></div>
            <div><p className="font-bold">4. Importieren</p><p>Unter „Neuen Stand importieren“ Excel und ZIP auswählen, „Vorschau erstellen“, Liste prüfen, bestätigen und „Jetzt importieren“. Vor dem Löschen vorher ein Backup machen.</p></div>
            <p className="rounded-lg border border-gray-400 p-2">Gut zu wissen: Die neue Excel gilt. Bilder aus dem ZIP ersetzen alte Bilder. Artikel ohne Bild bekommen ein Symbol, ein eigenes Bild geht später in der Artikelverwaltung. Buchungen bleiben immer unverändert. Eine Vorlage gibt es unter „Aktuellen Stand exportieren“.</p>
          </div>
          <button type="button" autoFocus onClick={() => setHelpOpen(false)} className={`${primary} mt-4 self-start`}>Zurück</button>
        </div>
      </div>}
      {fileError && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="presentation">
        <div role="alertdialog" aria-modal="true" aria-labelledby="catalog-file-error-title" aria-describedby="catalog-file-error-text" className="w-full max-w-md rounded-xl bg-white p-5 text-gray-900 shadow-2xl dark:bg-gray-800 dark:text-white">
          <h3 id="catalog-file-error-title" className="text-lg font-bold text-red-600">Dateifehler</h3>
          <p id="catalog-file-error-text" className="my-4">{fileError}</p>
          <button autoFocus type="button" onClick={() => setFileError('')} className={button}>OK</button>
        </div>
      </div>}
      <div className="mt-2 space-y-3 overflow-auto">
        <details className={done ? 'hidden' : 'rounded-xl border border-gray-400 p-2'}>
          <summary className="cursor-pointer font-semibold">1. Aktuellen Stand exportieren (optional)</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={busy} onClick={downloadBundle} className={primary}>Excel + Bilder exportieren</button>
            <button disabled={busy} onClick={downloadTemplate} className={button}>Mustervorlage</button>
            <button disabled={busy} onClick={download} className={button}>Nur Excel</button>
            <button disabled={busy} onClick={downloadImagesOnly} className={button}>Nur Bilder-ZIP</button>
            <button disabled={busy} onClick={downloadFull} className={button} title="Mit IDs und allen technischen Spalten (für Fachleute)">Excel vollständig (mit IDs)</button>
          </div>
        </details>
        <details className={done ? 'hidden' : 'rounded-xl border border-gray-400 p-2'} open={Boolean(excel || zip || plan)}>
          <summary className="cursor-pointer font-semibold">2. Neuen Stand importieren (optional)</summary>
          <div className="mt-2 space-y-3">
          <div className="grid grid-cols-[9rem_auto_1fr] items-center gap-x-3 gap-y-2 rounded-xl border border-slate-700 bg-slate-900/40 p-3">
            {([['excel', 'Excel-Liste', '.xlsx', excel], ['zip', 'Bilder-ZIP', '.zip', zip]] as const).map(([kind, label, accept, file]) => (
              <Fragment key={kind}>
                <span className="font-semibold">{label}{kind === 'zip' && <span className="block text-xs font-normal opacity-60">optional</span>}</span>
                <label className={`${button} cursor-pointer text-center ${busy ? 'pointer-events-none opacity-40' : ''}`}>
                  Datei wählen
                  <input className="sr-only" disabled={busy} type="file" accept={accept} onChange={e => {chooseFile(e.target.files?.[0] ?? null, kind); e.target.value = '';}} />
                </label>
                <span className={`truncate ${file ? 'font-semibold text-emerald-400' : 'opacity-60'}`} title={file?.name}>{file ? `✓ ${file.name}` : 'noch keine Datei'}</span>
              </Fragment>
            ))}
            {zipSummary && zip && <p role="status" className="col-span-3 text-xs opacity-80">{zipSummary}</p>}
            <label className="col-span-3 flex items-center gap-2 border-t border-slate-700 pt-2 text-sm"><input type="checkbox" disabled={busy} checked={autoIllustrations} onChange={e => {invalidate();setAutoIllustrations(e.target.checked);}} />Artikel ohne Bild bekommen ein eigenes Symbol</label>
          </div>
          {testMode && <p className="rounded-xl bg-amber-100 p-3 text-amber-900">Testmodus: Vorschau und Export möglich, Import gesperrt.</p>}
          <div className="flex gap-2">
            <button disabled={busy || !excel} onClick={preview} className={primary}>{busy ? 'Bitte warten …' : 'Vorschau erstellen'}</button>
            <button type="button" onClick={() => setHelpOpen(true)} className={button}>Hilfe</button>
          </div>
          </div>
        </details>
        {done && plan && <section className="space-y-2 rounded-xl border-2 border-emerald-400 bg-emerald-900/50 p-4" role="status">
          <h3 className="text-xl font-extrabold text-emerald-300">✓ Import erfolgreich abgeschlossen</h3>
          <p className="text-base font-semibold text-emerald-100">{plan.rows.filter(r => r.status === 'neu').length} neu · {plan.rows.filter(r => r.status === 'geändert').length} geändert · {plan.removed.length} gelöscht. Alles ist in der Datenbank gespeichert.</p>
          {log.length > 0 && <ul className="max-h-48 overflow-auto rounded-lg bg-black/20 p-2 text-sm text-emerald-100">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          <p className="text-base font-bold text-emerald-200">Sie können dieses Fenster jetzt schließen.</p>
          <button type="button" autoFocus className="rounded-xl bg-emerald-600 px-6 py-3 text-lg font-extrabold text-white hover:bg-emerald-500" onClick={onClose}>Fenster schließen</button>
        </section>}
        {importError && !done && <div role="alert" className="rounded-xl border-2 border-red-500 bg-red-950/60 p-4"><h3 className="text-lg font-extrabold text-red-300">✗ Import fehlgeschlagen</h3><p className="mt-1 whitespace-pre-wrap text-sm text-red-100">{importError}</p></div>}
        {message && !done && <p role="status" className="whitespace-pre-wrap rounded-xl border border-blue-400 p-3">{message}</p>}
        {plan && !done && <section className="space-y-3">
          <h3 className="font-semibold">3. Vorschau prüfen und importieren</h3>
          <p className="font-semibold">{plan.rows.filter(r => r.status === 'neu').length} neu · {plan.rows.filter(r => r.status === 'geändert').length} geändert · {plan.removed.length} werden gelöscht · {unchanged} unverändert</p>
          {plan.errors.length > 0 && <div role="alert" className="rounded-xl border border-red-500 p-3"><strong>Import gesperrt – bitte zuerst beheben:</strong><ul className="list-disc pl-5">{plan.errors.map((e,i) => <li key={i}>{e}</li>)}</ul></div>}
          {plan.removed.length > 0 && <div className="rounded-xl border-2 border-red-600 p-2 text-sm">
            <strong>Diese Einträge fehlen in der neuen Excel und werden gelöscht:</strong>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {removedArticles.map(r => <li key={r.id}>{r.name} <span className="opacity-70">({r.group})</span></li>)}
              {removedGroups.map(r => <li key={r.id}>Warengruppe „{r.name}“ (leer)</li>)}
            </ul>
            <label className="mt-2 flex items-center gap-2 font-semibold"><input type="checkbox" disabled={busy || done} checked={confirmedDelete} onChange={e => setConfirmedDelete(e.target.checked)} />Ich habe ein Backup erstellt und bestätige das Löschen.</label>
          </div>}
          {groups.filter(g => g.rows.length).map(g => <details key={g.title} className="rounded-xl border border-gray-400 px-3 py-1.5">
            <summary className="cursor-pointer text-sm font-semibold">{g.title} ({g.rows.length})</summary>
            <ul className="mt-1 max-h-48 overflow-auto text-xs leading-5">{g.rows.map((r, i) => <li key={`${r.id}-${i}`}><strong>{r.name}</strong>{r.image ? <span className="opacity-70"> ← {r.image}</span> : r.changes.length > 0 && r.kind !== 'Warengruppe' ? <span className="opacity-80"> · {r.changes.filter(c => !c.startsWith('Bild')).join(' · ')}</span> : null}</li>)}</ul>
          </details>)}
          {plan.unmatched.length > 0 && <div className="rounded-xl border border-amber-500 bg-amber-950/40 p-2 text-xs text-amber-100">ℹ {plan.unmatched.length} Bild{plan.unmatched.length === 1 ? '' : 'er'} aus der ZIP passen zu keinem Artikel und werden nicht benutzt: {plan.unmatched.map(x => x.split('/').pop()).join(', ')}</div>}
          {plan.warnings.length > 0 && <details className="rounded-xl border border-gray-400 p-3"><summary className="cursor-pointer">{plan.warnings.length} Hinweise zu Bildern</summary><ul className="mt-2 list-disc pl-5 text-sm">{plan.warnings.map((w,i) => <li key={i}>{w}</li>)}</ul></details>}
          {!autoIllustrations && plan.rows.filter(r => r.kind === 'Artikel' && r.status !== 'entfernt' && r.id && !plan.images[r.id] && !plan.next.products.find(p => p.id === r.id)?.imageUrl).length > 0 && <section className="space-y-2 rounded-xl border border-gray-400 p-3">
            <h3 className="font-semibold">KI-Bilder für Artikel ohne Bild (optional)</h3>
            <p className="text-sm">Erst nach Klick erzeugt (kostenpflichtiger Dienst). Nur bestätigte Vorschläge werden importiert.</p>
            {plan.rows.filter(r => r.kind === 'Artikel' && r.status !== 'entfernt' && r.id && !plan.images[r.id] && !plan.next.products.find(p => p.id === r.id)?.imageUrl).map(r => <div key={r.id} className="flex flex-wrap items-center gap-3 border-t border-gray-400 py-2">
              <span className="font-medium">{r.name}</span>
              {generated[r.id!] ? <>
                <img src={generated[r.id!].url} alt={`KI-Vorschau: ${r.name}`} className="h-24 w-24 rounded object-cover" />
                <button className={button} disabled={busy} onClick={() => discardGenerated(r.id!)}>Bild verwerfen</button>
              </> : <button className={button} disabled={busy || testMode || !supabase} onClick={() => void generateImage(r.id!,r.name)}>KI-Bild erstellen</button>}
            </div>)}
          </section>}
          {stale && !done && <p role="alert">Der lokale Katalog hat sich geändert. Bitte Vorschau neu erstellen.</p>}
          <label className="flex items-center gap-2"><input type="checkbox" disabled={busy || done || !session || !!stale || testMode || !!plan.errors.length} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Ich habe die Vorschau geprüft und bestätige den Import.</label>
          {importProgress && <div role="status" className="space-y-1 rounded-xl border border-gray-400 p-3"><p className="text-sm font-semibold">Import: {Math.round(importProgress.done / importProgress.total * 100)} % – {importProgress.stage}</p><progress className="w-full" max={importProgress.total} value={importProgress.done} />{log.length > 0 && <ul className="max-h-32 overflow-auto text-xs">{log.slice(-6).map((l, i) => <li key={i}>{l}</li>)}</ul>}</div>}
          <button className={primary} disabled={importBlocked} onClick={commit}>Jetzt importieren</button>
        </section>}
      </div>
    </div>
  </div>;
}
