import type { CSSProperties, ReactNode } from 'react';
import type { Product, Location } from '@/types';
import { formatCurrency } from '@/lib/format';
import { taxRateForProduct } from '@/lib/tax';
import { publicAssetUrl } from '@/lib/publicAssetUrl';
import { Package, GripVertical, Euro } from 'lucide-react';
import { spiritColor } from '@/lib/spiritColors';

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
  /** Artikel liegt in einer Flaschen-Gruppe (andere Kennzeichnungsfarben). */
  bottle?: boolean;
}

/**
 * Kennzeichnung Likör / Schnaps (Excel-Spalte „Kennzeichnung“), damit man sich
 * bei den Kurzen nicht vertippt. Farben siehe spiritColors.ts.
 */
export function SpiritBadge({ kind, bottle = false }: { kind?: Product['spiritType']; bottle?: boolean }) {
  const color = spiritColor(kind, bottle);
  if (!color) return null;
  return (
    <span style={{ backgroundColor: color }} className="rounded px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-white">
      {kind === 'likoer' ? 'LIKÖR' : 'SCHNAPS'}
    </span>
  );
}

export function ProductTile({
  product, location, onAdd, disabled,
  dragMode, onDragStart, onDragOver, onDrop,
  isDraggedOver, isDragging, compact, bottle = false,
}: Props) {
  const isDisabled = !product.available || disabled;
  const price = product.prices[location];
  const pfand = product.pfand[location];
  // Gekennzeichnete Artikel: nur der Rahmen in der Kennzeichnungsfarbe.
  const markColor = isDraggedOver ? undefined : spiritColor(product.spiritType, bottle);
  const markStyle = markColor ? { borderColor: markColor } : undefined;
  const stateClasses = `${isDragging ? 'opacity-40' : ''} ${dragMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer active:scale-[0.97]'} ${isDisabled && !dragMode ? 'cursor-not-allowed opacity-40' : ''}`;

  if (compact) {
    // Niedrige Kachel ohne Bild: Name groß, Preis, Pfand, kleine Hinweise.
    // Liköre bekommen eine violette Kachel mit Band "LIKÖR".
    const compactClasses = `group relative flex min-h-[5.25rem] min-w-0 flex-col justify-between gap-1 overflow-hidden rounded-xl border-2 px-2.5 py-2 text-left shadow-sm transition-all ${
      isDraggedOver
        ? 'border-blue-500 ring-2 ring-blue-400/50'
        : markColor
          ? 'bg-slate-800 hover:brightness-110'
          : 'border-slate-600/70 bg-slate-800 hover:border-emerald-400/80'
    } ${stateClasses}`;
    const compactInner = (
      <>
        <div className="flex min-w-0 items-start justify-between gap-1">
          <span className="line-clamp-2 min-w-0 break-words text-base font-bold leading-tight text-white">
            {product.name}
          </span>
          <span className="shrink-0 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {taxRateForProduct(product, location)}%
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <SpiritBadge kind={product.spiritType} bottle={bottle} />
          {product.hasShot && (
            <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">Schuss</span>
          )}
          {product.isPfandArticle && (
            <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-bold text-white">Pfand</span>
          )}
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          {product.hasIndividualPrice ? (
            <span className="text-sm font-extrabold text-amber-300"><Euro className="inline h-3 w-3" /> Preis individuell</span>
          ) : (
            <span className="text-lg font-extrabold leading-none text-blue-300">{formatCurrency(price)}</span>
          )}
          {pfand > 0 && (
            <span className="text-xs font-medium leading-tight text-slate-200">+ {formatCurrency(pfand)} Pfand</span>
          )}
        </div>
        {dragMode && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <GripVertical className="h-6 w-6 text-white" />
          </div>
        )}
      </>
    );
    return renderTile(compactClasses, compactInner, markStyle);
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
        <SpiritBadge kind={product.spiritType} bottle={bottle} />
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
