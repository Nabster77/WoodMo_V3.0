import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, LogOut, MapPin, Minus, Plus, Recycle, RefreshCw, RotateCcw, ShieldCheck, WifiOff } from 'lucide-react';
import { callMobile, MobileApiError, newMobileReceiptId, unpairPhoneOnClose } from '@/lib/mobileApi';
import { formatCurrency } from '@/lib/format';
import { APP_VERSION } from '@/lib/appVersion';
import { SwipeConfirm } from './SwipeConfirm';

/**
 * Handy-Modus (27.11.2026): eigene schlanke Seite ohne Kassen-App und ohne Cloud-Konto.
 * ?mobil=pfand  → nur Pfand-Retoure für die gekoppelte Kasse
 * ?mobil=admin  → mobile Kassenübersicht (nur lesen) nach Administrator-Anmeldung
 * Zugangsdaten liegen nur im sessionStorage dieses Tabs.
 */
const PFAND_KEY = 'woodmo_mobile_pfand';
const ADMIN_KEY = 'woodmo_mobile_admin';

function loadSession<T>(key: string): T | null {
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
function saveSession(key: string, value: unknown) {
  try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* privater Modus */ }
}
const time = (ms: number) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function isMobileMode(): boolean {
  return new URLSearchParams(window.location.search).has('mobil');
}

/** Während einer Buchung nie neu laden. */
let mobileBusy = false;
export function setMobileBusy(value: boolean) { mobileBusy = value; }

/** Lädt die Handy-Seite frisch (Zeitstempel umgeht jeden Zwischenspeicher). Kopplung im Tab bleibt erhalten. */
function reloadFresh() {
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.set('v', Date.now().toString(36));
  window.location.replace(url.toString());
}

/** Prüft beim Öffnen und bei Rückkehr in den Vordergrund, ob online eine neuere Version liegt. */
function useFreshVersion(): boolean {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const url = new URL('version.json', new URL(import.meta.env.BASE_URL, window.location.origin));
        url.searchParams.set('t', Date.now().toString(36));
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const online = (await res.json() as { version?: string }).version;
        if (stopped || !online || online === APP_VERSION) { setOutdated(false); return; }
        setOutdated(true);
        // Einmal pro Version automatisch neu laden, nie während einer Buchung.
        const key = 'woodmo_mobile_reloaded_for';
        if (!mobileBusy && sessionStorage.getItem(key) !== online) { sessionStorage.setItem(key, online); reloadFresh(); }
      } catch { /* offline: später erneut */ }
    };
    void check();
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    const timer = window.setInterval(() => { void check(); }, 120_000);
    return () => { stopped = true; document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('pageshow', onVisible); window.clearInterval(timer); };
  }, []);
  return outdated;
}

export function MobileApp() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mobil') === 'admin' ? 'admin' : 'pfand';
  const outdated = useFreshVersion();
  useEffect(() => { document.documentElement.classList.add('dark'); document.title = mode === 'admin' ? 'WOODMO Übersicht' : 'WOODMO Pfand'; }, [mode]);
  return (
    <div className="gx-bg min-h-dvh px-3 py-4 text-[15px]">
      <div className="mx-auto w-full max-w-md">
        {outdated && (
          <button type="button" onClick={reloadFresh} className="gx-btn gx-btn-warn mb-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl font-bold">
            <RefreshCw className="h-5 w-5" /> Neue Version – Ansicht aktualisieren
          </button>
        )}
        {mode === 'admin' ? <AdminMobile /> : <PfandMobile initialCode={params.get('code') ?? ''} />}
        <p className="gx-muted mt-6 text-center text-[10px]">Version {APP_VERSION}</p>
      </div>
    </div>
  );
}

function Header({ title, sub, onLogout }: { title: string; sub?: string; onLogout?: () => void }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="gx-heading text-xs font-bold uppercase tracking-[.14em]">WOODMO</p>
        <h1 className="gx-text truncate text-xl font-extrabold">{title}</h1>
        {sub && <p className="gx-muted truncate text-xs font-semibold">{sub}</p>}
      </div>
      {onLogout && <button type="button" onClick={onLogout} className="gx-btn flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-bold"><LogOut className="h-4 w-4" /> Beenden</button>}
    </div>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return <p role="alert" className="mt-3 rounded-xl border border-[color:var(--gx-err)] px-3 py-2 text-sm font-semibold text-[color:var(--gx-err)]">{text}</p>;
}

