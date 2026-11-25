// Datei-Übertragung Gerät -> PC (26.11.2026): Ende-zu-Ende verschlüsselt (ECDH P-256 + AES-256-GCM).
// Der PC fordert über die Edge Function (Passwortprüfung) eine Datei an und sendet seinen öffentlichen Schlüssel.
// Das Gerät verschlüsselt die Datei lokal und legt sie nur kurz im privaten Speicher ab, der PC lädt sie, entschlüsselt
// lokal und löscht sie danach sofort wieder. Der Server sieht nie den Klartext oder den geheimen Schlüssel.
import { supabase } from './supabaseClient';
import { loadExportFolder } from './journalPdfFile';

const BUCKET = 'diag-transfer';
const TABLE = 'pos_file_transfers';
export const MAX_TRANSFER_BYTES = 20 * 1024 * 1024;

interface FileLike { kind: 'file'; getFile(): Promise<File> }
interface DirLike {
  kind: 'directory';
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  getDirectoryHandle(name: string): Promise<DirLike>;
  getFileHandle(name: string): Promise<FileLike>;
}
interface TransferRow { id: string; path: string; pc_key: JsonWebKey }
type Gateway = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function publicJwk(key: CryptoKey): Promise<JsonWebKey> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

/** Gerät: offene Anfragen für dieses Gerät bearbeiten (nur im Modus AN, höchstens 2 je Durchlauf). */
export async function serveFileTransfers(deviceId: string): Promise<void> {
  if (!supabase) return;
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data, error } = await supabase.from(TABLE).select('id, path, pc_key')
    .eq('device_id', deviceId).eq('status', 'requested').gte('created_at', since).limit(2);
  if (error || !data?.length) return;
  for (const row of data as TransferRow[]) {
    const fail = async (text: string) => {
      await supabase!.from(TABLE).update({ status: 'failed', error: text.slice(0, 200), updated_at: new Date().toISOString() }).eq('id', row.id);
    };
    try {
      const root = await loadExportFolder() as unknown as DirLike | null;
      if (!root) { await fail('Am Gerät ist kein Speicherordner festgelegt.'); continue; }
      const permission = await root.queryPermission?.({ mode: 'readwrite' });
      if (permission !== undefined && permission !== 'granted') { await fail('Zugriff auf den Speicherordner fehlt: am Gerät „Zugriff auf Speicherordner erlauben“ tippen.'); continue; }
      const parts = row.path.split('/').filter(Boolean);
      let dir = root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      const file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
      if (file.size > MAX_TRANSFER_BYTES) { await fail('Datei ist größer als 20 MB.'); continue; }
      const pcKey = await crypto.subtle.importKey('jwk', row.pc_key, ECDH, false, []);
      const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
      const aes = await crypto.subtle.deriveKey({ name: 'ECDH', public: pcKey }, pair.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, await file.arrayBuffer()));
      const body = new Blob([iv as BlobPart, cipher as BlobPart], { type: 'application/octet-stream' });
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(row.id, body, { contentType: 'application/octet-stream', upsert: false });
      if (uploadError) { await fail('Upload fehlgeschlagen: ' + uploadError.message); continue; }
      await supabase.from(TABLE).update({
        status: 'uploaded', device_key: await publicJwk(pair.publicKey), size: file.size, updated_at: new Date().toISOString(),
      }).eq('id', row.id);
    } catch (caught) {
      await fail(caught instanceof Error && caught.name === 'NotFoundError' ? 'Datei am Gerät nicht gefunden.' : 'Fehler am Gerät: ' + (caught instanceof Error ? caught.message : 'unbekannt'));
    }
  }
}

/** PC: Datei vom Gerät holen. Gibt Dateiname und entschlüsselten Inhalt zurück; Server-Kopie wird danach gelöscht. */
export async function requestFileFromDevice(
  gateway: Gateway, deviceId: string, path: string, password: string, onProgress: (text: string) => void,
): Promise<{ name: string; blob: Blob }> {
  if (!supabase) throw new Error('Cloud ist nicht konfiguriert.');
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  onProgress('Anfrage gesendet …');
  const created = await gateway({ action: 'request_file', device_id: deviceId, path, password, pc_key: await publicJwk(pair.publicKey) });
  const id = String(created.id ?? '');
  if (!id) throw new Error('Anfrage nicht angenommen.');
  let deviceKey: JsonWebKey | null = null;
  for (let attempt = 0; attempt < 75; attempt += 1) {
    await sleep(2000);
    onProgress('Warte auf das Gerät … (' + (attempt + 1) * 2 + ' s)');
    const { data, error } = await supabase.from(TABLE).select('status, device_key, error').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.status === 'failed') throw new Error(data.error || 'Das Gerät konnte die Datei nicht liefern.');
    if (data?.status === 'uploaded' && data.device_key) { deviceKey = data.device_key as JsonWebKey; break; }
  }
  if (!deviceKey) throw new Error('Keine Antwort vom Gerät. Bitte erneut versuchen.');
  onProgress('Lade verschlüsselte Datei …');
  const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(id);
  if (downloadError || !blob) throw new Error('Download fehlgeschlagen: ' + (downloadError?.message ?? 'keine Daten'));
  onProgress('Entschlüssele …');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const deviceKeyObject = await crypto.subtle.importKey('jwk', deviceKey, ECDH, false, []);
  const aes = await crypto.subtle.deriveKey({ name: 'ECDH', public: deviceKeyObject }, pair.privateKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, aes, bytes.slice(12));
  } catch { throw new Error('Entschlüsselung fehlgeschlagen (Datei verändert oder falscher Schlüssel).'); }
  // Erfolgreich: Server-Kopie sofort löschen.
  await supabase.storage.from(BUCKET).remove([id]);
  await supabase.from(TABLE).update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', id);
  return { name: path.split('/').pop() || 'datei', blob: new Blob([plain]) };
}
