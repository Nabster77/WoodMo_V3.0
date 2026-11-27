import { supabase } from '@/lib/supabaseClient';

/** Handy-Modus (27.11.): alle Anfragen gehen an die Edge Function woodmo-v3-mobile. */
const FUNCTION = 'woodmo-v3-mobile';

export class MobileApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Ohne Cloud-Konto (Handy). Nur mit öffentlichem Schlüssel; die Function prüft Code/Token/Passwort selbst. */
export async function callMobile<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new MobileApiError('Cloud ist nicht konfiguriert.', 0);
  let response: Response;
  try {
    response = await fetch(`${url}/functions/v1/${FUNCTION}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ ...body, action }),
      cache: 'no-store',
    });
  } catch {
    throw new MobileApiError('Keine Verbindung. Bitte Internet prüfen.', 0);
  }
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new MobileApiError(typeof data.error === 'string' ? data.error : 'Anfrage fehlgeschlagen.', response.status);
  return data as T;
}

/** Vom Kassentablet aus, mit dem Cloud-Konto der Kasse. */
export async function callMobileAsTablet<T = Record<string, unknown>>(action: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Cloud ist nicht konfiguriert.');
  const { data: auth } = await supabase.auth.getSession();
  const jwt = auth.session?.access_token;
  if (!jwt) throw new Error('Cloud-Anmeldung der Kasse fehlt.');
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  let response: Response;
  try {
    response = await fetch(`${url}/functions/v1/${FUNCTION}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ ...body, action }),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Keine Verbindung zur Cloud.');
  }
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Anfrage fehlgeschlagen.');
  return data as T;
}

export function mobileLink(mode: 'pfand' | 'admin', code?: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`;
  return `${base}?mobil=${mode}${code ? `&code=${code}` : ''}`;
}

export function newMobileReceiptId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `tx-m-${Date.now().toString(36)}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