// ---------------- Pfand-Retoure ----------------
interface PfandPairing { token: string; location: string; staff_name: string; pfand_amount: number; session_id: string }
interface Booked { id: string; count: number; total: number; at: number; state: 'ok' | 'pending' | 'queued' | 'error' }

function PfandMobile({ initialCode }: { initialCode: string }) {
  // Neuer QR-Code im Link: alte Kopplung dieses Tabs nicht weiterverwenden, neue einlösen.
  const [pairing, setPairing] = useState<PfandPairing | null>(() => /^\d{6}$/.test(initialCode) ? null : loadSession<PfandPairing>(PFAND_KEY));
  const [code, setCode] = useState(initialCode.replace(/\D/g, '').slice(0, 6));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triedAuto = useRef(false);

  const claim = useCallback(async (value: string) => {
    if (!/^\d{6}$/.test(value)) { setError('Bitte den 6-stelligen Code vom Tablet eingeben.'); return; }
    setBusy(true); setError(null);
    try {
      const result = await callMobile<PfandPairing>('pair_claim', { code: value });
      saveSession(PFAND_KEY, result); setPairing(result);
      window.history.replaceState(null, '', `${window.location.pathname}?mobil=pfand`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (!pairing && !triedAuto.current && /^\d{6}$/.test(code)) { triedAuto.current = true; void claim(code); }
  }, [pairing, code, claim]);

  if (!pairing) {
    return (
      <>
        <Header title="Pfand-Retoure koppeln" sub="Code am Kassentablet unter Menü → Handy koppeln" />
        <div className="gx-panel rounded-3xl p-4">
          <label className="gx-muted mb-2 block text-sm font-semibold">Kopplungscode (6 Ziffern)</label>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
            className="w-full rounded-xl border border-[color:var(--gx-edge)] bg-[color:var(--gx-field)] px-4 py-4 text-center text-3xl font-extrabold tracking-[.3em] text-[color:var(--gx-text)]" />
          <button type="button" disabled={busy || code.length !== 6} onClick={() => void claim(code)}
            className="gx-btn gx-btn-pri mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl text-lg font-bold">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />} Koppeln
          </button>
          <ErrorLine text={error} />
          {error && (
            <div className="mt-3 grid grid-cols-1 gap-2">
              <button type="button" disabled={busy} onClick={() => void claim(code)} className="gx-btn min-h-12 rounded-xl font-bold">Erneut versuchen</button>
              <p className="gx-muted text-center text-xs">Ist der Code abgelaufen: am Tablet „Erneut versuchen“ tippen und den neuen QR-Code scannen.</p>
            </div>
          )}
        </div>
      </>
    );
  }
  return <PfandBooking pairing={pairing} onEnd={() => { saveSession(PFAND_KEY, null); setPairing(null); setCode(''); }} />;
}

function PfandBooking({ pairing, onEnd }: { pairing: PfandPairing; onEnd: () => void }) {
  const [count, setCount] = useState(0);
  const [entry, setEntry] = useState('0');
  const choose = (n: number) => { const v = Math.min(999, Math.max(0, n)); setCount(v); setEntry(String(v)); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [booked, setBooked] = useState<Booked[]>([]);
  const [minimized, setMinimized] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [endedByUser, setEndedByUser] = useState(false);
  const total = count * pairing.pfand_amount;

  async function endPairing() {
    setConfirmEnd(false);
    await callMobile('pfand_unpair', { token: pairing.token }).catch(() => undefined);
    setEndedByUser(true);
    setEnded('Die Kopplung wurde beendet. Bitte neu verbinden.');
    setMinimized(false);
  }

  // Beendete Kopplung: gespeicherten Zugriffstoken dieses Handys sofort löschen.
  useEffect(() => { if (ended) saveSession(PFAND_KEY, null); }, [ended]);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  // Browser/Tab wird wirklich geschlossen (nicht nur Bildschirmsperre): Kopplung beenden, Handy muss neu koppeln.
  useEffect(() => {
    const onHide = (event: PageTransitionEvent) => { if (!event.persisted) { unpairPhoneOnClose(pairing.token); saveSession(PFAND_KEY, null); } };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [pairing.token]);
  // Kopplung regelmäßig prüfen: endet sie (Tagesabschluss, „Kopplung beenden“), wird nicht mehr gebucht.
  useEffect(() => {
    const check = async () => {
      try { await callMobile('pfand_status', { token: pairing.token }); setOnline(true); }
      catch (cause) {
        if (cause instanceof MobileApiError && cause.status === 410) setEnded(cause.message);
        else if (cause instanceof MobileApiError && cause.status === 0) setOnline(false);
      }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [pairing.token]);

  // 28.11.: Ohne Verbindung merkt sich das Handy die Buchung (state 'queued') und sendet sie automatisch, sobald es wieder online ist.
  // Die Bon-ID bleibt gleich, der Server bucht denselben Bon nie doppelt. Die Kopplung bleibt dabei bestehen.
  async function send(entry: Booked) {
    try {
      const result = await callMobile<{ total: number }>('pfand_book', { token: pairing.token, id: entry.id, count: entry.count });
      setBooked((list) => list.map((b) => b.id === entry.id ? { ...b, state: 'ok', total: result.total } : b));
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof MobileApiError && cause.status === 0) {
        setOnline(false);
        setBooked((list) => list.map((b) => b.id === entry.id ? { ...b, state: 'queued' } : b));
        return true; // gemerkt, wird automatisch gesendet
      }
      if (cause instanceof MobileApiError && cause.status === 410) setEnded(message);
      setBooked((list) => list.map((b) => b.id === entry.id ? { ...b, state: 'error' } : b));
      setError(`${message} Bon NICHT gebucht – nicht auszahlen.`);
      return false;
    }
  }

  // Wartende Buchungen automatisch nachsenden (älteste zuerst), sobald das Netz wieder da ist.
  const bookedRef = useRef<Booked[]>([]);
  bookedRef.current = booked;
  const flushing = useRef(false);
  useEffect(() => {
    const flush = async () => {
      if (flushing.current || ended || !navigator.onLine) return;
      const waiting = [...bookedRef.current].filter((b) => b.state === 'queued').reverse();
      if (waiting.length === 0) return;
      flushing.current = true;
      try { for (const entry of waiting) { const ok = await send(entry); if (!ok) break; if (!navigator.onLine) break; } }
      finally { flushing.current = false; }
    };
    const timer = window.setInterval(() => { void flush(); }, 6_000);
    window.addEventListener('online', flush);
    const renderBooked = (b: Booked) => (
    <li key={b.id} className="flex items-center gap-2 text-sm">
                <span className="gx-muted w-20 font-mono">{time(b.at)}</span>
                <span className="font-bold">{b.count} Stück</span>
                <span className="ml-auto font-bold">{formatCurrency(b.total)}</span>
                <span className={`w-24 text-right text-xs font-bold ${b.state === 'ok' ? 'text-[color:var(--gx-ok)]' : b.state === 'error' ? 'text-[color:var(--gx-err)]' : b.state === 'queued' ? 'text-[color:var(--gx-warn)]' : 'gx-muted'}`}>
                  {b.state === 'ok' ? '✓ gebucht' : b.state === 'error' ? '✗ nicht gebucht' : b.state === 'queued' ? '⏳ wartet auf Netz' : '… sendet'}
                </span>
                {b.state === 'error' && !ended && <button type="button" onClick={() => { setError(null); setBooked((l) => l.map((x) => x.id === b.id ? { ...x, state: 'pending' } : x)); void send(b); }} className="gx-btn rounded-lg px-2 py-1 text-xs font-bold">Erneut</button>}
              </li>
  );
  return () => { window.clearInterval(timer); window.removeEventListener('online', flush); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- send/ended werden über Referenzen und frische Renderer erfasst
  }, [pairing.token, ended]);

  async function book() {
    if (busy || ended || count < 1) return;
    setBusy(true); setError(null); setMobileBusy(true);
    const entry: Booked = { id: newMobileReceiptId(), count, total: -total, at: Date.now(), state: 'pending' };
    setBooked((list) => [entry, ...list].slice(0, 20));
    const ok = await send(entry);
    if (ok) choose(0);
    setBusy(false); setMobileBusy(false);
  }

  // Minimiert: nur ein schwebender Knopf; die Kopplung bleibt aktiv (Status wird weiter geprüft).
  if (minimized && !ended) {
    return (
      <div className="flex min-h-[80dvh] items-center justify-center">
        <button type="button" onClick={() => setMinimized(false)} aria-label="Pfand-Fenster öffnen"
          className="gx-btn gx-btn-ok fixed bottom-6 right-6 flex h-20 w-20 flex-col items-center justify-center rounded-full text-xs font-extrabold shadow-2xl">
          <Recycle className="h-8 w-8" /> Pfand
        </button>
        <p className="gx-muted max-w-xs text-center text-sm font-semibold">Pfand-Fenster minimiert – Kopplung {pairing.location} bleibt aktiv. Grünen Knopf antippen zum Öffnen.</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="gx-heading text-xs font-bold uppercase tracking-[.14em]">WOODMO</p>
          <h1 className="gx-text truncate text-xl font-extrabold">Pfand-Retoure</h1>
          <p className="gx-muted truncate text-xs font-semibold">{pairing.staff_name} · Handy gekoppelt</p>
        </div>
        {!ended && <button type="button" onClick={() => setMinimized(true)} aria-label="Minimieren (Kopplung bleibt)"
          className="gx-btn flex min-h-12 items-center justify-center gap-1 rounded-xl px-3 text-sm font-bold"><ChevronDown className="h-5 w-5" /> Minimieren</button>}
      </div>
      {!ended && <div className="mb-3"><SwipeConfirm compact direction="right" tone="danger" label="Kopplung aufheben" disabled={busy} onConfirm={() => setConfirmEnd(true)} /></div>}
      {confirmEnd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="alertdialog" aria-modal="true">
          <div className="gx-panel w-full max-w-sm rounded-3xl p-5">
            <p className="text-lg font-extrabold">Wollen Sie wirklich die Kopplung beenden?</p>
            <p className="gx-muted mt-1 text-sm">Danach sind keine Pfandretouren mit diesem Handy mehr möglich.</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setConfirmEnd(false)} className="gx-btn min-h-14 rounded-xl text-lg font-bold">Nein</button>
              <button type="button" onClick={() => void endPairing()} className="gx-btn gx-btn-danger min-h-14 rounded-xl text-lg font-bold">Ja</button>
            </div>
          </div>
        </div>
      )}
      <div className="gx-panel mb-3 flex items-center gap-2 rounded-2xl px-4 py-3">
        <MapPin className="h-5 w-5" />
        <span className="text-lg font-extrabold">{pairing.location}</span>
        <span className="gx-muted ml-auto text-sm font-semibold">{formatCurrency(pairing.pfand_amount)} je Stück</span>
      </div>
      {!online && <p className="mb-3 flex items-center gap-2 text-sm font-bold text-red-500"><span className="h-3 w-3 animate-pulse rounded-full bg-red-500" /> Keine Verbindung</p>}
      {ended ? (
        <div className="gx-panel rounded-3xl p-5 text-center">
          <p className="text-lg font-extrabold text-[color:var(--gx-err)]">{endedByUser ? ended : 'Kopplung beendet'}</p>
          {!endedByUser && <p className="gx-muted mt-1 text-sm">{ended} Bitte neu verbinden.</p>}
          <button type="button" onClick={onEnd} className="gx-btn gx-btn-pri mt-4 min-h-12 w-full rounded-xl font-bold">Neu verbinden</button>
        </div>
      ) : (
        <div className="gx-panel rounded-3xl p-4">
          <div className="flex items-center justify-between gap-3">
            <button type="button" aria-label="Weniger" onClick={() => choose(count - 1)} className="gx-btn flex h-20 w-20 items-center justify-center rounded-2xl"><Minus className="h-8 w-8" /></button>
            <div className="text-center">
              <input value={entry} inputMode="numeric" aria-label="Anzahl"
                onFocus={() => { setEntry(''); setCount(0); }}
                onBlur={() => { if (!entry) setEntry('0'); }}
                onChange={(e) => { const digits = e.target.value.replace(/\D/g, '').slice(0, 3); setEntry(digits); setCount(digits ? Number(digits) : 0); }}
                placeholder="0"
                className="w-28 bg-transparent text-center text-6xl font-black text-[color:var(--gx-text)]" />
              <p className="gx-muted text-sm font-semibold">Stück</p>
            </div>
            <button type="button" aria-label="Mehr" onClick={() => choose(count + 1)} className="gx-btn flex h-20 w-20 items-center justify-center rounded-2xl"><Plus className="h-8 w-8" /></button>
          </div>
          <div className="mt-3 grid grid-cols-6 gap-2">
            <button type="button" disabled={count === 0 && (entry === '' || entry === '0')} onClick={() => choose(0)} aria-label="Auf 0 zurücksetzen" title="Auf 0 zurücksetzen"
              className="gx-btn flex min-h-12 items-center justify-center rounded-xl disabled:opacity-40"><RotateCcw className="h-5 w-5" /></button>
            {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => choose(n)} className="gx-btn min-h-12 rounded-xl text-lg font-bold">{n}</button>)}
          </div>
          <p className="mt-4 text-center text-sm font-semibold gx-muted">Auszahlen</p>
          <p className="text-center text-4xl font-black text-[color:var(--gx-ok)]">{formatCurrency(total)}</p>
          <SwipeConfirm label={count < 1 ? 'Erst Anzahl wählen' : '← Zum Buchen nach links schieben'} disabled={count < 1 || Boolean(ended)} busy={busy} onConfirm={() => void book()} />
          <ErrorLine text={error} />
        </div>
      )}
      {booked.length > 0 && (
        <div className="gx-panel mt-3 rounded-2xl p-3">
          <p className="gx-heading mb-2 text-xs font-bold uppercase tracking-[.12em]">Von diesem Handy</p>
          <ul className="space-y-1.5">
            {booked.slice(0, 3).map(renderBooked)}
          </ul>{booked.length > 3 && (<details className="mt-1.5"><summary className="gx-muted cursor-pointer text-xs font-bold">Weitere {booked.length - 3} anzeigen</summary><ul className="mt-1.5 space-y-1.5">{booked.slice(3).map(renderBooked)}</ul></details>)}
        </div>
      )}
    </>
  );
}

// ---------------- Administrator-Übersicht ----------------
interface AdminLogin { token: string; name: string }
interface Receipt { id: string; at: number; total: number; payment: string; employee: string | null; storno: boolean; items: string[] }
interface OpenSession {
  session_id: string; location: string; opened_at: number; opened_by: string | null; opening_balance: number; logged_in: string[];
  receipts: number; total: number; goods: number; pfand: number; cash: number; card: number; storno_gross: number; cash_balance: number;
  last_receipt_at: number | null; recent: Receipt[];
  status?: 'open' | 'closed'; closed_at?: number | null; closing_balance?: number | null;
}
const REFRESH_MS = 15_000;
const STALE_MS = 45_000;

function AdminMobile() {
  const [login, setLogin] = useState<AdminLogin | null>(() => loadSession<AdminLogin>(ADMIN_KEY));
  const logout = () => {
    if (login) void callMobile('admin_logout', { token: login.token }).catch(() => undefined);
    saveSession(ADMIN_KEY, null); setLogin(null);
  };
  return login ? <AdminOverview login={login} onLogout={logout} /> : <AdminLoginForm onLogin={(l) => { saveSession(ADMIN_KEY, l); setLogin(l); }} />;
}

function AdminLoginForm({ onLogin }: { onLogin: (l: AdminLogin) => void }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    callMobile<{ names: string[] }>('admin_names').then((r) => { if (alive && Array.isArray(r.names)) { setNames(r.names); if (r.names.length === 1) setName(r.names[0]); } }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  async function submit() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await callMobile<{ token: string; name: string }>('admin_login', { name, password });
      setPassword(''); onLogin({ token: result.token, name: result.name });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return (
    <>
      <Header title="Mobile Kassenübersicht" sub="Nur für Administratoren · nur lesen" />
      <form className="gx-panel space-y-3 rounded-3xl p-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {names.length > 0 ? (
          <label className="block text-sm font-semibold gx-muted">Administrator wählen
            <select value={name} onChange={(e) => setName(e.target.value)} aria-label="Administrator wählen"
              className="mt-1 w-full rounded-xl border border-[color:var(--gx-edge)] bg-[color:var(--gx-field)] px-3 py-3 text-lg font-bold text-[color:var(--gx-text)]">
              <option value="">Bitte wählen …</option>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        ) : (
        <label className="block text-sm font-semibold gx-muted">Administrator-Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username"
            className="mt-1 w-full rounded-xl border border-[color:var(--gx-edge)] bg-[color:var(--gx-field)] px-3 py-3 text-base text-[color:var(--gx-text)]" />
        </label>
        )}
        <label className="block text-sm font-semibold gx-muted">Persönliches Passwort
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
            className="mt-1 w-full rounded-xl border border-[color:var(--gx-edge)] bg-[color:var(--gx-field)] px-3 py-3 text-base text-[color:var(--gx-text)]" />
        </label>
        <button type="submit" disabled={busy || !name.trim() || !password} className="gx-btn gx-btn-pri flex min-h-12 w-full items-center justify-center gap-2 rounded-xl font-bold">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />} Anmelden
        </button>
        <ErrorLine text={error} />
      </form>
    </>
  );
}

