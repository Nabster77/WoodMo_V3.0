/** WOODMO V3: Geräte-Diagnose. Modus ändern und Befehle absetzen nur mit Administrator- oder Verwaltungspasswort. */
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { authorizedResetPassword, type AdministratorRecord } from './authorizePassword.ts';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
function namedKey(name: string, fallback: string): string {
  const raw = Deno.env.get(name);
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, string>;
      if (typeof keys.default === 'string' && keys.default) return keys.default;
    } catch { /* No usable key. */ }
  }
  return Deno.env.get(fallback) ?? '';
}
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== 'POST') return reply(405, { error: 'Nur POST erlaubt.' });
  const token = /^Bearer (.+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token || token.startsWith('sb_')) return reply(401, { error: 'Cloud-Anmeldung erforderlich.' });
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const publishableKey = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const serviceKey = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publishableKey || !serviceKey) return reply(503, { error: 'Diagnose-Dienst nicht eingerichtet.' });

  let password: unknown;
  let payload: Record<string, unknown> = {};
  try {
    if (Number(request.headers.get('content-length') ?? '0') > 4096) return reply(413, { error: 'Anfrage zu groß.' });
    const raw = await request.text();
    if (raw.length > 4096) return reply(413, { error: 'Anfrage zu groß.' });
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Ungültige Anfrage.' });
    payload = body as Record<string, unknown>;
    password = payload.password;
  } catch { return reply(400, { error: 'Ungültige Anfrage.' }); }
  if (typeof password !== 'string' || !password.trim() || password.length > 256) {
    return reply(400, { error: 'Administrator- oder Verwaltungspasswort erforderlich.' });
  }

  // The shared cloud login is not itself the personal administrator proof.
  const account = createClient(url, publishableKey, {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: login, error: loginError } = await account.auth.getUser(token);
  if (loginError || !login.user || login.user.email?.toLowerCase() !== 'admin@kasse.local') {
    return reply(403, { error: 'Cloud-Konto für Diagnose nicht berechtigt.' });
  }
  const { data: managerValid, error: managerError } = await account.rpc('verify_admin_gate_password', {
    p_password: password,
  });
  if (managerError || typeof managerValid !== 'boolean') {
    return reply(503, { error: 'Aktuelles Verwaltungspasswort nicht prüfbar.' });
  }

  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admins: AdministratorRecord[] = [];
  if (!managerValid) {
    for (let from = 0; from < 1000; from += 100) {
      const { data: rows, error: staffError } = await service.from('pos_staff_users')
        .select('data').eq('deleted', false)
        .eq('data->>role', 'administrator').eq('data->>active', 'true')
        .range(from, from + 99);
      if (staffError || !rows) return reply(503, { error: 'Administratorprüfung derzeit nicht möglich.' });
      for (const row of rows) admins.push(row.data as AdministratorRecord);
      if (rows.length < 100) break;
      if (from === 900) return reply(503, { error: 'Administratorverzeichnis zu groß.' });
    }
  }
  if (!(await authorizedResetPassword(password, managerValid, admins))) {
    return reply(403, { error: 'Administrator- oder Verwaltungspasswort nicht korrekt.' });
  }
  const action = payload.action;
  if (action === 'verify') return reply(200, { ok: true });
  if (action === 'cleanup') {
    // Nur offensichtlich veraltete Geräteeinträge (seit über 24 h keine Meldung). Buchungen, Kassensitzungen, Archive bleiben unberührt.
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const { data: removed, error } = await service.from('pos_device_diagnostics').delete()
      .or(`reported_at.lt.${cutoff},reported_at.is.null`).select('device_id');
    if (error) return reply(409, { error: error.message || 'Aufräumen nicht möglich.' });
    return reply(200, { removed: removed?.length ?? 0 });
  }
  const deviceId = payload.device_id;
  if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
    return reply(400, { error: 'Gerät fehlt oder ungültig.' });
  }
  const now = new Date().toISOString();
  if (action === 'set_mode') {
    const mode = payload.mode;
    if (mode !== 'off' && mode !== 'ready' && mode !== 'on') return reply(400, { error: 'Ungültiger Modus.' });
    // AUS am Gerät ist endgültig: ein Gerät auf AUS kann nicht aus der Ferne eingeschaltet werden.
    const { data: before, error: beforeError } = await service.from('pos_device_diagnostics')
      .select('mode').eq('device_id', deviceId).maybeSingle();
    if (beforeError) return reply(503, { error: 'Gerät nicht lesbar.' });
    if (!before) return reply(404, { error: 'Gerät unbekannt. Es muss zuerst auf BEREIT oder AN stehen.' });
    if (mode === 'on' && before.mode === 'off') {
      return reply(409, { error: 'Das Gerät steht auf AUS und hört nicht zu. Am Gerät auf BEREIT stellen.' });
    }
    const { data: row, error } = await service.from('pos_device_diagnostics')
      .update({ mode }).eq('device_id', deviceId).select('device_id, mode').maybeSingle();
    if (error) return reply(409, { error: error.message || 'Modus nicht gesetzt.' });
    if (!row) return reply(404, { error: 'Gerät unbekannt. Es muss zuerst auf BEREIT oder AN stehen.' });
    return reply(200, { device_id: row.device_id, mode: row.mode });
  }
  if (action === 'command') {
    const command = payload.command;
    if (command !== 'status' && command !== 'update-check' && command !== 'reload' && command !== 'update-install') {
      return reply(400, { error: 'Ungültiger Befehl.' });
    }
    const { data: current, error: readError } = await service.from('pos_device_diagnostics')
      .select('mode').eq('device_id', deviceId).maybeSingle();
    if (readError) return reply(503, { error: 'Gerät nicht lesbar.' });
    if (!current) return reply(404, { error: 'Gerät unbekannt.' });
    if (current.mode !== 'on') return reply(409, { error: 'Befehle nur, wenn das Gerät auf AN steht.' });
    const commandId = crypto.randomUUID();
    const { error } = await service.from('pos_device_diagnostics').update({
      pending_command: command, command_id: commandId, command_sent_at: now, command_force: payload.force === true,
      command_result: null, command_result_at: null,
    }).eq('device_id', deviceId);
    if (error) return reply(409, { error: error.message || 'Befehl nicht abgelegt.' });
    return reply(200, { device_id: deviceId, command, command_id: commandId });
  }
  if (action === 'request_file') {
    // Datei vom Gerät holen: Anfrage mit öffentlichem Schlüssel des PCs. Die Datei wird am Gerät verschlüsselt
    // (ECDH + AES-GCM), nur kurz im privaten Speicher abgelegt und nach dem Download gelöscht.
    const kind = payload.kind === 'list' ? 'list' : 'file';
    const path = payload.path === '/' && kind === 'list' ? '/' : payload.path;
    const pcKey = payload.pc_key as Record<string, unknown> | undefined;
    if (typeof path !== 'string' || !path.trim() || path.length > 300 || (path !== '/' && path.split('/').some(part => part === '..' || part === '.' || !part))) {
      return reply(400, { error: 'Ungültiger Dateipfad.' });
    }
    if (!pcKey || pcKey.kty !== 'EC' || pcKey.crv !== 'P-256' || typeof pcKey.x !== 'string' || typeof pcKey.y !== 'string' || 'd' in pcKey) {
      return reply(400, { error: 'Ungültiger Schlüssel.' });
    }
    const { data: current, error: readError } = await service.from('pos_device_diagnostics')
      .select('mode').eq('device_id', deviceId).maybeSingle();
    if (readError) return reply(503, { error: 'Gerät nicht lesbar.' });
    if (!current) return reply(404, { error: 'Gerät unbekannt.' });
    if (current.mode !== 'on') return reply(409, { error: 'Dateien nur, wenn das Gerät auf AN steht.' });
    // Aufräumen: alte Anfragen samt Dateien entfernen (Anfragen/Übertragungen älter als 15 Minuten).
    const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: old } = await service.from('pos_file_transfers').select('id').lt('created_at', cutoff).limit(100);
    if (old?.length) {
      await service.storage.from('diag-transfer').remove(old.map(row => row.id as string)).catch(() => undefined);
      await service.from('pos_file_transfers').delete().in('id', old.map(row => row.id as string));
    }
    const { data: created, error } = await service.from('pos_file_transfers').insert({
      device_id: deviceId, kind, path: path.trim(), pc_key: { kty: 'EC', crv: 'P-256', x: pcKey.x, y: pcKey.y },
    }).select('id').single();
    if (error || !created) return reply(409, { error: error?.message || 'Anfrage nicht abgelegt.' });
    return reply(200, { id: created.id });
  }
  return reply(400, { error: 'Unbekannte Aktion.' });
});
