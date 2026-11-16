import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CartItem, Category, CashSession, Product, Transaction, ShotOption, Location, PfandSettings, StaffSecurityQuestion, StaffUser } from '@/types';
import { ProductTile } from './ProductTile';
import { CartItemRow } from './CartItemRow';
import { CartSummary } from './CartSummary';
import { CheckoutModal, type CheckoutSaveResult } from './CheckoutModal';
import { CashOpeningDialog } from './CashOpeningDialog';
import { CashEntryDialog } from './CashEntryDialog';
import { CashCorrectionDialog } from './CashCorrectionDialog';
import { DailyCloseDialog } from './DailyCloseDialog';
import { ShotSelectionDialog } from './ShotSelectionDialog';
import { PfandRetoureDialog } from './PfandRetoureDialog';
import { BonlisteDialog } from './BonlisteDialog';
import type { StornoRecord } from '@/lib/stornoRules';
import type { StornoCloudState } from '@/hooks/useStornoLedger';
import { DynamicIcon } from '@/components/DynamicIcon';
import { sessionTransactions } from '@/lib/sessionTransactions';
import { SHOT_CATEGORY_ID } from '@/lib/shotCatalog';
import { loadJSON, saveJSON } from '@/lib/storage';
import { formatCurrency } from '@/lib/format';
import {
  ShoppingCart, Trash2, Search, Lock, Move, Euro, Recycle, ClipboardList, Image as ImageIcon, ImageOff, PanelRightClose, PanelRightOpen, ChevronLeft, ChevronRight,
} from 'lucide-react';

// Ansicht der Artikel-Kacheln, nur auf diesem Gerät gespeichert (keine Cloud,
// kein Backup, kein Einfluss auf Buchungen oder Zurücksetzen).
const TILE_IMAGES_KEY = 'pos_tile_images';
const CART_COLLAPSED_KEY = 'pos_cart_collapsed';

type HeaderAction = 'deposit' | 'withdrawal' | 'pfand' | 'correction' | 'close' | null;

interface Props {
  shotOptions: ShotOption[];
  categories: Category[];
  products: Product[];
  activeSession: CashSession | null;
  /** One checkout = 1 receipt, or 2 when a card payment pays out Pfand-Retoure in cash. Saved atomically. */
  onCheckout: (transactions: Transaction[]) => Promise<'queued-online' | 'queued-offline' | 'test'>;
  onOpenCash: (location: Location, openingBalance: number) => Promise<boolean>;
  onCorrectOpening: (newAmount: number, reason: string) => void;
  onCashEntry: (type: 'deposit' | 'withdrawal', amount: number, reason: string, isPfandRetoure?: boolean) => void;
  onCloseCash: (closingBalance: number, closingWithdrawalAmount: number, countDifferenceReason?: string) => Promise<{ ok: boolean; error?: string }>;
  transactions: Transaction[];
  stornos: StornoRecord[];
  stornoStatus: StornoCloudState;
  stornoError?: string;
  stornoServiceReady: boolean;
  testMode: boolean;
  onCommitStorno: (receipt: Transaction, reason: string, password: string, id: string) => Promise<StornoRecord>;
  onMoveProduct?: (sourceId: string, targetId: string) => void;
  headerAction?: HeaderAction;
  onHeaderActionConsumed?: () => void;
  loginRequest: number;
  selectedLocation?: Location;
  pfandSettings: PfandSettings;
  staffUsers: StaffUser[];
  currentStaff: StaffUser | null;
  online: boolean;
  onStaffAuthenticated: (staff: StaffUser) => void;
  onSetInitialCredentials: (id: string, password: string, question: StaffSecurityQuestion | null, answer: string) => Promise<StaffUser>;
  onConfigureStaffSecurity: (id: string, question: StaffSecurityQuestion | null, answer: string) => Promise<StaffUser>;
  onResetStaffPassword: (id: string, answer: string, password: string) => Promise<StaffUser>;
  lastStaffId: string | null;
  onDiscardEmptySession: () => Promise<void>;
  onHome?: () => void;
  openingBalanceSuggestions?: Record<Location, number | null>;
}

const PFAND_RETOURE_PRODUCT: Product = {
  id: '__pfand_retoure__',
  name: 'Pfand-Retoure',
  categoryId: '__pfand__',
  imageUrl: '',
  taxClass: 'zero',
  available: true,
  sortOrder: 999999,
  hasShot: false,
  prices: { Friedrichshafen: 0, Bregenz: 0 },
  pfand: { Friedrichshafen: 0, Bregenz: 0 },
};

