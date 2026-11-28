import { CatalogTransferDialog } from './CatalogTransferDialog';
import { withCurrentCategories } from '@/lib/reportCategory';
import type { CatalogImportSession } from '@/lib/catalogEngine';
import type { LocalCatalog } from '@/lib/catalogSync';
import { useEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import type { Category, Product, TaxClass, Location, Transaction, CashSession, PfandSettings, StaffRole, StaffSecurityQuestion, StaffUser, ShotOption } from '@/types';
import { formatCurrency, formatDateISO, formatTime } from '@/lib/format';
import { DiagnosticsDialog } from './DiagnosticsDialog';
import { mergeTaxByRate, sortedRateKeys, transactionNet, LOCATION_TAX_RATES } from '@/lib/tax';
import { buildDailyReport, closedSessionReport } from '@/lib/dailyReport';
import { computeJournalStats, type JournalReportData } from '@/lib/journalPdf';
import { JournalPreviewDialog } from '@/components/Journal/JournalPreviewDialog';
import { buildDayOverview, type DaySessionPart } from '@/lib/dayOverview';
import { formatDailyCloseReceiptNumber } from '@/lib/dailyCloseReceipt';
import { locationStyle } from '@/lib/locationColors';
import { DateNav, shiftIsoDay, useDaySwipe } from '@/components/DateNav';
import { openingCorrectionView, signedAmountLabel } from '@/lib/openingCorrection';
import { exportJournalPdf, openJournalPrintDialog } from '@/lib/journalPdfFile';
import { DynamicIcon, availableIconNames } from '@/components/DynamicIcon';
import { importFileToDataURL, isSupported, ACCEPTED_TYPES } from '@/lib/imageImport';
import { uploadArticleImage } from '@/lib/imageUpload';
import { publicAssetUrl } from '@/lib/publicAssetUrl';
import { Plus, Edit3, Trash2, X, Save, Tag, Package, Upload, Loader2, RotateCcw, Wine, Recycle, MonitorDot, Settings, FileDown, Printer, MapPin, TrendingUp, Euro, Receipt as ReceiptIcon, Clock, Check, Info, ChevronDown, FileText, FlaskConical, CheckCircle2, Download, FileUp, ShieldCheck, AlertTriangle, Wrench, Smartphone } from 'lucide-react';
import { mobileLink } from '@/lib/mobileApi';
import { QrCode } from '@/components/QrCode';
import { SHOT_CATEGORY_ID } from '@/lib/shotCatalog';
import type { StornoRecord } from '@/lib/stornoRules';
import type { ResetSafetyResult } from '@/lib/resetSafetyChecklist';
import { parsePfandAmount } from '@/lib/pfandValidation';
import { parsePriceInput } from '@/lib/priceInput';
import { ShotManager } from '@/components/Admin/ShotManager';
import { StaffManager } from '@/components/Admin/StaffManager';
import { ReleaseSummary } from '@/components/ReleaseSummary';
import { APP_RELEASE_NOTES, APP_VERSION } from '@/lib/appVersion';
import { loadJSON, saveJSON } from '@/lib/storage';

interface Props {
  onPrepareCatalogImport: () => Promise<CatalogImportSession>;
  onCommitCatalogImport: (session: CatalogImportSession, next: LocalCatalog) => Promise<void>;
  shotOptions: ShotOption[];
  onUpdateShotOptions: (shots: ShotOption[]) => void;
  categories: Category[];
  products: Product[];
  transactions: Transaction[];
  stornos: StornoRecord[];
  cashSessions: CashSession[];
  activeSession: CashSession | null;
  selectedLocation: Location;
  onSwitchLocation: (loc: Location) => void;
  onOpenCash?: () => void;
  onAddCategory: (data: Omit<Category, 'id'>) => void;
  onUpdateCategory: (id: string, data: Partial<Omit<Category, 'id'>>) => void;
  onDeleteCategory: (id: string) => void;
  onReorderCategory?: (id: string, direction: 'up' | 'down') => void;
  onMoveCategoryTo?: (sourceId: string, targetId: string) => void;
  onAddProduct: (data: Omit<Product, 'id'>) => void;
  onUpdateProduct: (id: string, data: Partial<Omit<Product, 'id'>>) => void;
  onDeleteProduct: (id: string) => void;
  onReorderProduct?: (id: string, direction: 'up' | 'down') => void;
  onMoveProductTo?: (sourceId: string, targetId: string) => void;
  onResetAllData?: (adminPassword: string) => Promise<void>;
  onCheckResetSafety?: (progress: (result: ResetSafetyResult) => void) => Promise<ResetSafetyResult>;
  onDeviceSetup?: () => void;
  testMode?: boolean;
  onToggleMode?: () => void;
  onExportBackup?: () => void | Promise<void | { mode: 'folder' | 'downloads'; savedAs: string }>;
  onImportBackup?: (file: File) => void;
  /** Führt zum Tagesabschluss der offenen Kasse am Standort (Weg B beim Zurücksetzen). */
  onCloseOpenCash?: (location: string) => void;
  /** Meldet einen Mitarbeiter in einer offenen Kassensitzung ab (nur Login-Status, keine Buchung). */
  onLogoutStaff?: (sessionId: string, staffId: string, staffName: string) => void;
  resetQuarantineCount?: number;
  onExportResetQuarantine?: () => Promise<void>;
  onClearResetQuarantine?: () => Promise<void>;
  pfandSettings: PfandSettings;
  onUpdatePfandSettings: (settings: PfandSettings) => Promise<'cloud' | 'local'>;
  getProductPfand: (product: Product, loc: Location) => number;
  staffUsers?: StaffUser[];
  staffOnline?: boolean;
  onCreateStaff?: (name: string, role: StaffRole, initialPassword?: string, securityQuestion?: StaffSecurityQuestion | null, securityAnswer?: string) => Promise<unknown>;
  onUpdateStaff?: (user: StaffUser) => Promise<unknown>;
  onSetStaffPassword?: (id: string, password: string) => Promise<unknown>;
  onDeleteStaff?: (id: string) => Promise<unknown>;
  onChangeManagerPassword?: (currentPassword: string, nextPassword: string) => Promise<unknown>;
  administratorTools?: ReactNode;
  currentStaff?: StaffUser | null;
  menuOpen: boolean;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onOpenJournal: () => void;
  onAdminSectionChange: (section: string) => void;
  onShotDraftDirtyChange?: (dirty: boolean) => void;
}

type AdminDataProps = Omit<Props, 'menuOpen' | 'onOpenMenu' | 'onCloseMenu' | 'onOpenJournal' | 'onAdminSectionChange' | 'onShotDraftDirtyChange'>;

const COLOR_OPTIONS = [
  { label: 'Blau', value: 'from-cyan-500 to-blue-600' },
  { label: 'Orange', value: 'from-amber-500 to-orange-600' },
  { label: 'Grün', value: 'from-emerald-500 to-green-600' },
  { label: 'Rot', value: 'from-rose-500 to-red-600' },
  { label: 'Lila', value: 'from-violet-500 to-purple-600' },
  { label: 'Pink', value: 'from-pink-500 to-rose-600' },
  { label: 'Teal', value: 'from-teal-500 to-cyan-600' },
  { label: 'Indigo', value: 'from-indigo-500 to-blue-700' },
  { label: 'Gelb', value: 'from-yellow-300 to-amber-500' },
  { label: 'Limette', value: 'from-lime-400 to-green-600' },
  { label: 'Türkis', value: 'from-cyan-400 to-teal-600' },
  { label: 'Hellblau', value: 'from-sky-300 to-blue-500' },
  { label: 'Dunkelblau', value: 'from-blue-700 to-indigo-900' },
  { label: 'Braun', value: 'from-amber-700 to-stone-800' },
  { label: 'Grau', value: 'from-slate-400 to-slate-700' },
  { label: 'Schwarz', value: 'from-gray-700 to-gray-950' },
];

const LOCATIONS: Location[] = ['Friedrichshafen', 'Bregenz'];
const READ_RELEASE_KEY = 'woodmo_admin_read_release_v1';
const RELEASE_ID = JSON.stringify([APP_VERSION, APP_RELEASE_NOTES]);

const ADMIN_SECTION_TITLES = {
  sessions: 'Kassen-Übersicht',
  categories: 'Warengruppen',
  products: 'Artikel',
  shots: 'SCHUSS',
  staff: 'Benutzer',
} as const;


export function AdminScreen({ onResetAllData, onDeviceSetup, testMode = false, onToggleMode, onExportBackup, onImportBackup, onCloseOpenCash, onLogoutStaff, onCheckResetSafety, resetQuarantineCount = 0, onExportResetQuarantine, onClearResetQuarantine, menuOpen, onOpenMenu, onCloseMenu, onOpenJournal, onAdminSectionChange, onShotDraftDirtyChange, ...props }: Props) {
  const [tab, setTab] = useState<keyof typeof ADMIN_SECTION_TITLES>('sessions');

  const [shotDraftDirty, setShotDraftDirty] = useState(false);
  const canLeaveShots = () => {
    if (tab !== 'shots' || !shotDraftDirty) return true;
    if (!window.confirm('Ungespeicherte SCHUSS-Änderungen verwerfen und Bereich wechseln?')) return false;
    setShotDraftDirty(false);
    onShotDraftDirtyChange?.(false);
    return true;
  };
  // Beim Betreten der Verwaltung ist noch kein Menüpunkt gewählt → nichts blau markieren.
  const [menuItemChosen, setMenuItemChosen] = useState(false);
  const changeTab = (next: typeof tab) => {
    if (tab !== next && !canLeaveShots()) return;
    setMenuItemChosen(true);
    setTab(next);
    onCloseMenu();
  };
  const openAdminAction = (action: () => void) => {
    // A modal action must never discard an unsaved SCHUSS draft that remains
    // mounted underneath. Ask the operator to finish that draft first.
    if (tab === 'shots' && shotDraftDirty) {
      window.alert('Bitte zuerst SCHUSS-Änderungen speichern oder verwerfen.');
      return;
    }
    onCloseMenu();
    action();
  };
  // 24.11.: Schwarz-Weiß wie Startbildschirm; schlichte Knöpfe mit dezentem 3D-Effekt.
  const adminMenuItem = 'gx-btn flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
  const activeAdminMenuItem = '';
  const adminMenuHeading = 'gx-heading mb-2 text-sm font-bold uppercase tracking-[.12em]';
  const [showCatalogTransfer, setShowCatalogTransfer] = useState(false);
  const [showReleaseInfo, setShowReleaseInfo] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showMobileLink, setShowMobileLink] = useState(false);
  const [readRelease, setReadRelease] = useState(() => loadJSON<string | null>(READ_RELEASE_KEY, null));
  const unreadRelease = APP_RELEASE_NOTES.length > 0 && readRelease !== RELEASE_ID;
  function closeReleaseInfo() {
    saveJSON(READ_RELEASE_KEY, RELEASE_ID);
    setReadRelease(RELEASE_ID);
    setShowReleaseInfo(false);
    onOpenMenu();
  }
  // Kassen-Übersicht/Tagesinfo: Bons zusammengelegter Warengruppen der heutigen Gruppe zuordnen (nur Anzeige).
  const overviewTransactions = useMemo(
    () => withCurrentCategories(props.transactions, props.categories, props.products),
    [props.transactions, props.categories, props.products],
  );
  const [showReset, setShowReset] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // A selected menu entry, including a modal, is always named in the shared
  // header. Closing that modal restores the previously active admin section.
  useEffect(() => {
    const activeTitle = showReleaseInfo ? 'Info'
      : showDiagnostics ? 'Diagnose'
      : showCatalogTransfer ? 'Excel-Import / Export'
      : showImport ? 'Backup importieren'
      : showReset ? 'Buchungen zurücksetzen'
      : ADMIN_SECTION_TITLES[tab];
    onAdminSectionChange(activeTitle);
  }, [tab, showReleaseInfo, showDiagnostics, showCatalogTransfer, showImport, showReset, onAdminSectionChange]);

  return (
    <div className="flex h-full flex-col">
      {menuOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-black/65 px-3 pb-4 pt-[4.5rem] backdrop-blur-[2px]"
          onClick={onCloseMenu}
          onKeyDown={(event) => { if (event.key === 'Escape') onCloseMenu(); }}
        >
          <nav
            role="dialog"
            aria-modal="true"
            aria-label="Verwaltungsmenü"
            onClick={(event) => event.stopPropagation()}
            className="max-h-full w-full max-w-xl overflow-y-auto gx-panel rounded-3xl p-4"
          >
            <div className="mb-4 flex items-center justify-between gap-3 gx-rule border-b pb-3">
              <div>
                <h2 className="text-2xl font-bold">Verwaltungsmenü</h2>
              </div>
              <button type="button" aria-label="Verwaltungsmenü schließen" onClick={onCloseMenu}
                className="gx-btn flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                <X className="h-5 w-5" />
              </button>
            </div>

            <section aria-labelledby="woodmo-admin-navigation" className="mb-5">
              <h3 id="woodmo-admin-navigation" className={adminMenuHeading}>Verwaltungsbereiche</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button type="button" aria-current={menuItemChosen && tab === 'sessions' ? 'page' : undefined} className={`${adminMenuItem} ${menuItemChosen && tab === 'sessions' ? activeAdminMenuItem : ''}`} onClick={() => changeTab('sessions')}>
                  <MonitorDot className="h-5 w-5 shrink-0" /> Kassen-Übersicht
                </button>
                <button type="button" aria-current={menuItemChosen && tab === 'categories' ? 'page' : undefined} className={`${adminMenuItem} ${menuItemChosen && tab === 'categories' ? activeAdminMenuItem : ''}`} onClick={() => changeTab('categories')}>
                  <Tag className="h-5 w-5 shrink-0" /> Warengruppen
                </button>
                <button type="button" aria-current={menuItemChosen && tab === 'products' ? 'page' : undefined} className={`${adminMenuItem} ${menuItemChosen && tab === 'products' ? activeAdminMenuItem : ''}`} onClick={() => changeTab('products')}>
                  <Package className="h-5 w-5 shrink-0" /> Artikel
                </button>
                <button type="button" aria-current={menuItemChosen && tab === 'shots' ? 'page' : undefined} className={`${adminMenuItem} ${menuItemChosen && tab === 'shots' ? activeAdminMenuItem : ''}`} onClick={() => changeTab('shots')}>
                  <Wine className="h-5 w-5 shrink-0" /> SCHUSS
                </button>
                <button type="button" aria-current={menuItemChosen && tab === 'staff' ? 'page' : undefined} className={`${adminMenuItem} ${menuItemChosen && tab === 'staff' ? activeAdminMenuItem : ''}`} onClick={() => changeTab('staff')}>
                  <ShieldCheck className="h-5 w-5 shrink-0" /> Benutzer
                </button>
                <button type="button" className={adminMenuItem} onClick={() => openAdminAction(onOpenJournal)}>
                  <ReceiptIcon className="h-5 w-5 shrink-0" /> Journal
                </button>
              </div>
            </section>

            <section aria-labelledby="woodmo-app-settings" className="mb-5">
              <h3 id="woodmo-app-settings" className={adminMenuHeading}>App-Einstellungen</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button type="button" className={adminMenuItem} aria-haspopup="dialog"
                  onClick={() => openAdminAction(() => setShowReleaseInfo(true))}>
                  <Info className="h-5 w-5 shrink-0" aria-hidden="true" /> Info
                  {unreadRelease && <>
                    <span aria-hidden="true" className="ml-auto grid size-6 place-items-center rounded-full bg-red-600 font-bold text-white">!</span>
                    <span className="sr-only">Neue Versionshinweise</span>
                  </>}
                </button>
                <button type="button" className={adminMenuItem} aria-haspopup="dialog"
                  onClick={() => openAdminAction(() => setShowDiagnostics(true))}>
                  <Wrench className="h-5 w-5 shrink-0" aria-hidden="true" /> Diagnose
                </button>
                {/* 27.11.: Link für die mobile Kassenübersicht (Handy, nur lesen, eigene Administrator-Anmeldung). */}
                <button type="button" className={adminMenuItem}
                  onClick={() => openAdminAction(() => setShowMobileLink(true))}>
                  <Smartphone className="h-5 w-5 shrink-0" aria-hidden="true" /> Mobile Kassenübersicht
                </button>
                {onDeviceSetup && (
                  <button type="button" className={adminMenuItem} onClick={() => openAdminAction(onDeviceSetup)}>
                    <Settings className="h-5 w-5 shrink-0" /> Setup / PDF-Ordner
                  </button>
                )}
                {onToggleMode && (
                  <button type="button" className={`${adminMenuItem} ${testMode ? 'gx-btn-ok' : 'gx-btn-test'}`} onClick={() => openAdminAction(onToggleMode)}>
                    {testMode ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <FlaskConical className="h-5 w-5 shrink-0" />}
                    {testMode ? 'Auf aktiven Modus wechseln' : 'Auf Testmodus wechseln'}
                  </button>
                )}
              </div>
            </section>

            <section aria-labelledby="woodmo-import-export">
              <h3 id="woodmo-import-export" className={adminMenuHeading}>Import / Export</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button type="button" className={adminMenuItem} onClick={() => openAdminAction(() => setShowCatalogTransfer(true))}>
                  <FileDown className="h-5 w-5 shrink-0" /> Excel-Import / Export
                </button>
                {onImportBackup && (
                  <button type="button" className={adminMenuItem} onClick={() => openAdminAction(() => setShowImport(true))}>
                    <FileUp className="h-5 w-5 shrink-0" /> Backup importieren
                  </button>
                )}
                {onExportBackup && (
                  <button type="button" className={adminMenuItem} onClick={() => openAdminAction(() => { void (async () => { const saved = await onExportBackup(); if (saved && saved.mode === 'folder') alert(`Backup gespeichert: ${saved.savedAs}`); })(); })}>
                    <Download className="h-5 w-5 shrink-0" /> Backup exportieren
                  </button>
                )}
                {/* 24.11.: Sicherheitsarchiv sichern und löschen in einer Zeile. */}
                {resetQuarantineCount > 0 && (onExportResetQuarantine || onClearResetQuarantine) && (
                  <div className="col-span-full grid grid-cols-2 gap-2">
                {onExportResetQuarantine && resetQuarantineCount > 0 && (
                  <button type="button" className={`${adminMenuItem} gx-btn-warn`}
                    onClick={() => openAdminAction(() => { void onExportResetQuarantine(); })}>
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    Sicherheitsarchiv sichern ({resetQuarantineCount})
                  </button>
                  )}
                  {onClearResetQuarantine && resetQuarantineCount > 0 && (
                  <button type="button" className={`${adminMenuItem} gx-btn-warn`}
                    onClick={() => openAdminAction(() => { void onClearResetQuarantine(); })}>
                    <Trash2 className="h-5 w-5 shrink-0" />
                    Sicherheitsarchiv löschen
                  </button>
                  )}
                  </div>
                )}
                {onResetAllData && (
                  <button type="button" className={`${adminMenuItem} gx-btn-danger`}
                    onClick={() => openAdminAction(() => setShowReset(true))}>
                    <RotateCcw className="h-5 w-5 shrink-0" /> Buchungen zurücksetzen
                  </button>
                )}
              </div>
            </section>
          </nav>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {tab === 'sessions' ? <LiveSessionOverview transactions={overviewTransactions} cashSessions={props.cashSessions} stornos={props.stornos} categories={props.categories} activeSession={props.activeSession} selectedLocation={props.selectedLocation} onSwitchLocation={props.onSwitchLocation} onOpenCash={props.onOpenCash} exportedByName={props.currentStaff?.name} />
          : tab === 'categories' ? <CategoryManager {...props} />
            : tab === 'products' ? <ProductManager {...props} testMode={testMode} />
              : tab === 'shots' ? <ShotManager shots={props.shotOptions} onChange={props.onUpdateShotOptions} onDirtyChange={(dirty) => { setShotDraftDirty(dirty); onShotDraftDirtyChange?.(dirty); }} />
              : props.onCreateStaff && props.onUpdateStaff && props.onSetStaffPassword && props.onDeleteStaff ? <div className="space-y-4"><StaffManager users={props.staffUsers ?? []} online={props.staffOnline ?? navigator.onLine} onCreate={props.onCreateStaff} onUpdate={props.onUpdateStaff} onSetPassword={props.onSetStaffPassword} onDelete={props.onDeleteStaff} />{props.administratorTools}</div> : null}
      </div>
      {showMobileLink && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4" onClick={() => { setShowMobileLink(false); onOpenMenu(); }}>
          <div className="gx-dialog w-full max-w-sm rounded-3xl p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-xl font-bold">Mobile Kassenübersicht</h2>
            <p className="mb-3 text-sm">Mit der Handy-Kamera scannen, dann mit Administrator-Name und persönlichem Passwort anmelden. Nur lesen.</p>
            <QrCode text={mobileLink('admin')} size={220} />
            <a href={mobileLink('admin')} target="_blank" rel="noopener noreferrer" className="mt-3 block break-all font-mono text-xs font-bold underline">{mobileLink('admin')}</a>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(mobileLink('admin')).catch(() => undefined); }} className="min-h-11 rounded-xl text-sm font-bold">Link kopieren</button>
              <button type="button" onClick={() => { setShowMobileLink(false); onOpenMenu(); }} className="bg-slate-900 min-h-11 rounded-xl text-sm font-bold">Schließen</button>
            </div>
          </div>
        </div>
      )}
      {showDiagnostics && <DiagnosticsDialog location={props.selectedLocation ?? null} onClose={() => setShowDiagnostics(false)} />}
      {showReleaseInfo && (
        <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/65 p-4 backdrop-blur-[2px]"
          onClick={closeReleaseInfo} onKeyDown={event => { if (event.key === 'Escape') closeReleaseInfo(); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="woodmo-version-info"
            className="w-full max-w-md space-y-4 rounded-2xl border border-slate-300 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
            onClick={event => event.stopPropagation()}>
            <h2 id="woodmo-version-info" className="text-xl font-bold">Info</h2>
            <ReleaseSummary />
            <button type="button" autoFocus onClick={closeReleaseInfo}
              className="ml-auto block min-h-11 rounded-xl bg-slate-900 px-4 font-semibold text-white dark:bg-white dark:text-slate-900">
              Schließen
            </button>
          </section>
        </div>
      )}
      {showCatalogTransfer && <CatalogTransferDialog
        catalog={{categories: props.categories, products: props.products, pfandSettings: props.pfandSettings, shotOptions: props.shotOptions}}
        testMode={testMode} onPrepare={props.onPrepareCatalogImport} onCommit={props.onCommitCatalogImport}
        onClose={() => setShowCatalogTransfer(false)} />}
      {showReset && (
        <ResetConfirmDialog
          onExport={onExportBackup}
          onCheck={onCheckResetSafety}
          transactionCount={props.transactions.length}
          stornoCount={props.stornos.length}
          sessionCount={props.cashSessions.length}
          openSessionCount={props.cashSessions.filter((session) => !session.closed && !session.discarded && !session.dailyCloseFinalizedAt).length}
          testMode={testMode}
          openLocations={[...new Set(props.cashSessions.filter((session) => !session.closed && !session.discarded && !session.dailyCloseFinalizedAt).map((session) => session.location))]}
          onCloseOpenCash={onCloseOpenCash ? (location) => { setShowReset(false); onCloseOpenCash(location); } : undefined}
          loggedInStaff={props.cashSessions.filter((session) => !session.closed && !session.discarded && !session.dailyCloseFinalizedAt)
            .flatMap((session) => (session.staffLoginIntervals ?? []).filter((interval) => interval.logoutAt === undefined)
              .map((interval) => ({ sessionId: session.id, location: session.location, staffId: interval.staffId, staffName: interval.staffName })))}
          onLogoutStaff={onLogoutStaff}
          onCancel={() => setShowReset(false)}
          onConfirm={async (adminPassword) => { await onResetAllData?.(adminPassword); setShowReset(false); }}
        />
      )}
      {showImport && onImportBackup && (
        <ImportDialog
          onImport={(file) => { onImportBackup(file); setShowImport(false); }}
          onCancel={() => setShowImport(false)}
        />
      )}
    </div>
  );
}

