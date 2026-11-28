import { useMemo } from 'react';
import { qrSvgPath } from '@/lib/qrCode';

/** QR-Code zum Abscannen mit der Handy-Kamera (immer schwarz auf weiß, auch im dunklen Design). */
export function QrCode({ text, size = 200 }: { text: string; size?: number }) {
  const qr = useMemo(() => { try { return qrSvgPath(text); } catch { return null; } }, [text]);
  if (!qr) return null;
  return (
    <svg role="img" aria-label="QR-Code zum Abscannen" width={size} height={size} viewBox={`0 0 ${qr.size} ${qr.size}`}
      shapeRendering="crispEdges" className="mx-auto rounded-xl" style={{ background: '#fff' }}>
      <path d={qr.path} fill="#000" />
    </svg>
  );
}
