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
  isDraggedOver, isDragging, compact,
}: Props) {
  const isDisabled = !product.available || disabled;
  const price = product.prices[location];
  const pfand = product.pfand[location];
  const stateClasses = `${isDragging ? 'opacity-40' : ''} ${dragMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer active:scale-[0.97]'} ${isDisabled && !dragMode ? 'cursor-not-allowed opacity-40' : ''}`;

  if (compact) {
    // Kompakte Kachel ohne Bild, Schwarz-Weiß: dunkler Hintergrund, weißer Rahmen
    // (Hellmodus umgekehrt). Alles mittig: Name, gleich große Hinweise (Kennzeichnung,
    // Schuss, Pfand), MwSt rutscht nach, darunter der Preis. Farbe tragen nur die Hinweise.
    const compactClasses = `group relative flex min-h-[6.25rem] min-w-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 bg-white px-1.5 py-2 text-center shadow-sm transition-all dark:bg-slate-900 ${
      isDraggedOver
        ? 'border-blue-500 ring-2 ring-blue-400/50'
        : 'border-slate-800 hover:bg-slate-100 dark:border-white/85 dark:hover:bg-slate-800'
    } ${stateClasses}`;
    const chip = 'inline-flex w-[3.6rem] justify-center rounded px-1 py-px text-[9px] font-extrabold tracking-wide';
    const compactInner = (
      <>
        {/* Feste Zeilen für alle Kacheln: Name (Hauptmerkmal, 2 Zeilen Platz), Hinweise, Preis + MwSt. */}
        <div className="flex h-[2.6rem] w-full items-center justify-center">
          <span className="line-clamp-2 break-words text-[1.05rem] font-extrabold leading-tight text-slate-900 dark:text-white">
            {product.name}
          </span>
        </div>
        <div className="flex h-4 items-center justify-center gap-1 overflow-hidden">
          <SpiritBadge kind={product.spiritType} className={chip} />
          {product.hasShot && <span className={`${chip} bg-blue-600 text-white`}>SCHUSS</span>}
          {(product.isPfandArticle || pfand > 0) && <span className={`${chip} bg-green-400 text-slate-950`}>PFAND</span>}
        </div>
        <div className="flex items-center justify-center gap-1.5">
          {product.hasIndividualPrice ? (
            <span className="text-xs font-bold text-amber-600 dark:text-amber-300"><Euro className="inline h-3 w-3" /> individuell</span>
          ) : (
            <span className="text-sm font-semibold leading-none text-slate-700 dark:text-slate-200">{formatCurrency(price)}</span>
          )}
          <span className="rounded-full bg-slate-200 px-1.5 py-px text-[9px] font-bold text-slate-700 dark:bg-white/15 dark:text-slate-200">{taxRateForProduct(product, location)}%</span>
        </div>
        {dragMode && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <GripVertical className="h-6 w-6 text-white" />
          </div>
        )}
      </>
    );
    return renderTile(compactClasses, compactInner);
  }

  // Square, full-bleed picture like the approved visual reference.
  // The picture fills the entire tile; a dark overlay near the bottom keeps
  // article name, price and deposit legible on 800 x 800 product images.
  const tileClasses = `group relative isolate aspect-square min-w-0 overflow-hidden rounded-xl border bg-slate-800 text-left shadow-sm transition-all ${
    isDraggedOver
      ? 'border-blue-500 ring-2 ring-blue-400/50'
      : 'border-slate-800 hover:shadow-lg dark:border-white/85'
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
        <span className="absolute bottom-[43%] left-1.5 z-10 rounded-full bg-green-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-950">
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
          <span className="text-xs font-medium leading-tight text-green-400">+ {formatCurrency(pfand)} Pfand</span>
        )}
      </div>
      {dragMode && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <GripVertical className="h-7 w-7 text-white" />
        </div>
      )}
    </>
  );

  return renderTile(tileClasses, inner);

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