export function POSScreen({
  categories, products, shotOptions, activeSession, onCheckout,
  onOpenCash, onCorrectOpening, onCashEntry, onCloseCash, transactions, stornos, stornoStatus, stornoError, stornoServiceReady, testMode, onCommitStorno, onMoveProduct,
  headerAction, onHeaderActionConsumed, loginRequest, selectedLocation, pfandSettings, staffUsers, currentStaff, online, onStaffAuthenticated, onSetInitialCredentials, onConfigureStaffSecurity, onResetStaffPassword, lastStaffId, onDiscardEmptySession, onHome, openingBalanceSuggestions,
}: Props) {
  const [activeCat, setActiveCat] = useState<string>(categories[0]?.id ?? '');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutCommitted, setCheckoutCommitted] = useState(false);
  // Short, non-blocking hint after an offline or test booking (no click needed).
  // Success shows ~2 s and then fades out; offline/test hints stay a bit longer.
  // pointer-events-none: the hint never blocks the next tap.
  const [checkoutNotice, setCheckoutNotice] = useState<{ id: number; tone: 'success' | 'warn'; title: string; detail?: string } | null>(null);
  const [checkoutNoticeFading, setCheckoutNoticeFading] = useState(false);
  useEffect(() => {
    if (!checkoutNotice) return;
    setCheckoutNoticeFading(false);
    const visibleMs = checkoutNotice.tone === 'success' ? (checkoutNotice.detail ? 2600 : 1600) : 3600;
    const fade = window.setTimeout(() => setCheckoutNoticeFading(true), visibleMs);
    const hide = window.setTimeout(() => setCheckoutNotice(null), visibleMs + 700);
    return () => { window.clearTimeout(fade); window.clearTimeout(hide); };
  }, [checkoutNotice]);
  // Der Dialog wird beim ersten Laden passend zum Sitzungsstatus geöffnet.
  // Danach darf nur ein tatsächlich bestätigter Tagesabschluss ihn erneut öffnen.
  // Kurzzeitige Leerstände während Import oder Cloud-Abgleich sind kein Abschluss.
  const [showOpenDialog, setShowOpenDialog] = useState(() => !activeSession || !currentStaff);
  // One shared header control handles both logout and return login. Logging
  // out must not spawn another login button or automatically reopen the modal.
  const previousLoginRequest = useRef(loginRequest);
  useEffect(() => {
    if (loginRequest === previousLoginRequest.current) return;
    previousLoginRequest.current = loginRequest;
    if (!activeSession || !currentStaff) setShowOpenDialog(true);
  }, [loginRequest, activeSession, currentStaff]);
  const openDialogAfterConfirmedClose = useRef(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [cashEntryType, setCashEntryType] = useState<'deposit' | 'withdrawal' | null>(null);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [shotProduct, setShotProduct] = useState<Product | null>(null);
  const [shotCartIndex, setShotCartIndex] = useState<number | null>(null);
  const [showPfandRetoure, setShowPfandRetoure] = useState(false);
  const [showBonliste, setShowBonliste] = useState(false);
  const [priceEntryProduct, setPriceEntryProduct] = useState<Product | null>(null);
  const [dragMode, setDragMode] = useState(false);
  const [sortMode, setSortMode] = useState<'manual' | 'asc' | 'desc'>('manual');
  const [showImages, setShowImages] = useState<boolean>(() => loadJSON<boolean>(TILE_IMAGES_KEY, true) !== false);
  // Warenkorb zuklappen: mehr Platz für Kacheln; Buchen, Pfand-Retoure und Bezahlen bleiben gleich.
  const [cartCollapsed, setCartCollapsed] = useState<boolean>(() => loadJSON<boolean>(CART_COLLAPSED_KEY, false) === true);
  const toggleCart = () => setCartCollapsed((value) => { const next = !value; saveJSON(CART_COLLAPSED_KEY, next); return next; });
  const toggleImages = () => setShowImages((value) => { const next = !value; saveJSON(TILE_IMAGES_KEY, next); return next; });
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const currentCashBalance = useMemo(() => {
    if (!activeSession) return 0;
    const cashSales = sessionTransactions(transactions, activeSession)
      .filter(tx => tx.paymentMethod === 'cash')
      .reduce((sum, tx) => sum + tx.total, 0);
    const entries = activeSession.entries.reduce((sum, entry) => sum + (entry.type === 'deposit' ? entry.amount : -entry.amount), 0);
    const stornoCash = stornos.filter((entry) => entry.cashSessionId === activeSession.id)
      .reduce((sum, entry) => sum + entry.cashEffect, 0);
    return Math.round((activeSession.openingBalance + cashSales + entries + stornoCash) * 100) / 100;
  }, [activeSession, transactions, stornos]);

  const requestDailyClose = useCallback(async () => {
    if (!activeSession) return;
    const unused = !activeSession.entries.length && !activeSession.corrections.length &&
      !transactions.some((tx) => tx.location === activeSession.location && tx.timestamp >= activeSession.openedAt);
    // Preserve the original rule: no official close for an empty, unfunded till.
    if (!unused || activeSession.openingBalance !== 0) {
      setShowCloseDialog(true);
      return;
    }
    alert(`Sie haben in dieser Kassensitzung keine Buchungen oder Kassenbewegungen getätigt. Ihr Anfangsbestand beträgt ${activeSession.openingBalance.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}. Es wird kein Tagesabschluss erstellt.`);
    try {
      await onDiscardEmptySession();
      setShowOpenDialog(true);
    } catch (error) {
      alert((error as { message?: string }).message ?? 'Die unbenutzte Kasse konnte nicht in der Cloud verworfen werden. Bitte Verbindung prüfen.');
    }
  }, [activeSession, transactions, onDiscardEmptySession]);

  useEffect(() => {
    // Der Öffnungsdialog wird ausschließlich nach einem wirklich bestätigten
    // Tagesabschluss erneut angezeigt. Änderungen der Sitzung durch Import
    // oder Synchronisierung dürfen einen bereits geöffneten Dialog weder
    // schließen noch erneut auslösen.
    if (!activeSession && openDialogAfterConfirmedClose.current) {
      openDialogAfterConfirmedClose.current = false;
      setShowOpenDialog(true);
    }
  }, [activeSession?.id]);

  useEffect(() => {
    if (!headerAction || !activeSession || !currentStaff) return;
    if (headerAction === 'deposit' || headerAction === 'withdrawal') {
      setCashEntryType(headerAction);
    } else if (headerAction === 'pfand') {
      setShowPfandRetoure(true);
    } else if (headerAction === 'correction') {
      if (currentCashBalance > 0) setShowCorrection(true);
    } else if (headerAction === 'close') {
      void requestDailyClose();
    }
    onHeaderActionConsumed?.();
  }, [headerAction, activeSession, currentStaff, onHeaderActionConsumed, currentCashBalance, requestDailyClose]);

  const currentLocation: Location = activeSession?.location ?? (selectedLocation ?? 'Friedrichshafen');

  const shownCategories = useMemo(
    () => [...categories].filter((c) => c.id !== SHOT_CATEGORY_ID).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  );
  const longestCategoryName = Math.max(6, ...shownCategories.map((c) => c.name.length));

  const visibleProducts = useMemo(() => {
    let list = products.filter((p) => p.available);
    if (search.trim()) {
      list = list.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));
    } else if (activeCat) {
      list = list.filter((p) => p.categoryId === activeCat);
    }
    // A–Z / Z–A keeps marked articles together: first Schnaps, then Likör, then the rest.
    const kindRank = (p: Product) => p.spiritType === 'schnaps' ? 0 : p.spiritType === 'likoer' ? 1 : 2;
    return [...list].sort(sortMode === 'asc'
      ? (a, b) => kindRank(a) - kindRank(b) || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })
      : sortMode === 'desc'
        ? (a, b) => kindRank(a) - kindRank(b) || b.name.localeCompare(a.name, 'de', { sensitivity: 'base' })
        : (a, b) => a.sortOrder - b.sortOrder);
  }, [products, activeCat, search, sortMode]);

  function addToCart(product: Product, shot: ShotOption | null = null, customPrice?: number) {
    const basePrice = customPrice !== undefined ? customPrice : product.prices[currentLocation];
    const unitPrice = basePrice + (shot?.price ?? 0);
    const unitPfand = product.pfand[currentLocation];

    setCart((prev) => {
      const existingIdx = prev.findIndex((c) =>
        c.product.id === product.id &&
        ((c.shot?.id ?? 'none') === (shot?.id ?? 'none')) &&
        c.unitPrice === unitPrice
      );
      if (existingIdx >= 0) {
        return prev.map((c, i) => i === existingIdx ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { product, quantity: 1, shot, unitPrice, unitPfand }];
    });
  }

  function addPfandRetoureToCart(amount: number, count: number) {
    const perUnit = count > 0 ? amount / count : amount;
    const item: CartItem = {
      product: { ...PFAND_RETOURE_PRODUCT, name: `Pfand-Retoure` },
      quantity: count,
      shot: null,
      unitPrice: -perUnit,
      unitPfand: 0,
      isPfandRetoure: true,
    };
    setCart((prev) => [...prev.filter((c) => !c.isPfandRetoure), item]);
  }

  function handleProductTap(product: Product) {
    if (product.hasIndividualPrice) {
      setPriceEntryProduct(product);
    } else {
      addToCart(product);
    }
  }

  function handleShotSelect(shot: ShotOption) {
    if (shotCartIndex !== null) {
      setCart((prev) => prev.flatMap((item, index) => {
        if (index !== shotCartIndex || item.isPfandRetoure) return [item];
        const oldShotPrice = item.shot?.price ?? 0;
        const nextShot = shot.id === 'none' ? null : shot;
        const updated = { ...item, quantity: 1, shot: nextShot, unitPrice: Math.round((item.unitPrice - oldShotPrice + (nextShot?.price ?? 0)) * 100) / 100 };
        return item.quantity > 1 ? [{ ...item, quantity: item.quantity - 1 }, updated] : [updated];
      }));
    }
    setShotProduct(null);
    setShotCartIndex(null);
  }

  function inc(index: number) {
    setCart((prev) => prev.map((c, i) => i === index ? { ...c, quantity: c.quantity + 1 } : c));
  }
  function dec(index: number) {
    setCart((prev) =>
      prev
        .map((c, i) => i === index ? { ...c, quantity: c.quantity - 1 } : c)
        .filter((c) => c.quantity > 0),
    );
  }
  function removeItem(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }
  function clearCart() {
    setCart([]);
  }

  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);
  const cartTotal = Math.round(cart.reduce((sum, c) => sum + (c.isPfandRetoure ? c.unitPrice : c.unitPrice + c.unitPfand) * c.quantity, 0) * 100) / 100;

    async function handleCheckoutComplete(transactions: Transaction[]): Promise<'queued-online' | 'queued-offline' | 'test'> {
    const result = await onCheckout(transactions);
    setCheckoutCommitted(true);
    return result;
  }

  function closeCheckout() {
    setShowCheckout(false);
    if (checkoutCommitted) {
      setCart([]);
      setCheckoutCommitted(false);
    }
  }

  /** Booking saved: close the dialog and empty the cart immediately. Done
   * explicitly here (not via closeCheckout) because `checkoutCommitted` from
   * this render may still be stale, which would leave a booked cart behind. */
  function finishCheckout(result: CheckoutSaveResult, hint?: string) {
    setShowCheckout(false);
    setCart([]);
    setCheckoutCommitted(false);
    const id = Date.now();
    if (result === 'queued-offline') {
      setCheckoutNotice({ id, tone: 'warn', title: 'Zahlung erfolgreich – offline gebucht', detail: hint ? `${hint} · wird übertragen, sobald wieder Internet da ist` : 'Wird übertragen, sobald wieder Internet da ist.' });
    } else if (result === 'test') {
      setCheckoutNotice({ id, tone: 'warn', title: 'Testbuchung – wird nicht gespeichert', detail: hint });
    } else {
      setCheckoutNotice({ id, tone: 'success', title: 'Zahlung erfolgreich', detail: hint });
    }
  }

  return (
    <div className="flex h-full flex-col gap-2 sm:gap-3">
      {/* Portrait tablet: roughly 65% product area / 35% persistent cart.
          Small phones stack because a 200px-wide cart would be unusable. */}
      <div className={`grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto sm:overflow-hidden lg:gap-3 ${cartCollapsed
        ? 'sm:grid-cols-[minmax(0,1fr)_9.5rem] lg:grid-cols-[minmax(0,1fr)_11rem]'
        : 'sm:grid-cols-[minmax(0,1.85fr)_minmax(220px,1fr)] lg:grid-cols-[minmax(0,2.15fr)_minmax(250px,1fr)]'}`}>
        {/* Left: products area */}
        <div className="flex min-h-0 min-w-0 flex-col sm:overflow-hidden">
          {/* Categories always visible as readable labeled touch targets. */}
          <div className="mb-1 flex shrink-0 items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Warengruppen</h2>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Tippen zum Wechseln</span>
          </div>
          {/* Alle Gruppen-Knöpfe gleich breit: so breit wie der längste Gruppenname mit Symbol. */}
          <div className="mb-2 grid max-h-[min(30dvh,15rem)] shrink-0 gap-2 overflow-y-auto overscroll-contain p-2 text-sm font-bold sm:text-base"
            style={{ gridTemplateColumns: `repeat(auto-fill, min(100%, calc(${longestCategoryName * 1.1}ch + 3.75rem)))` }}>
            {shownCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                aria-pressed={activeCat === cat.id && !search}
                onClick={() => { setActiveCat(cat.id); setSearch(''); }}
                className={`flex min-h-12 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold leading-tight shadow-sm transition active:scale-[0.98] sm:text-base ${activeCat === cat.id && !search
                  ? 'woodmo-cat-active bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-200 text-slate-500 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600'}`}
              >
                <DynamicIcon name={cat.icon} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate text-center">{cat.name}</span>
              </button>
            ))}
          </div>

          {/* Active category heading */}
          <div className="mb-2 flex items-center gap-2">
            {(() => {
              const cat = categories.find((c) => c.id === activeCat);
              if (search.trim()) {
                return <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Suchergebnisse für "{search}"</h2>;
              }
              if (cat) {
                return (
                  <h2 className="flex items-center gap-2 text-xl font-extrabold sm:text-2xl">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900">
                      <DynamicIcon name={cat.icon} className="h-4 w-4" />
                    </span>
                    <span className="woodmo-cat-pulse-text text-slate-900 dark:text-white">{cat.name}</span>
                  </h2>
                );
              }
              return null;
            })()}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" aria-pressed={!showImages} onClick={toggleImages}
                title={showImages ? 'Kompakte Kacheln ohne Bilder anzeigen' : 'Kacheln mit Bildern anzeigen'}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
                {showImages ? <ImageOff className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                {showImages ? 'Bilder aus' : 'Bilder an'}
              </button>
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                Sortierung:
                <select aria-label="Kassenartikel sortieren" value={sortMode}
                  onChange={event => { setSortMode(event.target.value as 'manual' | 'asc' | 'desc'); setDragMode(false); }}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  <option value="manual">Eigene Reihenfolge</option>
                  <option value="asc">Aufsteigend (A–Z)</option>
                  <option value="desc">Absteigend (Z–A)</option>
                </select>
              </label>
              {visibleProducts.length > 1 && !search.trim() && (
                <button type="button" aria-pressed={dragMode}
                  onClick={() => { if (!dragMode) setSortMode('manual'); setDragMode(v => !v); }}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    dragMode
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}>
                  <Move className="h-3.5 w-3.5" /> {dragMode ? '✓ Verschieben aktiv' : 'Kacheln verschieben'}
                </button>
              )}
            </div>
          </div>

          {/* Search bar: sales tools are grouped with the cart header. */}
          <div className="relative mb-2 shrink-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Artikel suchen..."
              className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-4 text-base text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 sm:py-2.5 sm:text-sm" />
          </div>

          {/* Product grid */}
          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {visibleProducts.length === 0 ? (
              <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
                <p className="text-sm">Keine Artikel gefunden</p>
              </div>
            ) : (
              <div className={showImages
                ? 'grid grid-cols-2 gap-2 min-[1040px]:grid-cols-3 min-[1420px]:grid-cols-4 min-[1740px]:grid-cols-5'
                : 'grid grid-cols-[repeat(auto-fill,minmax(8.75rem,1fr))] gap-1.5'}>
                {visibleProducts.map((product) => (
                  <ProductTile
                    key={product.id}
                    compact={!showImages}
                    product={product}
                    location={currentLocation}
                    onAdd={handleProductTap}
                    disabled={!activeSession || !currentStaff}
                    dragMode={dragMode}
                    onDragStart={(id) => setDragSource(id)}
                    onDragOver={(id) => setDragOver(id)}
                    onDrop={() => {
                      if (dragSource && dragOver && dragSource !== dragOver) {
                        onMoveProduct?.(dragSource, dragOver);
                      }
                      setDragSource(null);
                      setDragOver(null);
                    }}
                    isDraggedOver={dragOver === product.id}
                    isDragging={dragSource === product.id}
                  />
                ))}
              </div>
            )}
            {(!activeSession || !currentStaff) && visibleProducts.length > 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-8">
                <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-black/80 px-4 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur">
                  <Lock className="h-4 w-4" />
                  {!activeSession ? 'Bitte zuerst Kasse eröffnen, um Artikel zu verkaufen' : 'Bitte zuerst als Mitarbeiter anmelden'}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: cart */}
        <div className={`relative flex min-w-0 flex-col rounded-2xl border border-emerald-700/20 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:h-full sm:min-h-0 ${cartCollapsed ? '' : 'min-h-56'}`}>
          {/* Griff am linken Rand (Hoch- und Querformat): Pfeil zum Zu- bzw. Aufklappen. */}
          <button type="button" onClick={toggleCart}
            aria-label={cartCollapsed ? 'Warenkorb aufklappen (Pfeil)' : 'Warenkorb zuklappen (Pfeil)'}
            className="absolute left-0 top-1/2 z-10 hidden h-16 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-blue-500/70 bg-white text-blue-700 shadow-lg transition hover:bg-blue-50 active:scale-95 dark:bg-slate-900 dark:text-blue-200 sm:flex">
            {cartCollapsed ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </button>
          <div className="shrink-0 border-b border-gray-200 p-2.5 dark:border-gray-700 sm:p-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <ShoppingCart className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
                {!cartCollapsed && <h2 className="font-bold text-gray-900 dark:text-gray-100">Warenkorb</h2>}
                {cartCount > 0 && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">{cartCount}</span>}
              </div>
              <button type="button" onClick={toggleCart} aria-pressed={cartCollapsed}
                aria-label={cartCollapsed ? 'Warenkorb aufklappen' : 'Warenkorb zuklappen'}
                title={cartCollapsed ? 'Warenkorb aufklappen' : 'Warenkorb zuklappen – mehr Platz für Artikel'}
                className={`flex min-h-12 items-center justify-center gap-1.5 rounded-xl border-2 border-blue-500/70 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-100 active:scale-[0.98] dark:bg-blue-950/60 dark:text-blue-200 dark:hover:bg-blue-900/60 ${cartCollapsed ? 'basis-full' : 'shrink-0'}`}>
                {cartCollapsed ? <PanelRightOpen className="h-5 w-5" /> : <PanelRightClose className="h-5 w-5" />}
                {cartCollapsed ? 'Auf' : 'Zu'}
              </button>
              {cart.length > 0 && !cartCollapsed && (
                <button type="button" onClick={clearCart}
                  className="flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30">
                  <Trash2 className="h-3.5 w-3.5" /> Leeren
                </button>
              )}
            </div>
            <div className={`mt-2 grid gap-2 ${cartCollapsed ? 'grid-cols-2 sm:grid-cols-1' : 'grid-cols-2'}`}>
              <button type="button"
                onClick={() => setShowPfandRetoure(true)}
                disabled={!activeSession || !currentStaff}
                aria-label="Pfand-Retoure erfassen"
                title="Pfand-Retoure direkt während des Verkaufs erfassen"
                className="flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-teal-400/70 bg-teal-700 px-2 py-2 text-center text-xs font-bold leading-tight text-white shadow-sm transition hover:bg-teal-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm">
                <Recycle className="h-4 w-4 shrink-0" />
                <span>Pfand-Retoure</span>
              </button>
              <button type="button"
                onClick={() => setShowBonliste(true)}
                disabled={!activeSession || !currentStaff}
                aria-label="Bonliste öffnen und Bon stornieren"
                title="Letzte fünf Originalbons ansehen und Bar- oder Kartenbuchung begründet stornieren"
                className="flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-sky-400/70 bg-sky-700 px-2 py-2 text-center text-xs font-bold leading-tight text-white shadow-sm transition hover:bg-sky-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm">
                <ClipboardList className="h-4 w-4 shrink-0" />
                <span>Bonliste / Storno</span>
              </button>
            </div>
          </div>

          {cartCollapsed ? (
            cart.length === 0 ? (
              <button type="button" onClick={toggleCart} aria-label="Warenkorb aufklappen"
                className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-2 py-3 text-center hover:bg-gray-50 dark:hover:bg-gray-700/40">
                <PanelRightOpen className="h-5 w-5 text-slate-400" />
                <span className="text-[11px] text-slate-500 dark:text-slate-400">Tippen zum Aufklappen</span>
              </button>
            ) : (
              // Kurzliste der Positionen; Schuss lässt sich auch zugeklappt wählen.
              <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-1.5 py-1.5">
                {cart.map((item, index) => (
                  <li key={index} className="rounded-lg border border-slate-200 px-1.5 py-1 text-xs dark:border-slate-700">
                    <div className="flex min-w-0 items-baseline gap-1">
                      <span className="shrink-0 font-bold text-slate-400">{index + 1}.</span>
                      <span className={`min-w-0 truncate font-semibold ${item.isPfandRetoure ? 'text-teal-700 dark:text-teal-300' : 'text-slate-900 dark:text-slate-100'}`}>
                        {item.quantity > 1 ? `${item.quantity}× ` : ''}{item.isPfandRetoure ? 'Pfand-Retoure' : item.product.name}
                      </span>
                    </div>
                    {!item.isPfandRetoure && item.product.hasShot && (
                      <button type="button" onClick={() => { setShotCartIndex(index); setShotProduct(item.product); }}
                        aria-label={`Schuss für Position ${index + 1} wählen`}
                        className={`mt-1 min-h-8 w-full truncate rounded-md px-1.5 py-1 text-[11px] font-bold transition active:scale-[0.97] bg-blue-600 text-white hover:bg-blue-700`}>
                        {item.shot && item.shot.id !== 'none' ? `+ ${item.shot.name}` : '+ Schuss'}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )
          ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1 sm:px-3">
            {cart.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">Noch keine Artikel im Warenkorb</p>
            )}
            {cart.map((item, index) => (
              <CartItemRow key={index} item={item} location={currentLocation} onInc={() => inc(index)} onDec={() => dec(index)} onRemove={() => removeItem(index)} onEditShot={item.product.isPfandArticle || item.product.hasShot ? () => { setShotCartIndex(index); setShotProduct(item.product); } : undefined} />
            ))}
          </div>
          )}

          <div className="shrink-0 border-t border-gray-200 p-2 dark:border-gray-700 sm:p-3">
            {cartCollapsed && (
              <div className="rounded-lg bg-slate-100 px-2 py-1.5 text-center dark:bg-slate-900/60">
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{cartCount === 0 ? 'Keine Artikel' : `${cartCount} Artikel`}</div>
                <div className={`text-lg font-extrabold leading-tight ${cartTotal < 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>{formatCurrency(cartTotal)}</div>
              </div>
            )}
            {cart.length > 0 && !cartCollapsed && <div className="max-h-[min(25dvh,11rem)] overflow-y-auto"><CartSummary items={cart} location={currentLocation} /></div>}
            {cart.length > 0 && (
              <button
                onClick={() => activeSession && currentStaff && setShowCheckout(true)}
                disabled={!activeSession || !currentStaff}
                className={`mt-2 min-h-11 w-full rounded-xl px-3 py-2.5 text-sm font-bold text-white shadow-lg transition active:scale-95 ${activeSession && currentStaff ? 'bg-green-600 hover:bg-green-700' : 'cursor-not-allowed bg-gray-400 dark:bg-gray-600'}`}
              >
                {activeSession && currentStaff ? 'Bezahlen' : 'Bezahlen (Anmeldung erforderlich)'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Dialogs */}
      {showOpenDialog && (
        <CashOpeningDialog existingSession={activeSession} onSave={async (loc, bal) => { if (!activeSession) { const ok = await onOpenCash(loc, bal); if (!ok) return false; } setShowOpenDialog(false); return true; }} onClose={() => { setShowOpenDialog(false); onHome?.(); }} defaultLocation={currentLocation} staffUsers={staffUsers} currentStaff={currentStaff} online={online} lastStaffId={lastStaffId} onStaffAuthenticated={onStaffAuthenticated} onSetInitialCredentials={onSetInitialCredentials} onConfigureSecurity={onConfigureStaffSecurity} onResetStaffPassword={onResetStaffPassword} openingBalanceSuggestions={openingBalanceSuggestions} />
      )}
      {showCorrection && activeSession && (
        <CashCorrectionDialog session={activeSession} currentCashBalance={currentCashBalance} onSave={(amt, reason) => { onCorrectOpening(amt, reason); setShowCorrection(false); }} onClose={() => setShowCorrection(false)} />
      )}
      {cashEntryType && activeSession && (
        <CashEntryDialog session={activeSession} currentCashBalance={currentCashBalance} type={cashEntryType} onSave={(amt, reason) => { onCashEntry(cashEntryType, amt, reason); setCashEntryType(null); }} onClose={() => setCashEntryType(null)} />
      )}
      {showBonliste && activeSession && currentStaff && (
        <BonlisteDialog
          session={activeSession}
          transactions={transactions}
          stornos={stornos}
          staff={currentStaff}
          currentCashBalance={currentCashBalance}
          online={online}
          testMode={testMode}
          cloudReady={stornoStatus === 'ready' && stornoServiceReady}
          cloudError={stornoError}
          onClose={() => setShowBonliste(false)}
          onCommit={onCommitStorno}
        />
      )}
      {showPfandRetoure && activeSession && currentStaff && (
        <PfandRetoureDialog
          session={activeSession}
          pfandSettings={pfandSettings}
          onSave={(amount, count) => {
            addPfandRetoureToCart(amount, count);
            setShowPfandRetoure(false);
          }}
          onClose={() => setShowPfandRetoure(false)}
        />
      )}
      {showCloseDialog && activeSession && (
        <DailyCloseDialog session={activeSession} transactions={transactions} stornos={stornos} currentStaff={currentStaff} onClose={async (bal, closingWithdrawalAmount, reason) => {
          const result = await onCloseCash(bal, closingWithdrawalAmount, reason);
          if (result.ok) {
            openDialogAfterConfirmedClose.current = true;
            setShowCloseDialog(false);
          }
          return result;
        }} onCancel={() => setShowCloseDialog(false)} />
      )}
      {shotProduct && (
        <ShotSelectionDialog product={shotProduct} options={shotOptions} location={currentLocation} onSelect={handleShotSelect} onCancel={() => { setShotProduct(null); setShotCartIndex(null); }} />
      )}
      {priceEntryProduct && (
        <IndividualPriceDialog
          product={priceEntryProduct}
          onConfirm={(price) => {
            addToCart(priceEntryProduct, null, price);
            setPriceEntryProduct(null);
          }}
          onCancel={() => setPriceEntryProduct(null)}
        />
      )}
      {showCheckout && cart.length > 0 && (
        <CheckoutModal items={cart} location={currentLocation} onComplete={handleCheckoutComplete} onPaid={finishCheckout} onCancel={closeCheckout} />
      )}
      {checkoutNotice && (
        <div key={checkoutNotice.id} role="status" aria-live="polite"
          className={`pointer-events-none fixed bottom-6 left-1/2 z-40 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 rounded-2xl border px-4 py-3 text-center shadow-xl transition-opacity duration-700 ${checkoutNoticeFading ? 'opacity-0' : 'opacity-100'} ${
            checkoutNotice.tone === 'success'
              ? 'border-green-400/70 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100'
              : 'border-amber-400/70 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100'
          }`}>
          <p className="text-base font-bold">{checkoutNotice.title}</p>
          {checkoutNotice.detail && <p className="mt-0.5 text-lg font-extrabold">{checkoutNotice.detail}</p>}
        </div>
      )}
    </div>
  );
}

function IndividualPriceDialog({ product, onConfirm, onCancel }: {
  product: Product;
  onConfirm: (price: number) => void;
  onCancel: () => void;
}) {
  const [priceInput, setPriceInput] = useState('');

  function confirm() {
    const val = parseFloat(priceInput.replace(',', '.')) || 0;
    if (val <= 0) return;
    onConfirm(val);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-2">
          <Euro className="h-5 w-5 text-amber-500" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Individueller Preis</h3>
        </div>
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">{product.name}</p>
        <input
          autoFocus
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && confirm()}
          placeholder="Preis eingeben"
          inputMode="decimal"
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-lg text-gray-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
        <div className="mt-4 flex gap-2">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
            Abbrechen
          </button>
          <button onClick={confirm} disabled={!priceInput.trim()} className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600 active:scale-95 disabled:opacity-50">
            Bestätigen
          </button>
        </div>
      </div>
    </div>
  );
}