// ---- Confirm Dialog ----

function ConfirmDialog({ title, message, onConfirm, onClose }: {
  title: string;
  message: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-900/30">
            <Trash2 className="h-7 w-7 text-red-600 dark:text-red-400" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
            Abbrechen
          </button>
          <button onClick={onConfirm}
            className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-red-700 active:scale-95">
            <Trash2 className="mr-1.5 inline h-4 w-4" /> Löschen
          </button>
        </div>
      </div>
    </div>
  );
}



// ---- Category Manager ----

function CategoryManager({ categories, products, onAddCategory, onUpdateCategory, onDeleteCategory, onMoveCategoryTo }: AdminDataProps) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteCat, setDeleteCat] = useState<Category | null>(null);
  const [sortMode, setSortMode] = useState<'manual' | 'asc' | 'desc'>('manual');
  const [dragEnabled, setDragEnabled] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const sorted = [...categories].filter((category) => category.id !== SHOT_CATEGORY_ID).sort(
    sortMode === 'asc' ? (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })
    : sortMode === 'desc' ? (a, b) => b.name.localeCompare(a.name, 'de', { sensitivity: 'base' })
    : (a, b) => a.sortOrder - b.sortOrder
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Warengruppen verwalten</h3>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-blue-700 active:scale-95">
          <Plus className="h-4 w-4" /> Neue Gruppe
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-start gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          Sortierung:
          <select aria-label="Warengruppen sortieren" value={sortMode} onChange={e => { setSortMode(e.target.value as 'manual' | 'asc' | 'desc'); setDragEnabled(false); }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
            <option value="manual">Eigene Reihenfolge</option>
            <option value="asc">Aufsteigend (A–Z)</option>
            <option value="desc">Absteigend (Z–A)</option>
          </select>
        </label>
        <button type="button" aria-pressed={dragEnabled} onClick={() => { if (!dragEnabled) setSortMode('manual'); setDragEnabled(!dragEnabled); }}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${dragEnabled ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}>
          {dragEnabled ? '✓ Verschieben aktiv' : 'Kacheln verschieben'}
        </button>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((cat) => (
          <div key={cat.id}
            draggable={dragEnabled && Boolean(onMoveCategoryTo)}
            onDragStart={event => { if (!dragEnabled) return; setDraggedId(cat.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', cat.id); }}
            onDragOver={event => { if (dragEnabled) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
            onDrop={event => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggedId; if (dragEnabled && sourceId && sourceId !== cat.id) onMoveCategoryTo?.(sourceId, cat.id); setDraggedId(null); }}
            onDragEnd={() => setDraggedId(null)}
            className={`flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 ${dragEnabled ? 'cursor-grab active:cursor-grabbing' : ''} ${draggedId === cat.id ? 'opacity-50' : ''}`}>
            <div style={cat.color.startsWith("linear-gradient(") ? { background: cat.color } : cat.color.startsWith("#") ? { backgroundColor: cat.color } : undefined} className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${cat.color.startsWith("linear-gradient(") || cat.color.startsWith("#") ? "" : cat.color} text-white`}>
              <DynamicIcon name={cat.icon} className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900 dark:text-gray-100">{cat.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {products.filter((p) => p.categoryId === cat.id).length} Artikel
              </p>
            </div>
            {cat.id !== SHOT_CATEGORY_ID && (
              <div className="flex gap-1">
                <button onClick={() => setEditing(cat)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label={`${cat.name} bearbeiten`}>
                  <Edit3 className="h-4 w-4" />
                </button>
                <button onClick={() => setDeleteCat(cat)} className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30" aria-label={`${cat.name} löschen`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {(creating || editing) && (
        <CategoryModal
          category={editing}
          categories={categories}
          onSave={(data) => {
            if (editing) onUpdateCategory(editing.id, data);
            else onAddCategory({ ...data, sortOrder: categories.length });
            setCreating(false);
            setEditing(null);
          }}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
      {deleteCat && (
        <ConfirmDialog
          title={`Gruppe "${deleteCat.name}" löschen?`}
          message="Alle Artikel dieser Gruppe werden ebenfalls gelöscht. Diese Aktion kann nicht rückgängig gemacht werden."
          onConfirm={() => { onDeleteCategory(deleteCat.id); setDeleteCat(null); }}
          onClose={() => setDeleteCat(null)}
        />
      )}
    </div>
  );
}

function CategoryModal({ category, onSave, onClose }: {
  category: Category | null;
  categories: Category[];
  onSave: (data: { name: string; icon: string; color: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? 'Package');
  const [color, setColor] = useState(category?.color ?? COLOR_OPTIONS[0].value);
  const oldGradient = color.match(/^linear-gradient\(135deg, (#[0-9a-fA-F]{6}), (#[0-9a-fA-F]{6})\)$/);
  const initialHex = /^#[0-9a-fA-F]{6}$/.test(color) ? color : oldGradient?.[1] ?? '#0ea5e9';
  const [rgb, setRgb] = useState(() => [1, 3, 5].map((i) => parseInt(initialHex.slice(i, i + 2), 16)));
  const updateRgb = (index: number, value: number) => {
    const next = [...rgb];
    next[index] = Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)));
    setRgb(next);
    setColor('#' + next.map(v => v.toString(16).padStart(2, '0')).join(''));
  };
  const updateHex = (hex: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    setRgb([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
    setColor(hex);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{category ? 'Gruppe bearbeiten' : 'Neue Gruppe'}</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Getränke"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Icon</label>
            <div className="grid max-h-32 grid-cols-8 gap-1.5 overflow-y-auto rounded-xl border border-gray-200 p-2 dark:border-gray-700">
              {availableIconNames.map((name) => (
                <button key={name} onClick={() => setIcon(name)}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${icon === name ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                  <DynamicIcon name={name} className="h-5 w-5" />
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Farbe</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((c) => (
                <button key={c.value} onClick={() => setColor(c.value)}
                  title={c.label} aria-label={`Farbe ${c.label}`} className={`h-10 w-10 rounded-xl bg-gradient-to-br ${c.value} transition ${color === c.value ? 'ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-gray-800' : ''}`} />
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <p className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">Eigene Farbe (RGB)</p>
              <div className="flex flex-wrap items-center gap-3">
                <input type="color" aria-label="Farbe aus Farbpalette auswählen" value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : initialHex} onChange={e => updateHex(e.target.value)} className="h-12 w-16 cursor-pointer rounded-lg" />
                {(['R', 'G', 'B'] as const).map((channel, index) => (
                  <label key={channel} className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200">{channel}
                    <input type="number" min={0} max={255} value={rgb[index]} onChange={e => updateRgb(index, Number(e.target.value))} className="w-16 rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Eine Farbe auswählen oder RGB-Werte von 0 bis 255 eingeben.</p>
            </div>
          </div>
          <button onClick={() => name.trim() && onSave({ name: name.trim(), icon, color })}
            disabled={!name.trim()}
            className="w-full rounded-xl bg-blue-600 py-3 text-base font-semibold text-white shadow-md transition hover:bg-blue-700 active:scale-95 disabled:opacity-50">
            <Save className="mr-1.5 inline h-4 w-4" /> Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Product Manager ----

function ProductManager({ categories, products, onAddProduct, onUpdateProduct, onDeleteProduct, onMoveProductTo, pfandSettings, onUpdatePfandSettings, testMode = false }: AdminDataProps) {
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);
  const [filterCat, setFilterCat] = useState<string>('');
  const [sortMode, setSortMode] = useState<'alphabetical' | 'reverse' | 'manual'>('manual');
  const [draggedProductId, setDraggedProductId] = useState<string | null>(null);
  const [dragEnabled, setDragEnabled] = useState(false);
  const [pfandF, setPfandF] = useState(String(pfandSettings.Friedrichshafen));
  const [pfandB, setPfandB] = useState(String(pfandSettings.Bregenz));
  const [pfandPhase, setPfandPhase] = useState<'idle' | 'dirty' | 'saving' | 'cloud' | 'local' | 'error'>('idle');
  const [pfandError, setPfandError] = useState('');
  const [pfandEditing, setPfandEditing] = useState(false);

  // A cloud change is allowed to refresh untouched form fields. Never replace
  // an operator's ongoing edit with a background sync result.
  useEffect(() => {
    if (pfandEditing || pfandPhase === 'saving') return;
    setPfandF(String(pfandSettings.Friedrichshafen));
    setPfandB(String(pfandSettings.Bregenz));
  }, [pfandSettings, pfandEditing, pfandPhase]);

  // Automatisch speichern (25.11.): kurz nach der letzten Eingabe oder beim Verlassen des Feldes.
  const pfandValid = parsePfandAmount(pfandF) !== null && parsePfandAmount(pfandB) !== null;
  useEffect(() => {
    if (pfandPhase !== 'dirty' || !pfandValid) return;
    const timer = window.setTimeout(() => { void savePfandSettings(); }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pfandPhase, pfandF, pfandB, pfandValid]);
  // Die Meldung „Gespeichert“ blendet sich nach einigen Sekunden wieder aus.
  useEffect(() => {
    if (pfandPhase !== 'cloud' && pfandPhase !== 'local') return;
    const timer = window.setTimeout(() => setPfandPhase('idle'), 4000);
    return () => window.clearTimeout(timer);
  }, [pfandPhase]);

  const sorted = [...products].sort(sortMode === 'alphabetical'
    ? (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })
    : sortMode === 'reverse'
      ? (a, b) => b.name.localeCompare(a.name, 'de', { sensitivity: 'base' })
      : (a, b) => a.sortOrder - b.sortOrder);
  const filtered = filterCat ? sorted.filter((p) => p.categoryId === filterCat) : sorted;

  async function savePfandSettings() {
    if (pfandPhase === 'saving') return;
    const f = parsePfandAmount(pfandF);
    const b = parsePfandAmount(pfandB);
    if (f === null || b === null) {
      setPfandPhase('error');
      setPfandError('Bitte beide Standortwerte als nichtnegative Eurobeträge mit maximal zwei Nachkommastellen eingeben.');
      return;
    }
    setPfandPhase('saving');
    setPfandError('');
    try {
      const result = await onUpdatePfandSettings({ Friedrichshafen: f, Bregenz: b });
      setPfandEditing(false);
      setPfandF(f.toFixed(2).replace('.', ','));
      setPfandB(b.toFixed(2).replace('.', ','));
      setPfandPhase(result === 'cloud' ? 'cloud' : 'local');
    } catch (reason) {
      // The store already adopted the values locally. A failed readback must
      // remain visible, not be disguised as a successful Cloud write.
      setPfandPhase('error');
      setPfandError(`Lokal übernommen, aber nicht in der Cloud bestätigt: ${reason instanceof Error ? reason.message : 'Unbekannter Fehler'}`);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Artikel verwalten</h3>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-blue-700 active:scale-95">
          <Plus className="h-4 w-4" /> Neuer Artikel
        </button>
      </div>

      {/* Global pfand settings */}
      <div className="mb-4 w-fit max-w-full rounded-2xl border border-green-200 bg-green-50 p-4 dark:border-green-700 dark:bg-green-900/20">
        <div className="mb-2 flex items-center gap-2">
          <Recycle className="h-5 w-5 text-green-600 dark:text-green-400" />
          <p className="text-sm font-bold text-green-800 dark:text-green-300">Globaler Pfandbetrag</p>
        </div>
        <p className="mb-3 text-xs text-green-700/80 dark:text-green-400/70">Diese Beträge gelten für alle als Pfandartikel markierten Artikel. Pro Standort individuell einstellbar.</p>
        <div className="flex flex-wrap items-end gap-4">
          {LOCATIONS.map((loc) => {
            const val = loc === 'Friedrichshafen' ? pfandF : pfandB;
            const setVal = loc === 'Friedrichshafen' ? setPfandF : setPfandB;
            return (
              <div key={loc}>
                <label className="mb-1 block text-xs font-semibold text-green-700 dark:text-green-400">{loc}</label>
      <div className="flex items-center gap-1">
                  <input value={val} onChange={(e) => { setVal(e.target.value); setPfandEditing(true); setPfandPhase('dirty'); setPfandError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (pfandValid) void savePfandSettings(); } }}
                    onBlur={() => { if (pfandPhase === 'dirty' && pfandValid) void savePfandSettings(); }}
                    placeholder="0,00" inputMode="decimal" disabled={pfandPhase === 'saving'}
                    aria-label={`Pfandbetrag ${loc} in Euro`}
                    className="w-24 rounded-lg border border-green-300 bg-white px-2.5 py-2 text-sm text-gray-900 focus:border-green-500 focus:outline-none disabled:opacity-50 dark:border-green-700 dark:bg-gray-900 dark:text-gray-100" />
                  <span className="text-sm text-green-600 dark:text-green-400">€</span>
                </div>
              </div>
            );
          })}
          <span role="status" aria-live="polite" className="text-xs font-semibold">
            {pfandPhase === 'cloud' && <span className="flex items-center gap-1 text-green-700 dark:text-green-400"><Check className="h-3.5 w-3.5" /> Gespeichert</span>}
            {pfandPhase === 'local' && <span className="text-amber-700 dark:text-amber-400">Gespeichert (nur lokal, Testmodus)</span>}
            {pfandPhase === 'dirty' && !pfandValid && <span className="text-amber-700 dark:text-amber-400">Bitte einen gültigen Betrag eingeben (z. B. 3 oder 3,50)</span>}
            {pfandPhase === 'saving' && <span className="text-amber-700 dark:text-amber-400">Wird gespeichert …</span>}
            {pfandPhase === 'error' && <span role="alert" className="text-red-700 dark:text-red-400">{pfandError}</span>}
            {pfandPhase === 'idle' && testMode && <span className="text-amber-700 dark:text-amber-400">Testmodus: Einstellungen werden nicht in die Cloud hochgeladen</span>}
          </span>
        </div>
      </div>
      <div className="-mx-6 -mt-4 mb-0 flex gap-1.5 overflow-x-auto px-6 pb-6 pt-4">
        <button onClick={() => setFilterCat('')} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold shadow-sm transition ${!filterCat ? 'woodmo-cat-active bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-200 text-slate-500 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600'}`}>Alle</button>
        {[...categories].filter((cat) => cat.id !== SHOT_CATEGORY_ID).sort((a, b) => a.sortOrder - b.sortOrder).map((cat) => (
          <button key={cat.id} onClick={() => setFilterCat(cat.id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold shadow-sm transition ${filterCat === cat.id ? 'woodmo-cat-active bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-200 text-slate-500 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600'}`}>{cat.name}</button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-start gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          Sortierung:
          <select aria-label="Artikel sortieren" value={filterCat ? `cat:${filterCat}` : sortMode} onChange={e => {
              const value = e.target.value;
              // A Warengruppe entry only filters the list (in own order);
              // a sort entry shows all articles again.
              if (value.startsWith('cat:')) { setFilterCat(value.slice(4)); setSortMode('manual'); }
              else { setFilterCat(''); setSortMode(value as 'alphabetical' | 'reverse' | 'manual'); }
              setDragEnabled(false);
            }}
            className={`rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white ${filterCat ? 'woodmo-cat-active' : ''}`}>
            <option value="manual">Filter &amp; Sortierung</option>
            <option value="alphabetical">Aufsteigend (A–Z)</option>
            <option value="reverse">Absteigend (Z–A)</option>
            <optgroup label="Nur Warengruppe anzeigen">
              {[...categories].filter((cat) => cat.id !== SHOT_CATEGORY_ID).sort((a, b) => a.sortOrder - b.sortOrder).map((cat) => (
                <option key={cat.id} value={`cat:${cat.id}`}>{cat.name}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <button type="button" aria-pressed={dragEnabled} onClick={() => { if (!dragEnabled) setSortMode('manual'); setDragEnabled(!dragEnabled); }}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${dragEnabled ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}>
          {dragEnabled ? '✓ Verschieben aktiv' : 'Kacheln verschieben'}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((product) => {
          const cat = categories.find((c) => c.id === product.categoryId);
          return (
            <div key={product.id}
              draggable={dragEnabled && Boolean(onMoveProductTo)}
              onDragStart={event => { if (!dragEnabled) return; setDraggedProductId(product.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', product.id); }}
              onDragOver={event => { if (dragEnabled) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
              onDrop={event => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggedProductId; if (dragEnabled && sourceId && sourceId !== product.id) onMoveProductTo?.(sourceId, product.id); setDraggedProductId(null); }}
              onDragEnd={() => setDraggedProductId(null)}
              className={`flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 ${dragEnabled ? 'cursor-grab active:cursor-grabbing' : ''} ${draggedProductId === product.id ? 'opacity-50' : ''}`}>
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-700">
                {product.imageUrl ? <img src={publicAssetUrl(product.imageUrl)} alt={product.name} className="h-full w-full object-cover" /> : <Package className="h-6 w-6 text-gray-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate font-semibold text-gray-900 dark:text-gray-100">
                  {product.name}
                  {product.hasShot && <Wine className="ml-1 inline h-3.5 w-3.5 text-blue-500" />}
                  {product.isPfandArticle && <Recycle className="ml-1 inline h-3.5 w-3.5 text-green-500" />}
                  {product.hasIndividualPrice && <Euro className="ml-1 inline h-3.5 w-3.5 text-amber-500" />}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {product.hasIndividualPrice ? 'Individueller Preis' : <>F: {formatCurrency(product.prices.Friedrichshafen)} · B: {formatCurrency(product.prices.Bregenz)}</>}
                  {' · '}{cat?.name ?? '—'}
                </p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setEditing(product)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
                  <Edit3 className="h-4 w-4" />
                </button>
                <button onClick={() => setDeleteProduct(product)} className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {(creating || editing) && (
        <ProductModal
          product={editing}
          categories={categories}
          pfandSettings={pfandSettings}
          onSave={(data) => {
            if (editing) onUpdateProduct(editing.id, data);
            else onAddProduct({ ...data, sortOrder: products.length });
            setCreating(false);
            setEditing(null);
          }}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
      {deleteProduct && (
        <ConfirmDialog
          title={`Artikel "${deleteProduct.name}" löschen?`}
          message="Dieser Artikel wird dauerhaft entfernt. Diese Aktion kann nicht rückgängig gemacht werden."
          onConfirm={() => { onDeleteProduct(deleteProduct.id); setDeleteProduct(null); }}
          onClose={() => setDeleteProduct(null)}
        />
      )}
    </div>
  );
}

function ProductModal({ product, categories, pfandSettings, onSave, onClose }: {
  product: Product | null;
  categories: Category[];
  pfandSettings: PfandSettings;
  onSave: (data: Omit<Product, 'id'>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? '');
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? '');
  const [taxClass, setTaxClass] = useState<TaxClass>(product?.taxClass ?? 'standard');
  const [available, setAvailable] = useState(product?.available ?? true);
  const [hasShot, setHasShot] = useState(product?.hasShot ?? false);
  const [isPfandArticle, setIsPfandArticle] = useState(product?.isPfandArticle ?? false);
  const [hasIndividualPrice, setHasIndividualPrice] = useState(product?.hasIndividualPrice ?? false);
  const [priceF, setPriceF] = useState(String(product?.prices.Friedrichshafen ?? ''));
  const [priceB, setPriceB] = useState(String(product?.prices.Bregenz ?? ''));
  const [priceErrors, setPriceErrors] = useState<Partial<Record<Location, string>>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isSupported(file)) {
      setUploadError('Format nicht unterstützt. Bitte JPG, PNG, BMP oder PDF.');
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const publicUrl = await uploadArticleImage(file);
      if (publicUrl) {
        setImageUrl(publicUrl);
      } else {
        const dataURL = await importFileToDataURL(file);
        setImageUrl(dataURL);
        setUploadError('Bild lokal gespeichert — Supabase nicht erreichbar. Auf anderen Geräten evtl. nicht sichtbar.');
      }
    } catch {
      setUploadError('Bild konnte nicht verarbeitet werden.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function handleSave() {
    if (!name.trim() || !categoryId) return;
    let pF = product?.prices.Friedrichshafen ?? 0;
    let pB = product?.prices.Bregenz ?? 0;
    if (!hasIndividualPrice) {
      const rF = parsePriceInput(priceF);
      const rB = parsePriceInput(priceB);
      const errors: Partial<Record<Location, string>> = {};
      if (!rF.ok) errors.Friedrichshafen = rF.error;
      if (!rB.ok) errors.Bregenz = rB.error;
      setPriceErrors(errors);
      if (!rF.ok || !rB.ok) return;
      pF = rF.value;
      pB = rB.value;
    }
    const pfandF = isPfandArticle ? pfandSettings.Friedrichshafen : 0;
    const pfandB = isPfandArticle ? pfandSettings.Bregenz : 0;
    onSave({
      name: name.trim(), categoryId, imageUrl: imageUrl.trim(), taxClass, taxRates: product?.taxClass === taxClass ? product?.taxRates : undefined, available, hasShot,
      isPfandArticle, hasIndividualPrice,
      shotPrices: undefined,
      prices: { Friedrichshafen: pF, Bregenz: pB },
      pfand: { Friedrichshafen: pfandF, Bregenz: pfandB },
      sortOrder: product?.sortOrder ?? 0,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{product ? 'Artikel bearbeiten' : 'Neuer Artikel'}</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3.5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Cola 0,5l"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">MwSt-Satz</label>
              <div className="flex gap-1.5">
                {(['reduced', 'standard'] as TaxClass[]).map((cls) => (
                  <button key={cls} onClick={() => setTaxClass(cls)}
                    className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${taxClass === cls ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
                    {cls === 'reduced' ? 'Reduziert' : 'Standard'}
                    <span className="ml-1 text-[10px] font-normal opacity-80">
                      (DE:{cls === 'reduced' ? '7' : '19'}% / AT:{cls === 'reduced' ? '10' : '20'}%)
                    </span>
                  </button>
                ))}
              </div>
              {product?.taxRates && product.taxClass === taxClass && <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">Importierte Steuersätze gelten: DE {product.taxRates.Friedrichshafen}% / AT {product.taxRates.Bregenz}%. Eine andere Steuerklasse ersetzt diese Sätze beim Speichern.</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Warengruppe</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
                {categories.filter((cat) => cat.id !== SHOT_CATEGORY_ID).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
            </div>
          </div>

          {/* Location-based prices */}
          <div className={`rounded-xl p-3 dark:bg-gray-900/40 ${hasIndividualPrice ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-gray-50'}`}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Preise nach Standort</p>
            {hasIndividualPrice ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">Der Preis wird an der Kasse individuell eingegeben — z.B. für Holzbretter oder nach Gewicht.</p>
            ) : (
              LOCATIONS.map((loc) => {
                const priceVal = loc === 'Friedrichshafen' ? priceF : priceB;
                const setPrice = loc === 'Friedrichshafen' ? setPriceF : setPriceB;
                const error = priceErrors[loc];
                return (
                  <div key={loc} className="mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-28 text-xs font-semibold text-gray-600 dark:text-gray-300">{loc}</span>
                      <input value={priceVal} onChange={(e) => { setPrice(e.target.value); setPriceErrors(prev => ({ ...prev, [loc]: undefined })); }} placeholder="Preis" inputMode="decimal" aria-invalid={!!error}
                        className={`w-24 rounded-lg border bg-white px-2.5 py-2 text-sm text-gray-900 focus:outline-none dark:bg-gray-900 dark:text-gray-100 ${error ? 'border-red-500 ring-1 ring-red-500' : 'border-gray-200 focus:border-blue-500 dark:border-gray-700'}`} />
                      <span className="text-xs text-gray-400">€</span>
                    </div>
                    {error && <p role="alert" className="mt-1 text-xs font-semibold text-red-500">{error}</p>}
                  </div>
                );
              })
            )}
          </div>

          {/* Pfand & Individual price toggles */}
          <div className="space-y-2.5">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Recycle className="h-4 w-4 text-green-500" />
              <input type="checkbox" checked={isPfandArticle} onChange={(e) => setIsPfandArticle(e.target.checked)} className="h-4 w-4 rounded accent-green-600" />
              Pfandartikel
              {isPfandArticle && <span className="text-xs text-green-600 dark:text-green-400">(F: {formatCurrency(pfandSettings.Friedrichshafen)} · B: {formatCurrency(pfandSettings.Bregenz)})</span>}
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Euro className="h-4 w-4 text-amber-500" />
              <input type="checkbox" checked={hasIndividualPrice} onChange={(e) => setHasIndividualPrice(e.target.checked)} className="h-4 w-4 rounded accent-amber-600" />
              Individueller Preis an der Kasse
            </label>
          </div>

          <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-200">
            <label className="flex items-center gap-2 font-medium">
              <Wine className="h-4 w-4" />
              <input type="checkbox" checked={hasShot} onChange={(e) => setHasShot(e.target.checked)} />
              SCHUSS auch für diesen Artikel erlauben
            </label>
            <p className="mt-1 text-xs">Pfandartikel haben die SCHUSS-Auswahl immer im Warenkorb. Die Preise werden zentral unter „SCHUSS“ festgelegt. Jeder Artikel wird zunächst ohne Schuss aufgenommen.</p>
          </div>

          {/* Image */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Bild</label>
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-700">
                {imageUrl ? <img src={publicAssetUrl(imageUrl)} alt="Vorschau" className="h-full w-full object-cover" /> : <Package className="h-7 w-7 text-gray-400" />}
              </div>
              <div className="flex-1 space-y-1.5">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-600 transition hover:border-blue-500 hover:text-blue-600 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-blue-400 dark:hover:text-blue-400">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? 'Wird verarbeitet...' : 'Bild importieren (JPG, PNG, BMP, PDF)'}
                </button>
                <input ref={fileRef} type="file" accept={ACCEPTED_TYPES} onChange={handleFileChange} className="hidden" />
                <div className="flex gap-1.5">
                  <input value={imageUrl.startsWith('data:') ? '' : imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="oder Bild-URL eingeben"
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
                  {imageUrl && (
                    <button type="button" onClick={() => setImageUrl('')} className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            {uploadError && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
            Verfügbar
          </label>
          <button onClick={handleSave}
            className="w-full rounded-xl bg-blue-600 py-3 text-base font-semibold text-white shadow-md transition hover:bg-blue-700 active:scale-95">
            <Save className="mr-1.5 inline h-4 w-4" /> Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Live Session Overview ----

function LiveSessionOverview({ transactions, cashSessions, stornos, categories, activeSession, selectedLocation, onSwitchLocation, onOpenCash, exportedByName }: {
  transactions: Transaction[];
  stornos: StornoRecord[];
  cashSessions: CashSession[];
  categories: Category[];
  activeSession: CashSession | null;
  selectedLocation: Location;
  onSwitchLocation: (loc: Location) => void;
  onOpenCash?: () => void;
  exportedByName?: string;
}) {
  // 27.11.: Beim Öffnen immer das heutige Datum („letzter Umsatztag“ bleibt als Sprungziel).
  const [selectedDate, setSelectedDate] = useState<string>(() => formatDateISO(Date.now()));
  const [previewReport, setPreviewReport] = useState<JournalReportData | null>(null);
  const [infoLocation, setInfoLocation] = useState<Location | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [today, setToday] = useState(() => formatDateISO(Date.now()));
  const isToday = selectedDate === today;

  useEffect(() => {
    const followCalendar = () => {
      const next = formatDateISO(Date.now());
      if (next === today) return;
      setToday(next);
      if (selectedDate === today) {
        setSelectedDate(next);
      }
    };
    const timer = window.setInterval(followCalendar, 1000);
    window.addEventListener('focus', followCalendar);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', followCalendar);
    };
  }, [today, selectedDate]);

  function handleSwitch(loc: Location) {
    if (loc === selectedLocation) return;
    onSwitchLocation(loc);
    setToast(`Zu ${loc} gewechselt`);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  function shiftDate(days: number) {
    const next = shiftIsoDay(selectedDate, days);
    if (next <= today) setOverviewDate(next);
  }
  const swipe = useDaySwipe(() => shiftDate(-1), () => shiftDate(1));
  // Standardmäßig nur der ausgewählte Standort (Wunsch 23.11.); „Alle Standorte“ zeigt beide.
  const [showAllLocations, setShowAllLocations] = useState(true); // wie gewohnt: beide Kassen
  // Letzter Tag mit Umsatz am ausgewählten Standort (bis heute).
  const lastSalesDay = useMemo(() => {
    let latest: string | null = null;
    for (const t of transactions) {
      if (t.location !== selectedLocation) continue;
      const day = formatDateISO(t.timestamp);
      if (day <= today && (latest === null || day > latest)) latest = day;
    }
    return latest;
  }, [transactions, selectedLocation, today]);

  function setOverviewDate(next: string) {
    setSelectedDate(next);
  }

  const locationData = useMemo(() => {
    return LOCATIONS.map((loc) => {
      // Ganzer Tag: Umsatz aller Kassensitzungen dieses Tages zusammen.
      // Status und Kassenbestand kommen von der neuesten Sitzung.
      const day = buildDayOverview(cashSessions, transactions, selectedDate, loc, stornos);
      const session = day.latest?.session ?? null;
      const txToday = day.transactions;
      const taxByRateMap = mergeTaxByRate(txToday);
      let total = 0, count = 0, totalNet = 0, totalPfand = 0;
      for (const t of txToday) {
        total += t.subtotal;
        count++;
        totalNet += transactionNet(t);
        totalPfand += t.totalPfand;
      }
      const totalTax = [...taxByRateMap.values()].reduce((s, v) => s + v, 0);
      const taxByRate: Record<number, number> = {};
      for (const [k, v] of taxByRateMap) taxByRate[k] = v;
      const cashBalance = day.latest?.cashBalance ?? 0;
      // Pfand getrennt: eingenommen (Bar+Karte) und ausgezahlte Retoure, aus den Buchungen.
      const pfandStats = computeJournalStats(txToday);
      // Endgültige Tagesabschlüsse dieses Tages (jede TA-Nummer einzeln erreichbar).
      // 24.11.: Abschluss gehört zum Tag der endgültigen Buchung (nicht zum Eröffnungstag).
      const closes = day.parts.map((part) => part.session).filter((s) => !!s.dailyCloseFinalizedAt && !!s.dailyCloseReceiptNumber && formatDateISO(s.dailyCloseFinalizedAt) === selectedDate);

      return { loc, session, day, txToday, taxByRateMap, total, count, totalNet, totalTax, totalPfand, taxByRate, cashBalance, pfandCollected: pfandStats.pfandCollected, pfandReturned: pfandStats.pfandReturned, closes };
    });
  }, [transactions, cashSessions, selectedDate, stornos]);

  function reportForLocation(loc: Location, txToday: Transaction[]) {
    return buildDailyReport(
      loc,
      selectedDate,
      txToday,
      categories,
      locationData.find((data) => data.loc === loc)?.day.parts.map((part) => part.session) ?? [],
      exportedByName,
      transactions,
    );
  }

  function exportLocation(loc: Location, txToday: Transaction[]) {
    void exportJournalPdf(reportForLocation(loc, txToday));
  }

  function printLocation(loc: Location, txToday: Transaction[]) {
    openJournalPrintDialog(reportForLocation(loc, txToday));
  }

  const dateLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-start gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Kassen-Übersicht</h3>
        </div>
        <DateNav value={selectedDate} onChange={setOverviewDate} max={today} lastSalesDay={lastSalesDay} />
        {/* Standort direkt in der Verwaltung wechseln (24.11.) oder beide anzeigen. */}
        <div role="group" aria-label="Standort" className="flex h-[46px] overflow-hidden rounded-xl border border-gray-300 text-xs font-semibold dark:border-gray-600">
          {LOCATIONS.map((loc) => (
            <button key={loc} type="button" aria-pressed={!showAllLocations && selectedLocation === loc} style={locationStyle(loc)}
              onClick={() => { setShowAllLocations(false); handleSwitch(loc); }}
              className={`px-3 ${!showAllLocations && selectedLocation === loc ? 'bg-[var(--loc-strong)] text-white' : 'text-[var(--loc-strong)] hover:bg-[var(--loc-soft)] dark:text-[var(--loc-light)]'}`}>
              {loc}
            </button>
          ))}
          <button type="button" aria-pressed={showAllLocations} onClick={() => setShowAllLocations(true)}
            className={`border-l border-gray-300 px-3 dark:border-gray-600 ${showAllLocations ? 'bg-gradient-to-r from-[#16a34a] to-[#2563eb] text-white' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'}`}>
            Alle
          </button>
        </div>
      </div>
      <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">{dateLabel}{isToday ? ' · Heute' : ''}</p>
      <div {...swipe} className={`relative grid gap-4 ${showAllLocations ? 'lg:grid-cols-2' : ''}`}>
        {locationData.filter((data) => showAllLocations || data.loc === selectedLocation).map((data) => (
          <LocationSessionCard
            key={data.loc}
            loc={data.loc}
            session={data.session}
            // 24.11.: nur Sitzungen mit Buchungen an diesem Tag oder noch offen (nicht: nur heute abgeschlossen).
            sessionCount={data.day.parts.filter((part) => part.transactions.length > 0 || !part.session.closed).length}
            total={data.total}
            count={data.count}
            pfandCollected={data.pfandCollected}
            pfandReturned={data.pfandReturned}
            closes={data.closes}
            onReport={(s) => setPreviewReport(closedSessionReport(s, transactions, categories, exportedByName, stornos))}
            totalTax={data.totalTax}
            totalPfand={data.totalPfand}
            cashBalance={data.cashBalance}
            taxByRateMap={data.taxByRateMap}
            txToday={data.txToday}
            isActive={isToday && activeSession?.location === data.loc}
            isSelected={selectedLocation === data.loc}
            isHistoric={!isToday}
            onExport={() => exportLocation(data.loc, data.txToday)}
            onPrint={() => printLocation(data.loc, data.txToday)}
            onSwitch={() => handleSwitch(data.loc)}
            onOpenCash={isToday && selectedLocation === data.loc ? onOpenCash : undefined}
            onInfo={() => setInfoLocation(data.loc)}
          />
        ))}
        {toast && (
          <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center">
            <div className="flex items-center gap-2 rounded-full bg-green-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg">
              <Check className="h-4 w-4" /> {toast}
            </div>
          </div>
        )}
      </div>
      {infoLocation && (
        <DayInfoDialog
          location={infoLocation}
          date={selectedDate}
          categories={categories}
          transactions={locationData.find((d) => d.loc === infoLocation)?.txToday ?? []}
          parts={locationData.find((d) => d.loc === infoLocation)?.day.parts ?? []}
          onClose={() => setInfoLocation(null)}
        />
      )}
      {previewReport && <JournalPreviewDialog data={previewReport} onClose={() => setPreviewReport(null)} />}
    </div>
  );
}

function LocationSessionCard({ loc, session, sessionCount, total, count, totalTax, totalPfand, pfandCollected, pfandReturned, closes, onReport, onOpenCash, cashBalance, taxByRateMap, txToday, isActive, isSelected, isHistoric, onExport, onPrint, onSwitch, onInfo }: {
  loc: Location;
  session: CashSession | null;
  sessionCount: number;
  total: number;
  count: number;
  totalTax: number;
  totalPfand: number;
  pfandCollected: number;
  pfandReturned: number;
  closes: CashSession[];
  onReport: (session: CashSession) => void;
  onOpenCash?: () => void;
  cashBalance: number;
  taxByRateMap: Map<number, number>;
  txToday: Transaction[];
  isActive: boolean;
  isSelected: boolean;
  isHistoric: boolean;
  onExport: () => void;
  onPrint: () => void;
  onSwitch: () => void;
  onInfo: () => void;
}) {
  const rates = LOCATION_TAX_RATES[loc];
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportsAsc, setReportsAsc] = useState(true);
  const closeLabels = closes.map((c) => ({
    session: c,
    label: formatDailyCloseReceiptNumber(c.dailyCloseReceiptNumber!, c.dailyCloseReceiptLocation ?? c.location, c.dailyCloseFinalizedAt ?? c.closedAt ?? c.openedAt, c.dailyCloseReceiptYear) ?? String(c.dailyCloseReceiptNumber),
  }));
  // Sortierung über den numerischen Teil am Ende der TA-Nummer.
  const sortedCloses = [...closeLabels].sort((x, y) => {
    const nx = Number(/(\d+)\D*$/.exec(x.label)?.[1] ?? 0), ny = Number(/(\d+)\D*$/.exec(y.label)?.[1] ?? 0);
    return reportsAsc ? nx - ny : ny - nx;
  });
  const finalized = !!session?.dailyCloseFinalizedAt;
  const [salesOpen, setSalesOpen] = useState(false);
  const isClosed = !!session?.closed;
  const statusLabel = isClosed ? 'ABGESCHLOSSEN' : isHistoric ? (session ? 'OFFEN' : 'KEINE KASSE') : session ? 'OFFEN' : 'GESPERRT';
  const statusClass = isClosed
    ? 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
    : isHistoric
      ? session ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
      : isActive ? 'bg-green-600 text-white' : session ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400';

  return (
    <div style={locationStyle(loc)} onClick={(e) => {
        // 24.11.: Freie Kartenfläche wählt den Standort; Bedienelemente behalten ihre eigene Aktion.
        if (isSelected || (e.target as HTMLElement).closest('button, a, input, select, summary, [role="dialog"]')) return;
        onSwitch();
      }} className={`${isSelected ? '' : 'cursor-pointer '}overflow-hidden rounded-2xl border-2 shadow-sm transition dark:shadow-lg ${isSelected ? 'woodmo-loc-pulse border-[var(--loc-strong)]' : 'border-[var(--loc-border)] opacity-90 [filter:grayscale(.4)_brightness(.92)]'} bg-white dark:bg-gray-800`}>
      {/* Header — clickable to select this location */}
      <div role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onSwitch(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSwitch(); } }}
        className={`flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left transition bg-[var(--loc-soft)] hover:brightness-110`}
      >
        <div className="flex items-center gap-2">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--loc-strong)] text-white`}>
            <MapPin className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{loc}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {isClosed ? 'Abgeschlossen' : isHistoric ? (session ? 'Offen' : 'Keine Kasse') : session ? (isActive ? 'Aktive Kasse' : 'Geöffnet') : 'Nicht eröffnet'}
            </p>
          </div>
        </div>
        {/* Mitte: Klappmenü „Berichte“ mit den TA-Nummern dieses Standorts/Tages (24.11.) */}
        <div className="relative flex flex-1 items-center justify-center" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {closeLabels.length > 0 && (
            <>
              <button type="button" onClick={() => setReportsOpen((v) => !v)} aria-expanded={reportsOpen}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700">
                <FileText className="h-3.5 w-3.5" /> Berichte ({closeLabels.length})
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${reportsOpen ? 'rotate-180' : ''}`} />
              </button>
              {reportsOpen && (
                <div className="absolute left-1/2 top-full z-30 mt-1 w-64 -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                  <button type="button" onClick={() => setReportsAsc((v) => !v)}
                    className="mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700">
                    Sortierung: {reportsAsc ? 'aufsteigend' : 'absteigend'}
                    <ChevronDown className={`h-3.5 w-3.5 ${reportsAsc ? 'rotate-180' : ''}`} />
                  </button>
                  {sortedCloses.map(({ session: c, label }) => (
                    <button key={c.id} type="button" onClick={() => { setReportsOpen(false); onReport(c); }}
                      className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold text-gray-800 hover:bg-blue-50 dark:text-gray-100 dark:hover:bg-blue-900/30">
                      <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" /> {label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {closes.length === 0 && txToday.length === 0 && (
            <span className="text-center text-xs font-semibold text-gray-400">Keine Buchungen an diesem Tag!</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isSelected && (
            <span className="flex items-center gap-1 rounded-full bg-[var(--loc-strong)] px-2.5 py-1 text-xs font-bold text-white shadow-sm">
              <Check className="h-3 w-3" /> AUSGEWÄHLT
            </span>
          )}
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {/* Cash balance + opening */}
        {session && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
              <p className="text-xs text-gray-400">{sessionCount > 1 ? 'Anfangsbestand (letzte Kasse)' : 'Anfangsbestand'}</p>
              <p className="text-base font-bold text-gray-900 dark:text-gray-100">{formatCurrency(session.openingBalance)}</p>
            </div>
            <div className="rounded-xl bg-blue-50 px-3 py-2 dark:bg-blue-900/20">
              <p className="text-xs text-blue-400">{finalized
                ? `Kassenendbestand vom ${new Date(session.dailyCloseFinalizedAt!).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
                : 'Kassenbestand seit letzter Buchung'}</p>
              <p className="text-base font-bold text-blue-700 dark:text-blue-300">{formatCurrency(finalized ? (session.closingBalance ?? cashBalance) : cashBalance)}</p>
            </div>
          </div>
        )}

        {/* Umsatz des Tages (24.11.): Brutto inkl. Pfand, Pfand, MwSt, Netto */}
        <div className="mb-3 rounded-xl border border-[var(--loc-border)] bg-[var(--loc-soft)] p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-[var(--loc-strong)] dark:text-[var(--loc-light)]" />
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--loc-strong)] dark:text-[var(--loc-light)]">Umsatz des Tages</p>
          </div>
          {sessionCount > 1 && (
            <p className="mb-2 text-xs font-medium text-[var(--loc-strong)] opacity-80 dark:text-[var(--loc-light)]">{sessionCount} Kassensitzungen an diesem Tag · Umsatz zusammengerechnet</p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {([
              ['Umsatz brutto (inkl. Pfand)', total + totalPfand],
              ['Pfand eingenommen', pfandCollected],
              ['Pfandretoure gesamt', pfandReturned === 0 ? 0 : -Math.abs(pfandReturned)],
            ] as const).map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-[var(--loc-strong)] opacity-80 dark:text-[var(--loc-light)]">{label}</p>
                <p className="text-sm font-bold text-[var(--loc-strong)] dark:text-[var(--loc-light)]">{formatCurrency(value)}</p>
              </div>
            ))}
            {/* MwSt.: reduziert + regulär je Standort, darunter gesamt */}
            <div>
              {[rates.reduced, rates.standard].map((rate) => (
                <p key={rate} className="text-xs text-[var(--loc-strong)] opacity-80 dark:text-[var(--loc-light)]">MwSt. {rate} %: <span className="font-semibold">{formatCurrency(taxByRateMap.get(rate) ?? 0)}</span></p>
              ))}
              <p className="text-xs text-[var(--loc-strong)] opacity-80 dark:text-[var(--loc-light)]">MwSt. gesamt</p>
              <p className="text-sm font-bold text-[var(--loc-strong)] dark:text-[var(--loc-light)]">{formatCurrency(totalTax)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--loc-strong)] opacity-80 dark:text-[var(--loc-light)]">Netto-Gesamtumsatz</p>
              <p className="text-sm font-bold text-[var(--loc-strong)] dark:text-[var(--loc-light)]">{formatCurrency(total + totalPfand - totalTax)}</p>
            </div>
          </div>
        </div>

        {/* Verkäufe: einklappbar (24.11.) */}
        <div className="mb-3">
          <button type="button" onClick={() => setSalesOpen((v) => !v)} disabled={txToday.length === 0} aria-expanded={salesOpen}
            className="flex min-h-10 items-center gap-1.5 rounded-lg px-1 text-sm text-gray-600 disabled:cursor-default dark:text-gray-400">
            <ReceiptIcon className="h-4 w-4" /> Verkäufe: <span className="font-bold">{count}</span>
            {txToday.length > 0 && <ChevronDown className={`h-4 w-4 transition-transform ${salesOpen ? 'rotate-180' : ''}`} />}
          </button>
          {salesOpen && txToday.length > 0 && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-700">
              {txToday.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between border-b border-gray-50 px-3 py-1.5 text-xs last:border-0 dark:border-gray-700/50">
                  <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                    <Clock className="h-3 w-3" />
                    {formatTime(tx.timestamp)}
                    <span className="rounded px-1.5 py-0.5 font-medium text-gray-400 dark:text-gray-500">{tx.items.length} Art.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${tx.paymentMethod === 'cash' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                      {tx.paymentMethod === 'cash' ? 'BAR' : 'KARTE'}
                    </span>
                    <span className="font-bold text-gray-900 dark:text-gray-100">{formatCurrency(tx.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Eine Zeile: Info links, PDF-Export und Drucken rechts (24.11.) */}
        <div className="flex items-center gap-2">
          <button onClick={onInfo}
            className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 active:scale-95">
            <Info className="h-4 w-4" /> Info
          </button>
          {/* 24.11.: Ausgewählte Kasse bedienen – öffnet nur die Kasse bzw. den bestehenden Eröffnungsablauf. */}
          {onOpenCash && (
            <button type="button" onClick={onOpenCash}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[var(--loc-strong)] px-4 text-sm font-bold text-white transition hover:brightness-110 active:scale-95">
              <MonitorDot className="h-4 w-4" /> {session && !session.closed ? 'Kasse weiterführen' : 'Kasse eröffnen'}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={onExport} disabled={txToday.length === 0}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
              <FileDown className="h-3.5 w-3.5" /> PDF-Export
            </button>
            <button onClick={onPrint} disabled={txToday.length === 0}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40">
              <Printer className="h-3.5 w-3.5" /> Drucken
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Day Info Dialog ----

function DayInfoDialog({ location, date, categories, transactions, parts, onClose }: {
  location: Location;
  date: string;
  categories: Category[];
  transactions: Transaction[];
  parts: DaySessionPart[];
  onClose: () => void;
}) {
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const taxByRateMap = mergeTaxByRate(transactions);
  const rateKeys = sortedRateKeys(taxByRateMap);
  const total = transactions.reduce((s, t) => s + t.subtotal, 0);
  const totalNet = transactions.reduce((s, t) => s + transactionNet(t), 0);
  const totalTax = [...taxByRateMap.values()].reduce((s, v) => s + v, 0);
  const totalPfand = transactions.reduce((s, t) => s + t.totalPfand, 0);
  const cashCount = transactions.filter((t) => t.paymentMethod === 'cash').length;
  const cardCount = transactions.filter((t) => t.paymentMethod === 'card').length;
  const cashTotal = transactions.filter((t) => t.paymentMethod === 'cash').reduce((s, t) => s + t.total, 0);
  const cardTotal = transactions.filter((t) => t.paymentMethod === 'card').reduce((s, t) => s + t.total, 0);

  // Aggregate by product
  const productAgg = useMemo(() => {
    const map = new Map<string, { name: string; categoryId: string; qty: number; gross: number; net: number; tax: number; pfand: number; taxRate: number }>();
    for (const tx of transactions) {
      for (const item of tx.items) {
        if (item.isPfandRetoure) continue;
        const existing = map.get(item.productId) ?? { name: item.name, categoryId: item.categoryId, qty: 0, gross: 0, net: 0, tax: 0, pfand: 0, taxRate: item.taxRate };
        existing.qty += item.quantity;
        existing.gross += item.price * item.quantity;
        // netPrice/taxAmount sind Zeilensummen (Preis × Menge), nicht Stückwerte.
        existing.net += item.netPrice;
        existing.tax += item.taxAmount;
        existing.pfand += item.pfand;
        map.set(item.productId, existing);
      }
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.gross - a.gross);
  }, [transactions]);

  // Aggregate by category
  const categoryAgg = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; gross: number; net: number; tax: number; pfand: number }>();
    for (const p of productAgg) {
      const cat = categories.find((c) => c.id === p.categoryId);
      const name = cat?.name ?? 'Ohne Gruppe';
      const existing = map.get(p.categoryId) ?? { name, qty: 0, gross: 0, net: 0, tax: 0, pfand: 0 };
      existing.qty += p.qty;
      existing.gross += p.gross;
      existing.net += p.net;
      existing.tax += p.tax;
      existing.pfand += p.pfand;
      map.set(p.categoryId, existing);
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.gross - a.gross);
  }, [productAgg, categories]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
              <Info className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{location} · Tagesinfo</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">{dateLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {transactions.length === 0 && parts.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">Für diesen Tag liegen keine Daten vor.</p>
          ) : (
            <>
              {/* Summary tiles */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-green-50 px-3 py-2.5 dark:bg-green-900/20">
                  <p className="text-xs text-green-700/70 dark:text-green-400/70">Umsatz (ohne Pfand)</p>
                  <p className="text-base font-bold text-green-700 dark:text-green-400">{formatCurrency(total)}</p>
                </div>
                <div className="rounded-xl bg-blue-50 px-3 py-2.5 dark:bg-blue-900/20">
                  <p className="text-xs text-blue-700/70 dark:text-blue-400/70">Netto inkl. Pfand</p>
                  <p className="text-base font-bold text-blue-700 dark:text-blue-300">{formatCurrency(totalNet)}</p>
                </div>
                <div className="rounded-xl bg-rose-50 px-3 py-2.5 dark:bg-rose-900/20">
                  <p className="text-xs text-rose-700/70 dark:text-rose-400/70">MwSt inkl. Pfand</p>
                  <p className="text-base font-bold text-rose-700 dark:text-rose-300">{formatCurrency(totalTax)}</p>
                </div>
                <div className="rounded-xl bg-green-50 px-3 py-2.5 dark:bg-green-900/20">
                  <p className="text-xs text-green-700/70 dark:text-green-400/70">Pfand-Saldo</p>
                  <p className="text-base font-bold text-green-700 dark:text-green-300">{formatCurrency(totalPfand)}</p>
                </div>
              </div>

              {/* Gesamt kassiert = Umsatz + Pfand-Saldo = Bar + Karte (zur schnellen Kontrolle) */}
              <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-green-500/60 bg-green-50 px-3 py-2.5 dark:bg-green-900/20">
                <div>
                  <p className="text-sm font-bold text-green-800 dark:text-green-300">Gesamt kassiert (inkl. Pfand)</p>
                  <p className="text-xs text-green-700/70 dark:text-green-400/70">Umsatz {formatCurrency(total)} + Pfand {formatCurrency(totalPfand)} = Bar + Karte</p>
                </div>
                <p className="text-lg font-extrabold text-green-700 dark:text-green-300">{formatCurrency(cashTotal + cardTotal)}</p>
              </div>

              {/* Payment breakdown */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-700">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300"><Euro className="h-4 w-4 text-green-600" /> Bar</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{cashCount} {cashCount === 1 ? 'Barzahlung' : 'Barzahlungen'} · {formatCurrency(cashTotal)}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-700">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300"><ReceiptIcon className="h-4 w-4 text-blue-600" /> Karte</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{cardCount} {cardCount === 1 ? 'Kartenzahlung' : 'Kartenzahlungen'} · {formatCurrency(cardTotal)}</span>
                </div>
              </div>

              {/* Tax breakdown */}
              {rateKeys.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">MwSt-Aufschlüsselung</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {rateKeys.map((rate) => (
                      <div key={rate} className="rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">MwSt {rate}%</span>
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatCurrency(taxByRateMap.get(rate) ?? 0)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 24.11.: Kassensitzungen einklappbar, damit das Fenster kleiner bleibt. */}
              {parts.length > 0 && (
                <details className="group">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 [&::-webkit-details-marker]:hidden"><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> Kassensitzungen ({parts.length})</summary>
                  <div className="space-y-3">
              {parts.length > 1 && (
                <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800 dark:bg-blue-900/20 dark:text-blue-200">{parts.length} Kassensitzungen an diesem Tag. Umsatz und Warengruppen sind zusammengerechnet, Bestände stehen je Sitzung.</p>
              )}

              {/* Cash session info (je Sitzung) */}
              {parts.map(({ session, transactions: sessionTx, cashBalance }, index) => (
                <div key={session.id} className="space-y-3">
                  <div className="rounded-2xl border border-gray-200 p-3 dark:border-gray-700">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {parts.length > 1 ? `Kassensitzung ${index + 1} von ${parts.length}` : 'Kassensitzung'}
                      {session.dailyCloseReceiptNumber ? ` · ${formatDailyCloseReceiptNumber(session.dailyCloseReceiptNumber, session.dailyCloseReceiptLocation ?? session.location, session.dailyCloseFinalizedAt ?? session.closedAt ?? session.openedAt, session.dailyCloseReceiptYear) ?? session.dailyCloseReceiptNumber}` : ''}
                      {` · geöffnet ${formatTime(session.openedAt)}`}
                      {parts.length > 1 ? ` · ${sessionTx.length} Verkäufe` : ''}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                      {session.corrections.length > 0 && (() => {
                        const view = openingCorrectionView(session);
                        return view ? (
                          <>
                            <div><p className="text-xs text-gray-400">Übernommen vom Vortag</p><p className="font-bold text-gray-900 dark:text-gray-100">{formatCurrency(view.carriedBalance)}</p></div>
                            <div><p className="text-xs text-gray-400">Korrektur Anfangsbestand</p><p className={`font-bold ${view.total < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>{signedAmountLabel(view.total, formatCurrency)}</p></div>
                          </>
                        ) : null;
                      })()}
                      <div><p className="text-xs text-gray-400">{session.corrections.length ? 'Anfangsbestand (Ist)' : 'Anfangsbestand'}</p><p className="font-bold text-gray-900 dark:text-gray-100">{formatCurrency(session.openingBalance)}</p></div>
                      <div><p className="text-xs text-gray-400">Einzahlungen</p><p className="font-bold text-gray-900 dark:text-gray-100">{formatCurrency(session.entries.filter((e) => e.type === 'deposit').reduce((s, e) => s + e.amount, 0))}</p></div>
                      <div><p className="text-xs text-gray-400">Entnahmen</p><p className="font-bold text-gray-900 dark:text-gray-100">{formatCurrency(session.entries.filter((e) => e.type === 'withdrawal').reduce((s, e) => s + e.amount, 0))}</p></div>
                      {session.closed ? (
                        <>
                          <div><p className="text-xs text-gray-400">Endbestand</p><p className="font-bold text-gray-900 dark:text-gray-100">{formatCurrency(session.closingBalance ?? 0)}</p></div>
                          <div><p className="text-xs text-gray-400">Erwartet</p><p className="font-bold text-gray-900 dark:text-gray-100">{formatCurrency(session.expectedBalance ?? 0)}</p></div>
                          <div className="col-span-2"><p className="text-xs text-gray-400">Differenz</p><p className={`font-bold ${(session.difference ?? 0) === 0 ? 'text-green-600' : (session.difference ?? 0) > 0 ? 'text-amber-600' : 'text-red-600'}`}>{formatCurrency(session.difference ?? 0)}</p></div>
                        </>
                      ) : (
                        <div><p className="text-xs text-gray-400">Bestand</p><p className="font-bold text-gray-900 dark:text-gray-100">{formatCurrency(cashBalance)}</p></div>
                      )}
                    </div>
                  </div>

                  {session.corrections.length > 0 && (
                    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/10">
                      <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">Anfangsbestandskorrekturen</h3>
                      <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">Bereits im angezeigten Anfangsbestand enthalten; wird nicht erneut abgezogen oder addiert.</p>
                      <div className="mt-2 space-y-2">
                        {[...session.corrections].sort((a, b) => a.timestamp - b.timestamp).map((correction) => {
                          const difference = Math.round((correction.newAmount - correction.oldAmount) * 100) / 100;
                          return <div key={correction.id} className="rounded-xl border border-amber-200 bg-white p-3 text-sm dark:border-amber-800 dark:bg-gray-900/40">
                            <p className="font-bold text-gray-900 dark:text-gray-100">{formatCurrency(correction.oldAmount)} → {formatCurrency(correction.newAmount)} <span className={difference < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}>({difference > 0 ? '+' : ''}{formatCurrency(difference)})</span></p>
                            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{new Date(correction.timestamp).toLocaleDateString('de-DE')} · {formatTime(correction.timestamp)} · Mitarbeiter: {correction.employeeName ?? 'Nicht hinterlegt'}</p>
                            <p className="mt-1 text-gray-700 dark:text-gray-200">Grund: {correction.reason || 'Nicht hinterlegt'}</p>
                          </div>;
                        })}
                      </div>
                    </section>
                  )}
                </div>
              ))}
                  </div>
                </details>
              )}

              {/* Category breakdown */}
              {categoryAgg.length > 0 && (
                <details className="group">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 [&::-webkit-details-marker]:hidden"><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> Warengruppen</summary>
                  <div className="overflow-hidden rounded-xl border border-gray-100 dark:border-gray-700">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400 dark:bg-gray-900/40">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Gruppe</th>
                          <th className="px-3 py-2 text-right font-semibold">Anzahl</th>
                          <th className="px-3 py-2 text-right font-semibold">Brutto</th>
                          <th className="px-3 py-2 text-right font-semibold">Netto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categoryAgg.map((c) => (
                          <tr key={c.id} className="border-t border-gray-50 dark:border-gray-700/50">
                            <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{c.name}</td>
                            <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{c.qty}</td>
                            <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-gray-100">{formatCurrency(c.gross)}</td>
                            <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(c.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {/* Product breakdown */}
              {productAgg.length > 0 && (
                <details className="group">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 [&::-webkit-details-marker]:hidden"><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> Artikel-Detail</summary>
                  <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wide text-gray-400 dark:bg-gray-900/40">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Artikel</th>
                          <th className="px-3 py-2 text-right font-semibold">Anz.</th>
                          <th className="px-3 py-2 text-right font-semibold">Brutto</th>
                          <th className="px-3 py-2 text-right font-semibold">MwSt</th>
                          <th className="px-3 py-2 text-right font-semibold">Pfand</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productAgg.map((p) => (
                          <tr key={p.id} className="border-t border-gray-50 dark:border-gray-700/50">
                            <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{p.name}</td>
                            <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{p.qty}</td>
                            <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-gray-100">{formatCurrency(p.gross)}</td>
                            <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{formatCurrency(p.tax)}</td>
                            <td className="px-3 py-2 text-right text-green-600 dark:text-green-400">{formatCurrency(p.pfand)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {/* Transactions list */}
              {transactions.length > 0 && (
                <details className="group">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 [&::-webkit-details-marker]:hidden"><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> Verkäufe ({transactions.length})</summary>
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-700">
                    {[...transactions].sort((a, b) => a.timestamp - b.timestamp).map((tx) => (
                      <SaleRow key={tx.id} tx={tx} />
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Verkaufszeile mit aufklappbaren Bon-Details (25.11.): zeigt, wie sich der Betrag zusammensetzt.
function SaleRow({ tx }: { tx: Transaction }) {
  const [open, setOpen] = useState(false);
  const goods = tx.items.filter((i) => !i.isPfandRetoure);
  const retoures = tx.items.filter((i) => i.isPfandRetoure);
  const retoureQty = retoures.reduce((sum, i) => sum + i.quantity, 0);
  const goodsQty = goods.reduce((sum, i) => sum + i.quantity, 0);
  const goodsSum = goods.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const pfandOut = goods.reduce((sum, i) => sum + (i.pfand || 0), 0);
  const pfandBack = retoures.reduce((sum, i) => sum + Math.abs(i.pfand || 0), 0);
  const money = (v: number) => formatCurrency(Math.round(v * 100) / 100);
  return (
    <div className="border-b border-gray-50 text-xs last:border-0 dark:border-gray-700/50">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-9 w-full items-center justify-between gap-2 px-3 py-1.5 text-left">
        <div className="flex min-w-0 items-center gap-2 text-gray-500 dark:text-gray-400">
          <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          <span className="shrink-0">{formatTime(tx.timestamp)}</span>
          <span className="truncate rounded px-1.5 py-0.5 font-medium text-gray-400 dark:text-gray-500">{tx.items.length} Art.</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${tx.paymentMethod === 'cash' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
            {tx.paymentMethod === 'cash' ? 'BAR' : 'KARTE'}
          </span>
          <span className="font-bold text-gray-900 dark:text-gray-100">{formatCurrency(tx.total)}</span>
        </div>
      </button>
      {open && (
        <div className="mx-3 mb-2 space-y-0.5 rounded-lg bg-gray-50 px-3 py-2 text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          {goods.map((i, idx) => (
            <div key={`g-${idx}`} className="flex justify-between"><span>{i.quantity} × {i.name}</span><span>{money(i.price * i.quantity)}</span></div>
          ))}
          {pfandOut > 0 && (
            <div className="flex justify-between"><span>Pfand für {goodsQty > 0 ? `${goods.filter((i) => (i.pfand || 0) > 0).reduce((n, i) => n + i.quantity, 0)} Becher` : 'Becher'}</span><span>+ {money(pfandOut)}</span></div>
          )}
          {pfandBack > 0 && (
            <div className="flex justify-between text-green-700 dark:text-green-400"><span>Pfand-Retoure {retoureQty} ×</span><span>− {money(pfandBack)}</span></div>
          )}
          <div className="flex justify-between border-t border-gray-200 pt-1 font-bold text-gray-900 dark:border-gray-700 dark:text-gray-100">
            <span>{tx.total < 0 ? 'Auszahlung' : 'Summe'} · {tx.paymentMethod === 'cash' ? 'bar' : 'Karte'}</span><span>{formatCurrency(tx.total)}</span>
          </div>
          {Math.abs(goodsSum + pfandOut - pfandBack - tx.total) > 0.01 && (
            <div className="text-[10px] text-amber-600 dark:text-amber-400">Hinweis: Teilbetrag einer geteilten Zahlung, Rest steht in einer eigenen Zeile.</div>
          )}
          <div className="pt-1 text-[10px] text-gray-400 dark:text-gray-500">{tx.employeeName ? `${tx.employeeName} · ` : ''}Bon {tx.id.slice(-6)}</div>
        </div>
      )}
    </div>
  );
}

// ---- Reset / Backup / Import dialogs ----

function ResetConfirmDialog({ onExport, onCheck, onCancel, onConfirm, transactionCount, stornoCount, sessionCount, openSessionCount, openLocations, onCloseOpenCash, loggedInStaff, onLogoutStaff, testMode }: {
  loggedInStaff: { sessionId: string; location: string; staffId: string; staffName: string }[];
  onLogoutStaff?: (sessionId: string, staffId: string, staffName: string) => void;
  openLocations: string[];
  onCloseOpenCash?: (location: string) => void;
  onExport?: () => void | Promise<void | { mode: 'folder' | 'downloads'; savedAs: string }>;
  onCheck?: (progress: (result: ResetSafetyResult) => void) => Promise<ResetSafetyResult>;
  onCancel: () => void;
  onConfirm: (adminPassword: string) => Promise<void>;
  transactionCount: number;
  stornoCount: number;
  sessionCount: number;
  openSessionCount: number;
  testMode: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(!testMode);
  const [report, setReport] = useState<ResetSafetyResult | null>(null);
  const [savedBackup, setSavedBackup] = useState(false);
  const [backupRequested, setBackupRequested] = useState(false);
  const [exportedSignature, setExportedSignature] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const checkRef = useRef(onCheck);
  checkRef.current = onCheck;
  const autoBackupTried = useRef(false);

  // First opening performs a real scan; the dialog must be reopened to scan again.
  useEffect(() => {
    if (!testMode) {
            void checkRef.current?.(setReport)
        .then(result => { if (result) setReport(result); })
        .catch(cause => setError('Prüfung fehlgeschlagen: ' +
          (cause instanceof Error ? cause.message : String(cause))))
        .finally(() => setChecking(false));
    }
  }, [testMode]);

  const completed = !!report && report.completed === report.total;
  const canBackup = testMode || (completed && report.backupAllowed);
  const canReset = testMode || (completed && report.resetAllowed && savedBackup && backupRequested &&
    !!exportedSignature && report.backupSignature === exportedSignature);

  async function saveBackup() {
    if (!canBackup || !onExport || busy) return;
    setBusy(true);
    setError(null);
    try {
      const exported = await onExport();
      setNotice(null);
      // An open cash register does not block the backup itself (22.11.2026):
      // the file is complete. Only the reset needs every register closed, so
      // there is no reset proof for this backup.
      if (!testMode && report && !report.resetAllowed) {
        setBackupRequested(false);
        setSavedBackup(false);
        setExportedSignature(null);
        setNotice('Backup gespeichert. Zurücksetzen ist erst möglich, wenn alle Kassen abgeschlossen sind. Danach hier ein neues Backup erstellen.');
        return;
      }
      // Compare the ledger after export to the safety-checked source. Any
      // intervening cloud change invalidates this backup proof.
      if (!testMode) {
        if (!onCheck || !report?.backupSignature) throw new Error('Cloud-Sicherheitsnachweis fehlt. Dialog erneut öffnen.');
        const verified = await onCheck(setReport);
        setReport(verified);
        if (!verified.resetAllowed || verified.backupSignature !== report.backupSignature) {
          throw new Error('Seit der Vorprüfung hat sich die Cloud geändert. Neues Backup erstellen.');
        }
        setExportedSignature(verified.backupSignature ?? null);
      }
      // A download request is NOT proof that the file was saved. The user
      // must expressly tick the confirmation once the file is on disk.
      setBackupRequested(true);
      // Im Ordner-Modus ist das Schreiben der Datei selbst der Nachweis (Dateiname
      // wurde vom Ordner bestätigt). Nur beim normalen Download bleibt der Haken manuell.
      if (exported && exported.mode === 'folder') {
        setSavedBackup(true);
        setNotice('Backup gespeichert: ' + exported.savedAs);
      } else {
        setSavedBackup(false);
      }
    } catch (cause) {
            setBackupRequested(false);
      setSavedBackup(false);
      setExportedSignature(null);
      setError('Backup konnte nicht erstellt werden: ' +
        (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setBusy(false);
    }
  }

  // Automatisch sichern, sobald die Prüfung bestanden ist. Es wird immer eine
  // frische Sicherung erstellt (nie eine alte Datei wiederverwendet): sie ist
  // dadurch sicher zum aktuellen Cloud-Stand passend. Schlägt es fehl (z. B.
  // Ordnerzugriff nur per Tippen), bleibt der Button zum manuellen Sichern.
  useEffect(() => {
    if (testMode || autoBackupTried.current || !completed || !canBackup || !report?.resetAllowed || !onExport || busy) return;
    autoBackupTried.current = true;
    void saveBackup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed, canBackup, report?.resetAllowed]);

  async function confirm() {
    if (!confirmed || busy || checking || !canReset || (!testMode && !adminPassword.trim())) return;
    setBusy(true);
    setError(null);
    try {
      // Recheck just before the irreversible RPC. The server performs its
      // own final lock-and-open-till test even if another device changed state.
      if (!testMode && onCheck) {
        const latest = await onCheck(setReport);
        setReport(latest);
                if (!latest.resetAllowed || !latest.backupSignature || latest.backupSignature !== exportedSignature) {
          setSavedBackup(false);
          setBackupRequested(false);
          setExportedSignature(null);
          throw new Error('Datenstand seit dem Backup geändert oder Prüfung fehlgeschlagen. Bitte neues Backup erstellen.');
        }
      }
      await onConfirm(adminPassword);
    } catch (cause) {
            const asCloudError = cause as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown } | null;
      const detail = cause instanceof Error ? cause.message
        : (typeof asCloudError?.message === 'string' && asCloudError.message) ||
          (typeof asCloudError?.details === 'string' && asCloudError.details) ||
          (typeof cause === 'string' ? cause : 'Cloud-Fehler ohne Klartextmeldung. Fehlercode: ' + String(asCloudError?.code ?? 'unbekannt'));
      // Only a genuine rejection counts as a wrong password; "nicht prüfbar" or
      // "erforderlich" (service unavailable, empty input) must stay visible.
      setError(/passwort nicht korrekt|passwort ist nicht korrekt/i.test(detail)
        ? 'Falsches Passwort. Es wurde nichts zurückgesetzt.'
        : 'Zurücksetzen nicht bestätigt. Cloud-Kassenstand vor einem neuen Versuch prüfen. ' + detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-3 sm:p-4"
      onClick={busy || checking ? undefined : onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="booking-reset-heading"
        className="max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-800"
        onClick={event => event.stopPropagation()}>
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
            <RotateCcw className="h-6 w-6" />
          </div>
          <div>
            <h3 id="booking-reset-heading" className="text-lg font-bold text-gray-900 dark:text-gray-100">Tagesbuchungen zurücksetzen?</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {testMode ? 'Nur lokale Testdaten' : 'Historie bleibt archiviert – aktive Kasse wird leer'}
            </p>
          </div>
        </div>
        <p className="mb-3 text-sm text-gray-700 dark:text-gray-200">
          <strong>Achtung:</strong> {transactionCount} Buchungen, {stornoCount} Stornos und
          {' '}{sessionCount} Kassensitzungen verschwinden aus der aktiven Ansicht.
          Artikel, Mitarbeiter und Belegzähler bleiben erhalten.
        </p>

        {!testMode && (
          <section className="mb-3 rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" aria-label="Reset-Sicherheitsprüfung">
            <div className="flex items-center justify-between gap-2">
              <strong>Sicherheitsprüfung</strong>
              <span className="font-bold tabular-nums">Prüfung zu {report?.percent ?? 0} % gelaufen</span>
            </div>
            <progress aria-label="Fortschritt der Sicherheitsprüfung"
              className="mt-2 h-2 w-full accent-amber-500" max={100} value={report?.percent ?? 0} />
            <ul className="mt-2 space-y-2">
              {report?.checks.map(item => (
                <li key={item.id} className="flex items-start gap-2">
                  {item.ok
                    ? <CheckCircle2 aria-label="Bestanden" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    : <X aria-label="Blockiert" className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />}
                  <span><span className="font-semibold">{item.label}</span>
                    <span className="block text-xs">{item.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            {checking && <p role="status" className="mt-2">Prüfung läuft …</p>}
            {completed && (
              <p role="status" className="mt-3 font-semibold">
                {report.resetAllowed
                  ? 'Alle technischen Reset-Prüfungen bestanden.'
                  : 'Prüfung abgeschlossen: Rote Punkte zuerst beheben, danach den Dialog schließen und neu öffnen.'}
              </p>
            )}
            <p className="mt-2 text-xs">Der Balken zeigt, wie weit die Prüfung gelaufen ist – nicht, ob alles bestanden ist. Entscheidend sind die grünen Haken.</p>
            <p className="mt-1 text-xs font-semibold">Wichtig: Dieses Gerät sieht nur, was schon in der Cloud ist. Bitte vorher an jedem anderen Kassen-Tablet einmal „Sync Cloud“ tippen, damit dort keine Buchungen mehr offline warten.</p>
          </section>
        )}

        {testMode && openSessionCount > 0 && (
          <p className="mb-3 text-xs text-amber-700">Im Testmodus werden nur lokale Testdaten entfernt.</p>
        )}
        {!testMode && loggedInStaff.length > 0 && onLogoutStaff && (
          <div className="mb-3 rounded-xl border border-gray-300 p-3 text-sm text-gray-800 dark:border-gray-600 dark:text-gray-100">
            <p className="mb-2 font-semibold">Angemeldete Mitarbeiter</p>
            <div className="flex flex-col gap-2">
              {loggedInStaff.map(entry => (
                <button key={entry.sessionId + entry.staffId} type="button" disabled={busy}
                  onClick={() => onLogoutStaff(entry.sessionId, entry.staffId, entry.staffName)}
                  className="flex min-h-11 items-center justify-between rounded-xl border border-gray-300 px-4 py-2 text-left font-semibold disabled:opacity-50 dark:border-gray-600">
                  <span>{entry.staffName} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">· {entry.location}</span></span>
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Abmelden</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {!testMode && completed && report?.resetAllowed === false && openLocations.length > 0 && onCloseOpenCash && (
          <div className="mb-3 rounded-xl border border-blue-400/60 p-3 text-sm text-gray-800 dark:text-gray-100">
            <p className="mb-2 font-semibold">Offene Kassen zuerst abschließen:</p>
            <div className="flex flex-col gap-2">
              {openLocations.map(location => (
                <button key={location} type="button" disabled={busy}
                  onClick={() => onCloseOpenCash(location)}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  Kasse {location} jetzt abschließen
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">Nach dem Abschluss: Verwaltung → Buchungen zurücksetzen. Das Backup startet dann automatisch.</p>
          </div>
        )}
        {error && <p role="alert" className="mb-3 rounded-xl border border-red-300 p-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
        {notice && <p role="status" className="mb-3 rounded-xl border border-emerald-400/60 p-2 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
        <div className="flex flex-col gap-2">
          {onExport && <button type="button" disabled={busy || checking || !canBackup}
            onClick={() => void saveBackup()}
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            <Download className="h-4 w-4" /> Backup als JSON sichern
          </button>}
          {!testMode && <>
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={savedBackup} onChange={e => setSavedBackup(e.target.checked)}
                disabled={!canBackup || !backupRequested || busy || checking} />
                            Backup-Datei heruntergeladen und sicher aufbewahrt.
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">Dieser Haken wird erst nach einem erfolgreichen Export mit bestätigtem Cloud-Datenstand freigegeben. Ändern sich Buchungen, muss neu gesichert werden.</p>
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">
              Administrator- oder Verwaltungspasswort
              <input type="password" autoComplete="off" value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void confirm(); } }}
                disabled={!canReset || busy || checking}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                placeholder="Passwort eingeben" />
            </label>
          </>}
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
              disabled={!canReset || busy || checking} />
            Ich bestätige das unwiderrufliche Zurücksetzen der aktiven Kasse.
          </label>
          <button type="button" onClick={() => void confirm()}
            disabled={busy || checking || !canReset || !confirmed || (!testMode && !adminPassword.trim())}
            className="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            <RotateCcw className="h-4 w-4" /> {busy ? 'Wird erneut geprüft …' : 'Jetzt zurücksetzen'}
          </button>
          <button type="button" onClick={onCancel} disabled={busy || checking}
            className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:border-gray-600 dark:text-gray-200">
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportDialog({ onImport, onCancel }: { onImport: (file: File) => void; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // While the dialog is open, Firefox must not navigate to a dropped backup file.
  useEffect(() => {
    const preventBrowserDrop = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', preventBrowserDrop);
    window.addEventListener('drop', preventBrowserDrop);
    return () => {
      window.removeEventListener('dragover', preventBrowserDrop);
      window.removeEventListener('drop', preventBrowserDrop);
    };
  }, []);

  const selectFile = (candidate?: File) => {
    if (!candidate) return;
    const isJson = candidate.name.toLowerCase().endsWith('.json') || candidate.type === 'application/json';
    if (!isJson) {
      setFile(null);
      setFileError('Bitte eine Backup-Datei im JSON-Format auswählen.');
      return;
    }
    setFile(candidate);
    setFileError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            <FileUp className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Backup importieren</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Frühere Daten wiederherstellen</p>
          </div>
        </div>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
          Wählen oder ziehen Sie eine WOODMO-Backup-Datei (JSON) hierher. Bei vollständig leerer Buchungsgeneration ist auch eine ältere Sicherung vollständig rückspielbar, wenn der Sicherheitscheck besteht. Bei bereits vorhandenen Buchungen erfolgt nur eine konfliktgeprüfte Zusammenführung mit ausdrücklicher Zustimmung; ältere, archivierte Belege werden nicht in eine belegte Kasse gemischt. Für vollständigen Ersatz bitte zuerst neu sichern und die Kassenbuchungen gesondert zurücksetzen.
        </p>
        <div
          onClick={() => inputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            selectFile(e.dataTransfer.files?.[0]);
          }}
          className={`mb-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition ${
            isDragging
              ? 'border-blue-500 bg-blue-100 dark:bg-blue-900/40'
              : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50 dark:border-gray-600 dark:bg-gray-900/40 dark:hover:border-blue-500 dark:hover:bg-blue-900/20'
          }`}
        >
          <FileUp className="h-8 w-8 text-gray-400" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
            {file ? file.name : 'Backup-Datei auswählen (.json)'}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => selectFile(e.target.files?.[0])}
          />
        </div>
        {fileError && <p className="-mt-2 mb-4 text-xs font-medium text-red-600 dark:text-red-400">{fileError}</p>}
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
            Abbrechen
          </button>
          <button
            onClick={() => file && onImport(file)}
            disabled={!file}
            className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 active:scale-95 disabled:opacity-40"
          >
            <ShieldCheck className="mr-1.5 inline h-4 w-4" /> Importieren
          </button>
        </div>
      </div>
    </div>
  );
}