function AdminOverview({ login, onLogout }: { login: AdminLogin; onLogout: () => void }) {
  const [sessions, setSessions] = useState<OpenSession[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result = await callMobile<{ sessions: OpenSession[] }>('admin_overview', { token: login.token });
      setSessions(result.sessions); setFetchedAt(Date.now()); setError(null);
    } catch (cause) {
      if (cause instanceof MobileApiError && cause.status === 401) { onLogout(); return; }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }, [login.token, onLogout]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); window.clearInterval(tick); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const stale = fetchedAt === null || now - fetchedAt > STALE_MS;
  const current = sessions?.find((s) => s.session_id === selected) ?? null;

  return (
    <>
      <Header title={current ? current.location : 'Offene Kassen'} sub={`${login.name} · nur lesen`} onLogout={onLogout} />
      <div className={`mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${stale ? 'border border-[color:var(--gx-warn)] text-[color:var(--gx-warn)]' : 'gx-muted'}`}>
        {stale ? <WifiOff className="h-4 w-4" /> : <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />}
        {fetchedAt ? `Stand ${time(fetchedAt)}${stale ? ' – VERALTET, keine aktuelle Verbindung' : ''}` : 'Lädt …'}
        <button type="button" onClick={() => void load()} className="gx-btn ml-auto rounded-lg px-2 py-1 text-xs">Aktualisieren</button>
      </div>
      <ErrorLine text={error} />
      <div className={stale && sessions ? 'opacity-60' : ''}>
        {sessions && sessions.length === 0 && <p className="gx-panel rounded-2xl p-4 text-center font-semibold">Keine Kasse vorhanden.</p>}
        {!current && sessions?.map((s) => (
          <button key={s.session_id} type="button" onClick={() => setSelected(s.session_id)} className={`gx-tile mb-3 block w-full rounded-3xl p-4 text-left ${s.status === 'closed' ? 'border-2 border-[color:var(--gx-warn)] bg-[color:var(--gx-warn)]/10' : ''}`}>
            <div className="flex items-center gap-2"><MapPin className="h-5 w-5" /><span className="text-xl font-extrabold">{s.location}</span>
              {s.status === 'closed'
                ? <span className="ml-auto rounded-full border border-[color:var(--gx-warn)] px-2 py-0.5 text-xs font-bold text-[color:var(--gx-warn)]">GESCHLOSSEN</span>
                : <span className="ml-auto rounded-full border border-[color:var(--gx-ok)] px-2 py-0.5 text-xs font-bold text-[color:var(--gx-ok)]">OFFEN</span>}</div>
            {s.status === 'closed' && s.closed_at ? <p className="mt-1 text-sm font-extrabold text-[color:var(--gx-warn)]">Kassenvorgang geschlossen am {new Date(s.closed_at).toLocaleString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p> : null}
            <p className="gx-muted mt-1 text-xs font-semibold">{s.status === 'closed' ? 'geöffnet' : 'seit'} {new Date(s.opened_at).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {s.receipts} Bons</p>
            <p className="mt-2 text-3xl font-black">{formatCurrency(s.total)}</p>
            {s.status === 'closed' && <p className="text-sm font-bold">Kassenbestand: {formatCurrency(s.cash_balance)}</p>}
            <p className="gx-muted text-xs">Letzter Bon: {s.last_receipt_at ? time(s.last_receipt_at) : '–'}</p>
          </button>
        ))}
        {current && <SessionDetail s={current} onBack={() => setSelected(null)} />}
      </div>
      <p className="gx-muted mt-4 text-center text-[11px]">Zeigt nur Bons, die die Kassen schon in die Cloud übertragen haben.</p>
    </>
  );
}

function SessionDetail({ s, onBack }: { s: OpenSession; onBack: () => void }) {
  const row = (label: string, value: string, strong = false) => (
    <div className="flex items-baseline justify-between py-1"><span className="gx-muted text-sm">{label}</span><span className={strong ? 'text-lg font-black' : 'font-bold'}>{value}</span></div>
  );
  return (
    <>
      <button type="button" onClick={onBack} className="gx-btn mb-3 min-h-11 rounded-xl px-4 text-sm font-bold">← Alle Kassen</button>
      <div className="gx-panel mb-3 rounded-3xl p-4">
        {row('Status', s.status === 'closed' ? 'GESCHLOSSEN' : 'OFFEN')}
        {s.status === 'closed' && s.closed_at ? row('Geschlossen', new Date(s.closed_at).toLocaleString('de-DE')) : null}
        {row('Geöffnet', `${new Date(s.opened_at).toLocaleString('de-DE')}${s.opened_by ? ' · ' + s.opened_by : ''}`)}
        {row('Angemeldet', s.logged_in.length ? s.logged_in.join(', ') : '–')}
        <div className="my-2 border-t gx-rule" />
        {row('Tagesumsatz (Saldo)', formatCurrency(s.total), true)}
        {row('Ware ohne Pfand', formatCurrency(s.goods))}
        {row('Pfand (Saldo)', formatCurrency(s.pfand))}
        {row('davon Bar', formatCurrency(s.cash))}
        {row('davon Karte', formatCurrency(s.card))}
        {s.storno_gross !== 0 && row('Stornos', formatCurrency(s.storno_gross))}
        <div className="my-2 border-t gx-rule" />
        {row('Anfangsbestand', formatCurrency(s.opening_balance))}
        {row(s.status === 'closed' ? 'Kassenbestand (nach Abschluss)' : 'Bargeld (rechnerisch)', formatCurrency(s.cash_balance), true)}
        {row('Bons', String(s.receipts))}
      </div>
      <p className="gx-heading mb-2 text-xs font-bold uppercase tracking-[.12em]">Letzte Verkäufe</p>
      <ul className="space-y-2">
        {s.recent.map((r) => (
          <li key={r.id} className={`gx-panel rounded-2xl p-3 ${r.storno ? 'opacity-60' : ''}`}>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono font-bold">{time(r.at)}</span>
              <span className="rounded-full border px-2 text-xs font-bold">{r.payment === 'card' ? 'Karte' : 'Bar'}</span>
              {r.storno && <span className="text-xs font-bold text-[color:var(--gx-err)]">STORNIERT</span>}
              <span className="ml-auto font-black">{formatCurrency(r.total)}</span>
            </div>
            <p className="gx-muted mt-1 text-xs">{r.items.join(' · ')}{r.employee ? ` — ${r.employee}` : ''}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
