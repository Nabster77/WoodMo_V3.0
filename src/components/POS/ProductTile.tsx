import type { CSSProperties, ReactNode } from 'react';
import type { Product, Location } from '@/types';
import { formatCurrency } from '@/lib/format';
import { taxRateForProduct } from '@/lib/tax';
import { publicAssetUrl } from '@/lib/publicAssetUrl';
import { Package, GripVertical, Euro } from 'lucide-react';
import { spiritColor } from '@/lib/spiritColors';
import { alpha } from '@/lib/categoryAccent';

interface Props {
  product: Product;
  location: Location;
  onAdd: (product: Product) => void;
  disabled?: boolean;
  dragMode?: boolean;
  onDragStart?: (id: string) => void;
  onDragOver?: (id: string) => void;
  onDrop?: () => void;
  isDraggedOver?: boolean;
  isDragging?: boolean;
  /** Kompakt-Ansicht ohne Bild (Umschalter "Bilder an/aus" in der Kasse). */
  compact?: boolean;
  /** Leitfarbe der Warengruppe (#rrggbb) für den getönten Hintergrund gekennzeichneter Artikel. */
  groupColor?: string;
}

/**
 * Kennzeichnung Likör / Schnaps (Excel-Spalte „Kennzeichnung“), damit man sich
 * bei den Kurzen nicht vertippt. Farben siehe spiritColors.ts.
 */
export function SpiritBadge({ kind, className = 'rounded px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide' }: { kind?: Product['spiritType']; className?: string }) {
  const color = spiritColor(kind);
  if (!color) return null;
  return (
    <span style={{ backgroundColor: color }} className={`${className} text-white`}>
      {kind === 'likoer' ? 'LIKÖR' : 'SCHNAPS'}
    </span>
  );
}

