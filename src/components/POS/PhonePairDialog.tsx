import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Smartphone, Unlink, X } from 'lucide-react';
import type { CashSession, StaffUser } from '@/types';
import { callMobileAsTablet, mobileLink } from '@/lib/mobileApi';
import { formatCurrency } from '@/lib/format';
import { QrCode } from '@/components/QrCode';

interface Props {
  session: CashSession;
  staff: StaffUser;
  pfandAmount: number;
  onClose: () => void;
  /** true, solange mindestens ein Handy gekoppelt ist (Kasse gleicht dann häufiger ab). */
  onPairedChange: (paired: boolean) => void;
  /** Ein Handy hat den Code gerade eingelöst: Fenster schließen, kurze Meldung. */
  onPaired: () => void;
}

interface Pairing { staff_name: string; claimed_at: string | null; last_used_at: string | null }

/** 27.11.: Handy für Pfand-Retouren an die offene Kasse koppeln. Bucht nur über die Cloud-Prüfung. */
export function PhonePairDialog({ session, staff, pfandAmount, onClose, onPairedChange, onPaired }: Props) {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const claimedCount = useRef(-1);

  const refresh = useCallback(async () => {
    try {
      const result = await callMobileAsTablet<{ pairings: Pairing[] }>('pair_list', { session_id: session.id });
      setPairings(result.pairings);
      const count = result.pairings.filter((p) => p.claimed_at).length;
      onPairedChange(count > 0);
      // Code wurde am Handy eingelöst: Fenster schließen.
      const before = claimedCount.current;
      claimedCount.current = count;
      if (before >= 0 && count > before) onPaired();
    } catch { /* Anzeige bleibt; nächster Versuch folgt */ }
  }, [session.id, onPairedChange, onPaired]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 4000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(timer); window.clearInterval(tick); };
  }, [refresh]);

  async function create() {
    setBusy(true); setError(null);
    try {
      const result = await callMobileAsTablet<{ code: string; expires_at: number }>('pair_create', {
        session_id: session.id, location: session.location, staff_id: staff.id, staff_name: staff.name, pfand_amount: pfandAmount,
      });
      setCode({ code: result.code, expiresAt: result.expires_at });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function revoke() {
    setBusy(true); setError(null);
    try {
      await callMobileAsTablet('pair_revoke', { session_id: session.id });
      setCode(null); setPairings([]); onPairedChange(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  const secondsLeft = code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0;
  const claimed = pairings.filter((p) => p.claimed_at);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="gx-dialog max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <Smartphone className="h-6 w-6" />
          <h2 className="text-xl font-bold">Handy koppeln</h2>
          <button type="button" aria-label="Schließen" onClick={onClose} className="ml-auto flex h-10 w-10 items-center justify-center rounded-xl"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-3 text-sm">Das Handy bucht nur <strong>Pfand-Retouren</strong> in diese Kasse: <strong>{session.location}</strong>, {formatCurrency(pfandAmount)} je Stück, Mitarbeiter {staff.name}.</p>
        {code && secondsLeft > 0 ? (
          <div className="mb-3 rounded-2xl border p-4 text-center">
            <p className="mb-2 text-sm font-bold">Mit der Handy-Kamera scannen:</p>
            <QrCode text={mobileLink('pfand', code.code)} size={220} />
            <p className="mt-3 text-xs font-bold">Kein zweites Gerät zum Scannen? Direkt auf diesem Handy:</p>
            <a href={mobileLink('pfand', code.code)} target="_blank" rel="noopener noreferrer" className="bg-slate-900 mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-3 text-base font-bold underline">
              <Smartphone className="h-5 w-5" /> Handy-Link öffnen
            </a>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(mobileLink('pfand', code.code)).catch(() => undefined); }} className="mt-2 min-h-11 w-full rounded-xl text-sm font-bold">Link kopieren (zum Einfügen in Safari/Chrome)</button>
            <p className="mt-3 text-xs">oder Link <a href={mobileLink('pfand')} target="_blank" rel="noopener noreferrer" className="break-all font-mono font-bold underline">{mobileLink('pfand')}</a> öffnen und Code eingeben:</p>
            <p className="font-mono text-3xl font-black tracking-[.2em]">{code.code}</p>
            <p className="mt-1 text-xs">gültig noch {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} Min · nur einmal verwendbar</p>
          </div>
        ) : code ? (
          <div className="mb-3 rounded-2xl border p-4 text-center">
            <p className="text-sm font-bold">Code abgelaufen – keine Kopplung.</p>
            <button type="button" disabled={busy} onClick={() => void create()} className="bg-slate-900 mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl font-bold">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Smartphone className="h-5 w-5" />} Erneut versuchen
            </button>
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => void create()} className="bg-slate-900 mb-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl text-base font-bold">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Smartphone className="h-5 w-5" />} Kopplungscode erzeugen
          </button>
        )}
        <p className="mb-1 text-sm font-bold">Gekoppelte Handys: {claimed.length}</p>
        <ul className="mb-3 space-y-1 text-xs">
          {claimed.map((p, i) => <li key={i}>Handy {i + 1} · gekoppelt {new Date(p.claimed_at!).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}{p.last_used_at ? ` · letzte Buchung ${new Date(p.last_used_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : ''}</li>)}
        </ul>
        {(claimed.length > 0 || code) && (
          <button type="button" disabled={busy} onClick={() => void revoke()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold">
            <Unlink className="h-4 w-4" /> Alle Handys dieser Kasse entkoppeln
          </button>
        )}
        {error && (
          <div className="mt-3">
            <p className="text-sm font-semibold text-red-600">{error}</p>
            <button type="button" disabled={busy} onClick={() => void create()} className="mt-2 min-h-11 w-full rounded-xl text-sm font-bold">Erneut versuchen</button>
          </div>
        )}
        <p className="mt-3 text-xs">Die Kopplung endet automatisch mit dem Tagesabschluss. Handy-Buchungen erscheinen hier nach dem nächsten Abgleich (wenige Sekunden).</p>
      </div>
    </div>
  );
}
