import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronsLeft, ChevronsRight, Loader2 } from 'lucide-react';

interface Props {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  /** Schieberichtung: 'left' (Standard, Buchen) oder 'right' (Kopplung lösen). */
  direction?: 'left' | 'right';
  tone?: 'ok' | 'danger';
  compact?: boolean;
}

const KNOB_BIG = 64;   // px, Daumengröße
const TRAVEL_BIG = 170;// px, kurze Schiebestrecke für eine Hand
const DONE_AT = 0.92;  // Anteil der Strecke, ab dem beim Loslassen gebucht wird

/**
 * 27.11.: Schieberegler statt Knopf. Bucht nur, wenn der Regler von rechts nach links
 * fast bis zum Ende geschoben und dort losgelassen wird. Tippen allein löst nichts aus.
 */
export function SwipeConfirm({ label, disabled, busy, onConfirm, direction = 'left', tone = 'ok', compact = false }: Props) {
  const KNOB = compact ? 44 : KNOB_BIG;
  const TRAVEL = compact ? 150 : TRAVEL_BIG;
  const dir = direction === 'right' ? -1 : 1; // Verschiebung = dir * (startX - clientX)
  const color = tone === 'danger' ? 'var(--gx-err)' : 'var(--gx-ok)';
  const [offset, setOffset] = useState(0);
  const drag = useRef<{ id: number; startX: number } | null>(null);
  const locked = disabled || busy;

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (locked || drag.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, startX: e.clientX };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setOffset(Math.min(TRAVEL, Math.max(0, dir * (d.startX - e.clientX))));
  };
  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const reached = !cancelled && Math.min(TRAVEL, Math.max(0, dir * (d.startX - e.clientX))) >= TRAVEL * DONE_AT;
    setOffset(0);
    if (reached && !locked) onConfirm();
  };

  const progress = offset / TRAVEL;
  return (
    <div className={`${compact ? '' : 'mt-4 '}flex ${direction === 'right' ? 'justify-start' : 'justify-end'}`}>
      <div className={`relative select-none overflow-hidden rounded-full border ${locked ? 'opacity-50' : ''}`}
        style={{ height: KNOB + 8, width: TRAVEL + KNOB + 8, borderColor: color, background: tone === 'danger' ? 'transparent' : 'var(--gx-ok-bg)', touchAction: 'none' }}
        aria-label={label} role="slider" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <span className="pointer-events-none absolute inset-y-0 flex items-center justify-center text-center text-sm font-extrabold leading-tight"
          style={{ opacity: 1 - progress, color, ...(direction === 'right' ? { left: KNOB + 12, right: 8 } : { left: 16, right: KNOB + 12 }) }}>
          {busy ? 'bucht …' : label}
        </span>
        <div
          onPointerDown={onDown} onPointerMove={onMove}
          onPointerUp={(e) => finish(e, false)} onPointerCancel={(e) => finish(e, true)}
          className={`gx-btn ${tone === 'danger' ? 'gx-btn-danger' : 'gx-btn-ok'} absolute top-1 flex items-center justify-center rounded-full`}
          style={{ width: KNOB, height: KNOB, [direction === 'right' ? 'left' : 'right']: 4 + offset, transition: drag.current ? 'none' : `${direction === 'right' ? 'left' : 'right'} .2s ease`, touchAction: 'none', cursor: locked ? 'not-allowed' : 'grab' }}>
          {busy ? <Loader2 className="h-7 w-7 animate-spin" /> : direction === 'right' ? <ChevronsRight className="h-6 w-6" /> : <ChevronsLeft className="h-8 w-8" />}
        </div>
      </div>
    </div>
  );
}