export function ProductTile({
  product, location, onAdd, disabled,
  dragMode, onDragStart, onDragOver, onDrop,
  isDraggedOver, isDragging, compact, groupColor,
}: Props) {
  const isDisabled = !product.available || disabled;
  const price = product.prices[location];
  const pfand = product.pfand[location];
  // Gekennzeichnete Artikel: nur der Rahmen in der Kennzeichnungsfarbe.
  const markColor = isDraggedOver ? undefined : spiritColor(product.spiritType);
  const markStyle = markColor ? { borderColor: markColor } : undefined;
  const stateClasses = `${isDragging ? 'opacity-40' : ''} ${dragMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer active:scale-[0.97]'} ${isDisabled && !dragMode ? 'cursor-not-allowed opacity-40' : ''}`;

  if (compact) {
    // Kompakte Kachel ohne Bild, alles mittig: Name, gleich große Hinweise (Kennzeichnung,
    // Schuss, Pfand), MwSt rutscht nach, darunter der Preis. Gekennzeichnete Artikel
    // (Kurze, Flaschen) bekommen Rahmen in Kennzeichnungsfarbe und leicht getönten Hintergrund
    // in der Farbe ihrer Warengruppe.
    const tint = markColor && groupColor ? { backgroundColor: alpha(groupColor, 0.22) } : undefined;
    const compactClasses = `group relative flex min-h-[6.25rem] min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border-2 bg-slate-800 px-1.5 py-2 text-center shadow-sm transition-all ${
      isDraggedOver
        ? 'border-blue-500 ring-2 ring-blue-400/50'
        : markColor
          ? 'hover:brightness-110'
          : 'border-slate-600/70 hover:border-emerald-400/80'
    } ${stateClasses}`;
    const chip = 'inline-flex w-[3.9rem] justify-center rounded px-1 py-0.5 text-[10px] font-extrabold tracking-wide';
    const compactInner = (
      <>
        <span className="line-clamp-2 w-full break-words text-base font-bold leading-tight text-white">
          {product.name}
        </span>
        <div className="flex flex-wrap items-center justify-center gap-1">
          <SpiritBadge kind={product.spiritType} className={chip} />
          {product.hasShot && <span className={`${chip} bg-blue-600 text-white`}>SCHUSS</span>}
          {(product.isPfandArticle || pfand > 0) && <span className={`${chip} bg-green-400 text-slate-950`}>PFAND</span>}
          <span className="rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">{taxRateForProduct(product, location)}%</span>
        </div>
        {product.hasIndividualPrice ? (
          <span className="text-sm font-extrabold text-amber-300"><Euro className="inline h-3 w-3" /> Preis individuell</span>
        ) : (
          <span className="text-lg font-extrabold leading-none text-blue-300">{formatCurrency(price)}</span>
        )}
        {dragMode && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <GripVertical className="h-6 w-6 text-white" />
          </div>
        )}
      </>
    );
    return renderTile(compactClasses, compactInner, { ...markStyle, ...tint });
  }

  // Square, full-bleed picture like the approved visual reference.
  // The picture fills the entire tile; a dark overlay near the bottom keeps
  // article name, price and deposit legible on 800 x 800 product images.
  const tileClasses = `group relative isolate aspect-square min-w-0 overflow-hidden rounded-xl border bg-slate-800 text-left shadow-sm transition-all ${
    isDraggedOver
      ? 'border-blue-500 ring-2 ring-blue-400/50'
      : markColor
        ? 'border-2 hover:shadow-lg'
        : 'border-slate-600/70 hover:border-emerald-400/80 hover:shadow-lg'
  } ${stateClasses}`;

  const inner = (
    <>
      {product.imageUrl ? (
        <img
          src={publicAssetUrl(product.imageUrl)}
          alt={product.name}
          className="absolute inset-0 h-full w-full object-cover object-center"
          draggable={false}
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
          <Package className="h-12 w-12 text-slate-400" />
        </div>
      )}
      {/* All visual badges stay in front of the photo. */}
      <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
        {taxRateForProduct(product, location)}%
      </span>
      {product.hasShot && (
        <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-blue-600/95 px-1.5 py-0.5 text-[10px] font-bold text-white">
          Schuss
        </span>
      )}
      {product.hasIndividualPrice && (
        <span className={`absolute top-1.5 z-10 rounded-full bg-amber-500/95 px-1.5 py-0.5 text-[10px] font-bold text-white ${product.hasShot ? 'left-16' : 'left-1.5'}`}>
          <Euro className="inline h-2.5 w-2.5" /> Variabel
        </span>
      )}
      {product.isPfandArticle && (
        <span className="absolute bottom-[43%] left-1.5 z-10 rounded-full bg-teal-600/95 px-1.5 py-0.5 text-[10px] font-bold text-white">
          Pfand
        </span>
      )}

      {/* Translucent caption sits ON the square image, not below it.
          Keep the price and deposit together; no light-gray gutters. */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex min-h-[29%] flex-col items-center justify-center gap-1 border-t border-white/10 bg-slate-950/85 px-2 py-2 text-center text-white backdrop-blur-[2px]">
        <SpiritBadge kind={product.spiritType} />
        <span className="line-clamp-2 break-words text-sm font-bold leading-tight text-white sm:text-base">
          {product.name}
        </span>
        {product.hasIndividualPrice ? (
          <span className="text-sm font-extrabold text-amber-300 sm:text-base">Preis individuell</span>
        ) : (
          <span className="text-sm font-extrabold text-blue-400 sm:text-base">{formatCurrency(price)}</span>
        )}
        {pfand > 0 && (
          <span className="text-xs font-medium leading-tight text-slate-200">+ {formatCurrency(pfand)} Pfand</span>
        )}
      </div>
      {dragMode && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <GripVertical className="h-7 w-7 text-white" />
        </div>
      )}
    </>
  );

  return renderTile(tileClasses, inner, markStyle);

  function renderTile(classes: string, content: ReactNode, style?: CSSProperties) {
    if (dragMode) {
      return (
        <div
          draggable
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(product.id); }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver?.(product.id); }}
          onDrop={(e) => { e.preventDefault(); onDrop?.(); }}
          className={classes}
          style={style}
        >
          {content}
        </div>
      );
    }

    return (
      <button
        onClick={() => onAdd(product)}
        disabled={isDisabled}
        className={classes}
        style={style}
      >
        {content}
      </button>
    );
  }
}
