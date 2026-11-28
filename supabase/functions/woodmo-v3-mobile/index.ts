/**
 * WOODMO V3: Handy-Modus (27.11.2026).
 * - pfand: Tablet erzeugt einen kurzen Kopplungscode für die offene Kasse; das Handy bucht damit nur reine Pfand-Retouren.
 * - admin: Administrator meldet sich mit persönlichem Passwort an und sieht offene Kassen nur lesend.
 * Clients haben keinen Zugriff auf die Kopplungstabellen; alle Prüfungen laufen hier mit der Service-Rolle.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { verifyExistingStaffPassword } from './passwordProof.ts';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const LOCATIONS = ['Friedrichshafen', 'Bregenz'];
const CODE_MINUTES = 3;
const PFAND_HOURS = 10;
/** Ohne Lebenszeichen der Kassen-App (geschlossen) endet die Kopplung (Rückfall, falls das Schließen nicht gemeldet werden konnte). */
const TABLET_SILENCE_MIN = 10;
const ADMIN_MINUTES = 30;
const MAX_FAILS = 8;
const FAIL_WINDOW_MIN = 10;
const PFAND_RETURN_RATE: Record<string, number> = { Friedrichshafen: 19, Bregenz: 20 };

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
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
const round2 = (v: number) => Math.round(v * 100) / 100;
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function isOpen(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  return data.closed !== true && data.discarded !== true && !data.closedAt && !data.dailyCloseFinalizedAt && !data.dailyCloseSnapshot;
}
function clientKey(request: Request): string {
  return (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}
async function tooManyFails(db: SupabaseClient, key: string): Promise<boolean> {
  const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60_000).toISOString();
  const { count } = await db.from('pos_mobile_attempts').select('id', { count: 'exact', head: true }).eq('key', key).gte('at', since);
  return (count ?? 0) >= MAX_FAILS;
}
async function recordFail(db: SupabaseClient, key: string): Promise<void> {
  await db.from('pos_mobile_attempts').insert({ key });
}
async function currentGeneration(db: SupabaseClient): Promise<number> {
  const { data } = await db.from('pos_booking_resets').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
  return data ? Number(data.id) : 0;
}
async function loadSession(db: SupabaseClient, id: string) {
  const { data } = await db.from('pos_cash_sessions').select('id, location, data, booking_generation').eq('id', id).maybeSingle();
  return data as { id: string; location: string; data: Record<string, unknown>; booking_generation: number } | null;
}
async function revokePairing(db: SupabaseClient, id: unknown): Promise<void> {
  if (typeof id === 'string') await db.from('pos_mobile_pairings').update({ revoked_at: new Date().toISOString() }).eq('id', id).is('revoked_at', null);
}
async function pairingByToken(db: SupabaseClient, token: unknown, kind: 'pfand' | 'admin') {
  if (typeof token !== 'string' || token.length !== 64) return null;
  const { data } = await db.from('pos_mobile_pairings').select('*').eq('token_hash', await sha(token)).eq('kind', kind).maybeSingle();
  if (!data || data.revoked_at || new Date(data.expires_at).getTime() < Date.now()) return null;
  if (kind === 'pfand' && !data.claimed_at) return null;
  if (kind === 'pfand' && data.tablet_seen_at && Date.now() - new Date(data.tablet_seen_at).getTime() > TABLET_SILENCE_MIN * 60_000) {
    await revokePairing(db, data.id); // Kassen-App seit längerem nicht mehr aktiv: Kopplung endgültig beenden
    return null;
  }
  return data as Record<string, unknown>;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== 'POST') return reply(405, { error: 'Nur POST erlaubt.' });
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const publishableKey = namedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const serviceKey = namedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publishableKey || !serviceKey) return reply(503, { error: 'Handy-Dienst nicht eingerichtet.' });
  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 16384) return reply(413, { error: 'Anfrage zu groß.' });
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Ungültige Anfrage.' });
    payload = body as Record<string, unknown>;
  } catch { return reply(400, { error: 'Ungültige Anfrage.' }); }
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const action = payload.action;

  // ---- Aktionen des Kassentablets: nur mit dem Cloud-Konto der Kasse ----
  if (action === 'pair_create' || action === 'pair_revoke' || action === 'pair_list' || action === 'pair_heartbeat') {
    const jwt = /^Bearer (.+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!jwt || jwt.startsWith('sb_')) return reply(401, { error: 'Cloud-Anmeldung der Kasse erforderlich.' });
    const account = createClient(url, publishableKey, { global: { headers: { Authorization: 'Bearer ' + jwt } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: login } = await account.auth.getUser(jwt);
    if (!login?.user || login.user.email?.toLowerCase() !== 'admin@kasse.local') return reply(403, { error: 'Cloud-Konto nicht berechtigt.' });
    const sessionId = payload.session_id;
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 128) return reply(400, { error: 'Kassensitzung fehlt.' });
    if (action === 'pair_revoke') {
      await db.from('pos_mobile_pairings').update({ revoked_at: new Date().toISOString() }).eq('session_id', sessionId).eq('kind', 'pfand').is('revoked_at', null);
      return reply(200, { ok: true });
    }
    if (action === 'pair_heartbeat') {
      const open = await loadSession(db, sessionId);
      if (!open || !isOpen(open.data)) {
        await db.from('pos_mobile_pairings').update({ revoked_at: new Date().toISOString() }).eq('session_id', sessionId).eq('kind', 'pfand').is('revoked_at', null);
        return reply(200, { active: 0 });
      }
      const { data } = await db.from('pos_mobile_pairings').update({ tablet_seen_at: new Date().toISOString() })
        .eq('session_id', sessionId).eq('kind', 'pfand').is('revoked_at', null).not('claimed_at', 'is', null)
        .gt('expires_at', new Date().toISOString()).select('id');
      return reply(200, { active: (data ?? []).length });
    }
    if (action === 'pair_list') {
      const open = await loadSession(db, sessionId);
      if (!open || !isOpen(open.data)) {
        await db.from('pos_mobile_pairings').update({ revoked_at: new Date().toISOString() }).eq('session_id', sessionId).eq('kind', 'pfand').is('revoked_at', null);
        return reply(200, { pairings: [] });
      }
      const { data } = await db.from('pos_mobile_pairings').select('staff_name, claimed_at, last_used_at, code_expires_at, tablet_seen_at')
        .eq('session_id', sessionId).eq('kind', 'pfand').is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('claimed_at', { ascending: true });
      const active = (data ?? []).filter(row => row.claimed_at
        ? !(row.tablet_seen_at && Date.now() - new Date(row.tablet_seen_at).getTime() > TABLET_SILENCE_MIN * 60_000)
        : new Date(row.code_expires_at).getTime() > Date.now());
      return reply(200, { pairings: active });
    }
    const session = await loadSession(db, sessionId);
    if (!session || !isOpen(session.data)) return reply(409, { error: 'Diese Kasse ist in der Cloud nicht offen. Bitte zuerst abgleichen.' });
    if (session.location !== payload.location) return reply(409, { error: 'Standort passt nicht zur Kasse.' });
    const pfandAmount = Number(payload.pfand_amount);
    if (!Number.isFinite(pfandAmount) || pfandAmount <= 0 || pfandAmount > 50) return reply(400, { error: 'Pfandbetrag ungültig.' });
    const staffId = payload.staff_id, staffName = payload.staff_name;
    if (typeof staffId !== 'string' || typeof staffName !== 'string' || !staffName || staffName.length > 80) return reply(400, { error: 'Mitarbeiter fehlt.' });
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    const token = randomToken();
    const now = Date.now();
    const { error } = await db.from('pos_mobile_pairings').insert({
      kind: 'pfand', code, token_hash: await sha(token), session_id: session.id, location: session.location,
      staff_id: staffId, staff_name: staffName, pfand_amount: round2(pfandAmount),
      code_expires_at: new Date(now + CODE_MINUTES * 60_000).toISOString(),
      expires_at: new Date(now + PFAND_HOURS * 3_600_000).toISOString(),
      // Der Token wird erst beim Einlösen des Codes ausgegeben; bis dahin liegt er nur gehasht vor.
      last_used_at: null, tablet_seen_at: new Date(now).toISOString(),
    });
    if (error) return reply(503, { error: 'Kopplung konnte nicht angelegt werden.' });
    // Klartext-Token kurz zwischenspeichern ist nicht nötig: beim Einlösen wird ein neuer Token erzeugt.
    return reply(200, { code, expires_at: now + CODE_MINUTES * 60_000, location: session.location });
  }

  // ---- Handy: Code einlösen ----
  if (action === 'pair_claim') {
    const key = 'claim:' + clientKey(request);
    if (await tooManyFails(db, key)) return reply(429, { error: 'Zu viele Versuche. Bitte 10 Minuten warten.' });
    const code = payload.code;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) { await recordFail(db, key); return reply(400, { error: 'Code ungültig.' }); }
    const { data: row } = await db.from('pos_mobile_pairings').select('*').eq('code', code).eq('kind', 'pfand')
      .is('claimed_at', null).is('revoked_at', null).gt('code_expires_at', new Date().toISOString()).maybeSingle();
    if (!row) { await recordFail(db, key); return reply(404, { error: 'Code unbekannt oder abgelaufen. Am Tablet neu koppeln.' }); }
    const session = await loadSession(db, row.session_id);
    if (!session || !isOpen(session.data)) return reply(409, { error: 'Die Kasse ist nicht mehr offen.' });
    const token = randomToken();
    const { data: claimed } = await db.from('pos_mobile_pairings')
      .update({ claimed_at: new Date().toISOString(), token_hash: await sha(token), code: null })
      .eq('id', row.id).is('claimed_at', null).select('id').maybeSingle();
    if (!claimed) return reply(409, { error: 'Code wurde bereits verwendet.' });
    return reply(200, { token, location: row.location, session_id: row.session_id, staff_name: row.staff_name, pfand_amount: Number(row.pfand_amount) });
  }

  // ---- Handy: Kopplung selbst beenden (X → Ja) ----
  if (action === 'pfand_unpair') {
    if (typeof payload.token === 'string' && payload.token.length === 64) {
      await db.from('pos_mobile_pairings').update({ revoked_at: new Date().toISOString() }).eq('token_hash', await sha(payload.token)).eq('kind', 'pfand');
    }
    return reply(200, { ok: true });
  }

  // ---- Handy: Kopplung prüfen ----
  if (action === 'pfand_status') {
    const pairing = await pairingByToken(db, payload.token, 'pfand');
    if (!pairing) return reply(410, { error: 'Kopplung beendet.' });
    const session = await loadSession(db, String(pairing.session_id));
    if (!session || !isOpen(session.data)) { await revokePairing(db, pairing.id); return reply(410, { error: 'Kasse geschlossen. Kopplung beendet.' }); }
    return reply(200, { ok: true, expires_at: pairing.expires_at, location: pairing.location, staff_name: pairing.staff_name, pfand_amount: Number(pairing.pfand_amount) });
  }

  // ---- Handy: Pfand-Retoure buchen ----
  if (action === 'pfand_book') {
    const pairing = await pairingByToken(db, payload.token, 'pfand');
    if (!pairing) return reply(410, { error: 'Kopplung beendet. Am Tablet neu koppeln.' });
    const session = await loadSession(db, String(pairing.session_id));
    if (!session || !isOpen(session.data)) { await revokePairing(db, pairing.id); return reply(410, { error: 'Kasse geschlossen. Kopplung beendet.' }); }
    const id = payload.id, count = Number(payload.count);
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) return reply(400, { error: 'Bon-ID ungültig.' });
    if (!Number.isInteger(count) || count < 1 || count > 999) return reply(400, { error: 'Anzahl ungültig (1–999).' });
    const location = String(pairing.location);
    if (!LOCATIONS.includes(location) || location !== session.location) return reply(409, { error: 'Standort passt nicht.' });
    // Wiederholte Sendung desselben Bons: nicht doppelt buchen.
    const { data: existing } = await db.from('pos_transactions').select('id, data').eq('id', id).maybeSingle();
    if (existing) {
      const prev = existing.data as Record<string, unknown>;
      // Die Buchung trägt kein Handy-Merkmal (wie eine Retoure an der Kasse); Wiederholung erkennt man an Bon-ID, Kassensitzung und Mitarbeiter.
      if (prev.cashSessionId === session.id && prev.employeeId === pairing.staff_id) return reply(200, { ok: true, duplicate: true, total: prev.total });
      return reply(409, { error: 'Bon-ID bereits vergeben.' });
    }
    const unit = Number(pairing.pfand_amount);
    const amount = round2(-count * unit);
    const rate = PFAND_RETURN_RATE[location];
    // Gleiche Form wie eine reine Pfandausgabe an der Kasse (buildCheckoutTransactions/retoureItem, isPfandOnly).
    const pfandNet = amount / (1 + rate / 100);
    const pfandTax = amount - pfandNet;
    const now = Date.now();
    const transaction = {
      id, timestamp: now,
      items: [{
        productId: '__pfand_retoure__', name: 'Pfand-Retoure', price: round2(-unit), quantity: count,
        taxRate: 0, netPrice: round2(-unit), taxAmount: 0, categoryId: '__pfand__', pfand: amount,
        isPfandRetoure: true, pfandTaxRate: rate, pfandNet, pfandTax,
      }],
      subtotal: 0, taxByRate: {}, totalNet: 0, totalTax: 0, totalPfand: amount, total: amount,
      pfandTaxByRate: { [rate]: pfandTax }, pfandNet, paymentMethod: 'cash', location,
      cashSessionId: session.id, employeeId: pairing.staff_id, employeeName: pairing.staff_name,
    };
    const generation = await currentGeneration(db);
    const { error } = await db.from('pos_transactions').insert({ id, location, timestamp: now, data: transaction, booking_generation: generation });
    if (error) return reply(503, { error: 'Buchung nicht gespeichert. Bitte erneut senden.' });
    await db.from('pos_mobile_pairings').update({ last_used_at: new Date().toISOString() }).eq('id', pairing.id);
    return reply(200, { ok: true, total: amount });
  }

  // ---- Administrator: Namensliste für die Auswahl (nur Namen, keine Daten) ----
  if (action === 'admin_names') {
    const { data: rows } = await db.from('pos_staff_users').select('data').eq('deleted', false)
      .eq('data->>role', 'administrator').eq('data->>active', 'true').limit(50);
    const names = (rows ?? []).map(r => String((r.data as Record<string, unknown>).name ?? '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'de'));
    return reply(200, { names });
  }

  // ---- Administrator: Anmeldung mit persönlichem Passwort ----
  if (action === 'admin_login') {
    const key = 'admin:' + clientKey(request);
    if (await tooManyFails(db, key)) return reply(429, { error: 'Zu viele Versuche. Bitte 10 Minuten warten.' });
    const name = payload.name, password = payload.password;
    if (typeof name !== 'string' || typeof password !== 'string' || !name.trim() || !password || password.length > 256) {
      return reply(400, { error: 'Name und Passwort eingeben.' });
    }
    const { data: rows } = await db.from('pos_staff_users').select('data').eq('deleted', false)
      .eq('data->>role', 'administrator').eq('data->>active', 'true').limit(200);
    const admin = (rows ?? []).map(r => r.data as Record<string, unknown>)
      .find(a => String(a.name ?? '').trim().toLowerCase() === name.trim().toLowerCase());
    const valid = admin && await verifyExistingStaffPassword(password, (admin.passwordSalt as string) ?? null, (admin.passwordHash as string) ?? null);
    if (!valid) { await recordFail(db, key); return reply(403, { error: 'Name oder Passwort nicht korrekt.' }); }
    const token = randomToken();
    await db.from('pos_mobile_pairings').insert({
      kind: 'admin', token_hash: await sha(token), staff_id: String(admin.id ?? ''), staff_name: String(admin.name ?? ''),
      claimed_at: new Date().toISOString(), expires_at: new Date(Date.now() + ADMIN_MINUTES * 60_000).toISOString(),
    });
    return reply(200, { token, name: admin.name, expires_in_min: ADMIN_MINUTES });
  }
  if (action === 'admin_logout') {
    if (typeof payload.token === 'string') await db.from('pos_mobile_pairings').update({ revoked_at: new Date().toISOString() }).eq('token_hash', await sha(payload.token));
    return reply(200, { ok: true });
  }

  // ---- Administrator: offene Kassen (nur lesen) ----
  if (action === 'admin_overview') {
    const pairing = await pairingByToken(db, payload.token, 'admin');
    if (!pairing) return reply(401, { error: 'Anmeldung abgelaufen. Bitte neu anmelden.' });
    // Jede Abfrage verlängert die Anmeldung (Sitzung läuft nach 30 Minuten ohne Nutzung ab).
    await db.from('pos_mobile_pairings').update({ last_used_at: new Date().toISOString(), expires_at: new Date(Date.now() + ADMIN_MINUTES * 60_000).toISOString() }).eq('id', pairing.id);
    const generation = await currentGeneration(db);
    const { data: sessionRows } = await db.from('pos_cash_sessions').select('id, location, data').eq('booking_generation', generation);
    const allRows = sessionRows ?? [];
    const open = allRows.filter(row => isOpen(row.data as Record<string, unknown>));
    const openLocations = new Set(open.map(row => row.location));
    const closedAtOf = (d: Record<string, unknown>) => Number(d.closedAt ?? d.dailyCloseFinalizedAt ?? 0);
    const latestClosed = new Map<string, (typeof allRows)[number]>();
    for (const row of allRows) {
      if (isOpen(row.data as Record<string, unknown>) || openLocations.has(row.location)) continue;
      const prev = latestClosed.get(row.location);
      if (!prev || closedAtOf(row.data as Record<string, unknown>) > closedAtOf(prev.data as Record<string, unknown>)) latestClosed.set(row.location, row);
    }
    const result = [];
    for (const row of [...open, ...latestClosed.values()]) {
      const s = row.data as Record<string, unknown>;
      const isClosedRow = !isOpen(s);
      const closedAt = isClosedRow ? closedAtOf(s) : null;
      const openedAt = Number(s.openedAt ?? 0);
      let txQuery = db.from('pos_transactions').select('data').eq('booking_generation', generation)
        .eq('location', row.location).gte('timestamp', openedAt);
      if (closedAt) txQuery = txQuery.lte('timestamp', closedAt + 60_000);
      const { data: txRows } = await txQuery.order('timestamp', { ascending: false }).limit(2000);
      const txs = (txRows ?? []).map(t => t.data as Record<string, unknown>)
        .filter(t => !t.cashSessionId || t.cashSessionId === row.id);
      const { data: stornoRows } = await db.from('pos_stornos').select('original_transaction_id, cash_effect_cents, gross_amount_cents')
        .eq('booking_generation', generation).eq('cash_session_id', row.id);
      const stornoIds = new Set((stornoRows ?? []).map(r => r.original_transaction_id));
      let total = 0, goods = 0, pfand = 0, cash = 0, card = 0;
      for (const t of txs) {
        const amount = Number(t.total ?? 0);
        total += amount; goods += Number(t.subtotal ?? 0); pfand += Number(t.totalPfand ?? 0);
        if (t.paymentMethod === 'card') card += amount; else cash += amount;
      }
      const stornoGross = (stornoRows ?? []).reduce((sum, r) => sum + Number(r.gross_amount_cents ?? 0), 0) / 100;
      const stornoCash = (stornoRows ?? []).reduce((sum, r) => sum + Number(r.cash_effect_cents ?? 0), 0) / 100;
      const entries = Array.isArray(s.entries) ? s.entries as Array<Record<string, unknown>> : [];
      const entrySum = entries.reduce((sum, e) => sum + (e.type === 'deposit' ? 1 : -1) * Number(e.amount ?? 0), 0);
      const intervals = Array.isArray(s.staffLoginIntervals) ? s.staffLoginIntervals as Array<Record<string, unknown>> : [];
      const loggedIn = [...new Set(intervals.filter(i => i.logoutAt == null).map(i => String(i.staffName ?? '')))].filter(Boolean);
      result.push({
        status: isClosedRow ? 'closed' : 'open', closed_at: closedAt,
        closing_balance: isClosedRow ? round2(Number(s.closingBalance ?? 0) - Number(s.closingWithdrawalAmount ?? 0)) : null,
        session_id: row.id, location: row.location, opened_at: openedAt, opened_by: s.openedByName ?? null,
        opening_balance: Number(s.openingBalance ?? 0), logged_in: loggedIn,
        receipts: txs.length, total: round2(total), goods: round2(goods), pfand: round2(pfand),
        cash: round2(cash), card: round2(card), storno_gross: round2(stornoGross),
        cash_balance: isClosedRow ? round2(Number(s.closingBalance ?? 0) - Number(s.closingWithdrawalAmount ?? 0)) : round2(Number(s.openingBalance ?? 0) + cash + entrySum + stornoCash),
        last_receipt_at: txs[0] ? Number(txs[0].timestamp) : null,
        recent: txs.slice(0, 40).map(t => ({
          id: t.id, at: Number(t.timestamp), total: Number(t.total ?? 0), payment: t.paymentMethod, employee: t.employeeName ?? null,
          storno: stornoIds.has(t.id),
          items: (Array.isArray(t.items) ? t.items as Array<Record<string, unknown>> : []).map(i => `${i.quantity}× ${i.name ?? ''}${i.shotName ? ' + ' + i.shotName : ''}`),
        })),
      });
    }
    result.sort((a, b) => String(a.location).localeCompare(String(b.location)));
    return reply(200, { server_time: Date.now(), admin: pairing.staff_name, sessions: result });
  }
  return reply(400, { error: 'Unbekannte Aktion.' });
});
