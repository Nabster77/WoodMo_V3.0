import { activeSessionForLocation } from '@/lib/cashSessionSelection';
import { canDiscardCashSession, openingBalanceForLocation, openingBalanceCarryForLocation } from '@/lib/cashBalanceCarry';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useStore } from '@/hooks/useStore';
import { isReachable, useCloudSync } from '@/hooks/useCloudSync';
import { useCatalogSync } from '@/hooks/useCatalogSync';
import { useStornoLedger } from '@/hooks/useStornoLedger';
import { prepareStorno, prepareFinalCloseStornoSnapshot } from '@/lib/stornoRules';
import { submitStornoOnline } from '@/lib/stornoCloud';
import { loadCloudStornos } from '@/lib/stornoCloud';
import { verifyStaffPassword } from '@/lib/staffDirectory';
import type { CashSession, Transaction } from '@/types';
import { useAuthUser } from '@/hooks/useAuthUser';
import { useStaffDirectory } from '@/hooks/useStaffDirectory';
import { StaffLoginDialog } from '@/components/StaffLoginDialog';
import { DeviceSetupDialog } from '@/components/DeviceSetupDialog';
import { InitialSyncDialog, type UpdatePhase } from '@/components/InitialSyncDialog';
import { readDeviceSetup, setInitialSetupPending } from '@/lib/deviceSetup';
import { APP_VERSION, activatePublishedUpdate, activationVerified, approvedActivation, preflightPublishedUpdate, preparePublishedUpdate, publishedUpdate, type PublishedUpdate } from '@/lib/appVersion';
import { checkStartupData, startupCashDigest } from '@/lib/startupDataCheck';
import { PDF_ARCHIVE_SETUP_EVENT } from '@/lib/pdfArchiveSetup';
import { CloudPasswordPanel } from '@/components/Admin/CloudPasswordPanel';
import { ManagerPasswordPanel } from '@/components/Admin/ManagerPasswordPanel';
import { changeManagerPassword, loadManagerCredential, restoreManagerCredential, type ManagerCredential } from '@/lib/managerAuth';
import { supabase } from '@/lib/supabaseClient';
import { fetchCatalogRows } from '@/lib/catalogCloud';
import { fetchCloudData } from '@/lib/cloudPull';
import { fetchLatestBookingReset } from '@/lib/bookingReset';
import { checkRegistersClosedInCloud, type RegisterStatus } from '@/lib/registerStatus';
import { pfandCloudMatches } from '@/lib/pfandValidation';
import type { PfandSettings } from '@/types';
import type { Location, StaffUser } from '@/types';
import { POSScreen } from '@/components/POS/POSScreen';
import { WoodmoHome } from '@/components/WoodmoHome';
import { WoodmoBrand } from '@/components/WoodmoBrand';
import { AdminScreen } from '@/components/Admin/AdminScreen';
import { JournalScreen, resetJournalSelection } from '@/components/Journal/JournalScreen';
import { PasswordGate } from '@/components/PasswordGate';
import { InstallPrompt } from '@/components/InstallPrompt';
import { SyncToast } from '@/components/SyncToast';
import { SyncDialog } from '@/components/SyncDialog';
import { knownBookingReset, rememberBookingReset, resetCloudBookings } from '@/lib/bookingReset';
import { backUpPendingOutbox, enqueueEntries, discardEntriesBeforeGeneration, readPendingOutbox, removeQueuedUnusedCashSession, readResetQuarantineSummary, exportResetQuarantine, clearResetQuarantine, RESET_QUARANTINE_EVENT } from '@/lib/outbox';
import { sessionTransactions } from '@/lib/sessionTransactions';
import { archiveFolderStatus, prepareBackupTarget, requestArchiveAccess, saveBackupFile, saveJournalPdfFromTap, saveJournalPdfIfAllowed } from '@/lib/journalPdfFile';
import type { JournalReportData } from '@/lib/journalPdf';
import { closedSessionReport } from '@/lib/dailyReport';
import { formatDailyCloseReceiptNumber, issueDailyCloseReceipt } from '@/lib/dailyCloseReceipt';
import { buildFinalizedCashSession } from '@/lib/finalizedCashSession';
import { persistFinalizedCashSession } from '@/lib/finalizedCashCloud';
import { isTestMode, setTestMode, clearBookings, loadJSON, saveJSON, STORAGE_KEYS } from '@/lib/storage';
import { formatDateISO } from '@/lib/format';
import { headerDateLong, headerDateShort, headerTime } from '@/lib/headerDate';
import { CLOSE_ARCHIVE_BACKUP_VERSION, exportRecoveryMetadata, restoreBackupSafely, validateBackupCloseArchive, type CompleteBackup } from '@/lib/backupRecovery';
import { requireValidBackupIntegrity } from '@/lib/backupIntegrity';
import { restoreToCleanGeneration } from '@/lib/restoreToCleanGeneration';
import { runResetSafetyChecks, type ResetSafetyResult } from '@/lib/resetSafetyChecklist';
import { installKeyboardOnTap } from '@/lib/keyboardOnTap';
import { installStyledAlert } from '@/lib/styledAlert';
import { PhonePairDialog } from '@/components/POS/PhonePairDialog';
import { callMobileAsTablet } from '@/lib/mobileApi';
import { installFullscreenToggle } from '@/lib/fullscreenToggle';
import { serveFileTransfers } from '@/lib/fileTransfer';
import { DIAG_EVENT, diagnosticsTick, getDeviceId, getDiagMode, installDiagErrorCapture, type DiagCommand, type DiagContext, type DiagHandlers } from '@/lib/diagnostics';
import {
  ShoppingCart, Settings, Receipt, Sun, Moon,
  ArrowDownCircle, ArrowUpCircle,
  FlaskConical, CheckCircle2, AlertTriangle, RefreshCw, Cloud, LayoutGrid, X, Home, LogOut, LogIn, LockKeyhole, MapPin, UserRound,
  Smartphone,
} from 'lucide-react';

type Tab = 'pos' | 'admin' | 'journal';
const STARTUP_OFFLINE_MESSAGE = 'Bitte stellen Sie eine Internetverbindung her';
type HeaderAction = 'deposit' | 'withdrawal' | 'pfand' | 'correction' | 'close' | null;
type OpeningManagementAccess =
  | { kind: 'manager-only' }
  | { kind: 'selected-administrator'; administrator: StaffUser }
  | { kind: 'employee-denied' }
  | null;

export default function App({ adminStartup = false }: { adminStartup?: boolean }) {
  const { theme, toggle } = useTheme();
  const store = useStore();
  const [tab, setTab] = useState<Tab>('pos');
  // A cash register remains mounted when navigating Home/Admin/Journal: the
  // active unsaved cart must not disappear merely because its view is hidden.
  const [homeVisible, setHomeVisible] = useState(true);
  const [headerNow, setHeaderNow] = useState(() => Date.now());
  // Visible shop date and clock (device time, also offline) update even when a cash session stays open for weeks.
  useEffect(() => {
    const update = () => setHeaderNow(Date.now());
    const interval = window.setInterval(update, 10_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const [posVisited, setPosVisited] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminShotDirty, setAdminShotDirty] = useState(false);
  const [adminSection, setAdminSection] = useState('Kassen-Übersicht');
  const [deviceSetupOpen, setDeviceSetupOpen] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase | null>(null);
  const [candidate, setCandidate] = useState<PublishedUpdate | null>(null);
  const [autoInstallPending, setAutoInstallPending] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [syncPercent, setSyncPercent] = useState(0);
  const updateBusy = useRef(false);
  const syncedCashDigest = useRef<string | null>(null);
  const startupActive = updatePhase !== null && updatePhase !== 'offer' && updatePhase !== 'reload';
  const [pdfArchiveWarning, setPdfArchiveWarning] = useState<string | null>(null);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  // Jedes Betreten der Verwaltung (egal mit welcher Anmeldung) öffnet zuerst das Verwaltungsmenü.
  const adminOpenRef = useRef(false);
  useEffect(() => {
    const inAdmin = tab === 'admin' && adminUnlocked && !homeVisible;
    if (inAdmin && !adminOpenRef.current) setMenuOpen(true);
    adminOpenRef.current = inAdmin;
  }, [tab, adminUnlocked, homeVisible]);
  const [headerAction, setHeaderAction] = useState<HeaderAction>(null);
  const [cashierLoginRequest, setCashierLoginRequest] = useState(0);
  const [testMode] = useState<boolean>(isTestMode());
  const [modeConfirm, setModeConfirm] = useState<null | 'to-test' | 'to-active'>(null);
  const [resetArchive, setResetArchive] = useState<{
    pendingReceipts: number; pendingSessions: number; localSnapshots: number;
    localReceipts: number; archivedEntries: number;
  } | null>(null);
  // Keys of the quarantine records exported in THIS app session. Deleting is
  // only possible for exactly these records (see canClearResetQuarantine).
  const [exportedQuarantineKeys, setExportedQuarantineKeys] = useState<string[] | null>(null);
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      void readResetQuarantineSummary()
        .then(summary => { if (mounted) setResetArchive(summary); })
        .catch(error => console.error('Offline-Quarantäne konnte nicht gelesen werden.', error));
    };
    refresh();
    window.addEventListener(RESET_QUARANTINE_EVENT, refresh);
    return () => { mounted = false; window.removeEventListener(RESET_QUARANTINE_EVENT, refresh); };
  }, []);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const closeSyncToast = useCallback(() => setSyncedAt(null), []);
  const [syncOpen, setSyncOpen] = useState(false);
  const [currentStaff, setCurrentStaff] = useState<StaffUser | null>(null);
  // 27.11.: Handy für Pfand-Retouren koppeln (Kassenmenü); gekoppelt → Kasse gleicht alle 5 s ab.
  const [showPhonePair, setShowPhonePair] = useState(false);
  const [phonePaired, setPhonePaired] = useState(false);
  const [openingManagementAccess, setOpeningManagementAccess] = useState<OpeningManagementAccess>(null);
  // This is deliberately separate from `currentStaff`: opening Verwaltung
  // must never replace the person currently working at the cash register.
  const [managementAdministrator, setManagementAdministrator] = useState<StaffUser | null>(null);
  const [pendingClosePdf, setPendingClosePdf] = useState<JournalReportData | null>(null);
  const [lastStaffId, setLastStaffId] = useState<string | null>(() => loadJSON<string | null>(STORAGE_KEYS.lastStaffId, null));
  const [staffAdminLoginOpen, setStaffAdminLoginOpen] = useState(false);
  const signedInUser = useAuthUser();
  const canOpenSetup = currentStaff?.role !== 'employee' && (adminStartup || signedInUser === 'admin' || adminUnlocked);
  useEffect(() => {
    if (!canOpenSetup || readDeviceSetup()?.archiveMode !== 'folder') return;
    let active = true;
    void archiveFolderStatus().then(status => {
      if (active && status === 'missing') {
        setPdfArchiveWarning('Der gespeicherte Kassenordner ist nicht mehr verfügbar. Du kannst ihn im Setup erneut wählen.');
      }
    });
    return () => { active = false; };
  }, [canOpenSetup]);
  const staff = useStaffDirectory(startupActive);
  const catalog = useCatalogSync({
    categories: store.categories,
    products: store.products,
    pfandSettings: store.pfandSettings,
    shotOptions: store.shotOptions,
    testMode,
    offerInitialDownload: startupActive,
    applyRows: store.applyCatalogRows,
  });
  const { online, syncNow, pauseSyncForRestore, resumeSyncAfterRestore } = useCloudSync(
    store.transactions,
    store.cashSessions,
    testMode,
    () => setSyncedAt(Date.now()),
    store.mergeCloudData,
    catalog.syncCatalog,
    store.applyCloudBookingReset,
    startupActive,
  );
  const stornoLedger = useStornoLedger(testMode, online);

  // Published updates are detected in the background (start, every 15 min,
  // when the app comes back to the foreground or online). Nothing is installed:
  // the running version stays active until "Jetzt installieren" is confirmed.
  const [updateReady, setUpdateReady] = useState(false);
  const updateDeferred = useRef(false);
  const candidateRef = useRef<PublishedUpdate | null>(null);
  const checkForUpdate = useCallback(async (offer: boolean) => {
    const update = await publishedUpdate();
    if (!update) return null;
    const known = candidateRef.current;
    if (!known || known.commit !== update.commit || known.builtAt !== update.builtAt) {
      candidateRef.current = update;
      setCandidate(update);
      setUpdateReady(false);
      // Download check only (HTTP cache); the active app files stay untouched.
      void preflightPublishedUpdate(update).then(ok => { if (candidateRef.current === update) setUpdateReady(ok); });
    }
    // 23.11.: Beim Start (und bei Rückkehr in die App) installiert die App ein Update
    // selbst, ohne Fenster. Das Fenster erscheint nur, wenn etwas fehlt (Kasse offen, offline …).
    if (offer) setAutoInstallPending(true);
    return update;
  }, []);

  useEffect(() => {
    const activation = approvedActivation();
    if (activation) {
      if (!activationVerified(activation)) setUpdatePhase('reload');
      return;
    }
    // 24.11.: Beim Wiederöffnen der PC-App (Chrome läuft weiter, Seite evtl. aus dem
    // Zwischenspeicher wiederhergestellt) zuverlässig prüfen. Schlägt die Abfrage fehl
    // (Netz nach dem Aufwachen noch nicht bereit), bald erneut versuchen statt erst
    // nach 15 Minuten. Die installierte Version bleibt dabei unverändert nutzbar.
    let retry: number | undefined;
    let retryDelay = 20_000;
    let lastCheck = 0;
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastCheck < 3_000) return; // focus + visibilitychange + pageshow kommen oft gleichzeitig
      lastCheck = Date.now();
      window.clearTimeout(retry);
      // Offer automatically only until the user chose "Später installieren".
      void checkForUpdate(!updateDeferred.current)
        .then(() => { retryDelay = 20_000; })
        .catch(() => { // offline: keep the running app, try again soon
          retry = window.setTimeout(check, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 5 * 60_000);
        });
    };
    check();
    const timer = window.setInterval(check, 15 * 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(retry);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
    };
  }, [checkForUpdate]);

  // 24.11.: Erinnerung. „Später“ merkt sich Zeitpunkt + Version (überlebt Neuladen).
  // Nach 10 Minuten erneut prüfen und anbieten – nur auf dem Startbildschirm ohne
  // angemeldeten Mitarbeiter, also ohne laufende Kassenvorgänge zu unterbrechen.
  const UPDATE_LATER_KEY = 'woodmo-update-later';
  const REMIND_MS = 10 * 60_000;
  const readLater = (): { id: string; at: number } | null => {
    try { const v = JSON.parse(localStorage.getItem(UPDATE_LATER_KEY) ?? 'null'); return v && typeof v.id === 'string' && Number.isFinite(v.at) ? v : null; } catch { return null; }
  };
  const candidateId = (u: PublishedUpdate) => `${u.commit}|${u.builtAt}`;
  const [reminderTick, setReminderTick] = useState(0);
  const autoChecking = useRef(false);
  useEffect(() => {
    const timer = window.setInterval(() => setReminderTick((n) => n + 1), 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') setReminderTick((n) => n + 1); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, []);
  useEffect(() => {
    // Neue Version tatsächlich installiert (Prüfung findet kein Update mehr): Erinnerung löschen.
    if (approvedActivation() || updatePhase !== null || updateBusy.current || autoInstallPending) return; // Installation läuft: pausieren
    if (!homeVisible || currentStaff || document.visibilityState === 'hidden') return;
    const later = readLater();
    if (later && Date.now() - later.at < REMIND_MS) return;
    let active = true;
    void checkForUpdate(false).then((update) => {
      if (!active) return;
      if (!update) { try { localStorage.removeItem(UPDATE_LATER_KEY); } catch { /* ignore */ } return; }
      if (later && later.id !== candidateId(update)) { try { localStorage.removeItem(UPDATE_LATER_KEY); } catch { /* ignore */ } }
      // Automatische Installation (alle Kassen zu) läuft gerade: nicht dazwischenfunken.
      if (autoChecking.current || autoUpdate.current || updateBusy.current) return;
      updateDeferred.current = false;
      setUpdatePhase('offer');
    }).catch(() => undefined);
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Takt, Startbildschirm und Phase genügen
  }, [reminderTick, homeVisible, currentStaff, updatePhase, autoInstallPending]);
  function remindLater() {
    const c = candidateRef.current;
    try { if (c) localStorage.setItem(UPDATE_LATER_KEY, JSON.stringify({ id: candidateId(c), at: Date.now() })); } catch { /* ignore */ }
  }

  // 24.11.: Bei jeder Rückkehr zum Startbildschirm sofort online prüfen,
  // ob eine neue Version bereitsteht (Dialog/Erinnerung folgen den Regeln oben).
  useEffect(() => {
    if (!homeVisible || currentStaff || approvedActivation()) return;
    if (document.visibilityState === 'hidden') return;
    void checkForUpdate(!updateDeferred.current)
      .then(() => setReminderTick((n) => n + 1))
      .catch(() => undefined); // offline: installierte Version läuft weiter
  }, [homeVisible, currentStaff, checkForUpdate]);

  async function openUpdateFromHome() {
    updateDeferred.current = false;
    try {
      const update = candidateRef.current ?? await checkForUpdate(false);
      if (update) setUpdatePhase('offer');
      else alert(`Version ${APP_VERSION} ist aktuell.`);
    } catch (error) {
      alert('Die Update-Prüfung ist gerade nicht möglich: ' + readableSyncError(error));
    }
  }

  // Geräte-Diagnose (25.11.): Lebenszeichen/Statusbericht und Fernbefehle, nur wenn am Gerät
  // BEREIT/AN gewählt ist. Befehle laufen nur im sicheren Zustand (Startbildschirm, niemand angemeldet,
  // nichts im Upload) und benutzen denselben Update-Ablauf wie „Jetzt installieren“.
  const lastBooking = useMemo(() => {
    let best: { at: number; total: number } | null = null;
    for (const tx of store.transactions) {
      if (!best || tx.timestamp > best.at) best = { at: tx.timestamp, total: tx.total };
    }
    return best;
  }, [store.transactions]);
  const diagCtxRef = useRef<DiagContext>({ location: null, online: true, homeVisible: true, staffLoggedIn: false, lastBooking: null, updateWaiting: null, syncStatus: '' });
  diagCtxRef.current = {
    location: store.activeSession?.location ?? store.selectedLocation ?? null,
    online, homeVisible, staffLoggedIn: !!currentStaff, lastBooking,
    updateWaiting: candidate?.version ?? null, syncStatus: catalog.syncStatus,
  };
  const diagHandlersRef = useRef<DiagHandlers>({ run: async () => ({ done: true, text: '' }) });
  diagHandlersRef.current = {
    async run(command: DiagCommand) {
      if (command === 'status') return { done: true, text: `Status gesendet, Version ${APP_VERSION}` };
      if (command === 'update-check') {
        try {
          const update = await checkForUpdate(false);
          return { done: true, text: update ? `Update ${update.version} wartet` : `Version ${APP_VERSION} ist aktuell` };
        } catch (error) { return { done: true, text: 'Prüfung nicht möglich: ' + readableSyncError(error) }; }
      }
      // reload und update-install: nur wenn kein Benutzer angemeldet ist (auch Verwaltung zählt). Eine offene Kasse
      // ohne angemeldeten Benutzer ist erlaubt. Sonst bleibt der Befehl in der Warteschlange und wird beim
      // nächsten Durchlauf erneut geprüft. Buchungen liegen dauerhaft im Gerätespeicher, ein Neuladen verliert nichts.
      const loggedIn = !!currentStaff; // Verwaltungs-Anmeldung ohne Kassen-Benutzer gilt als abgemeldet
      const idle = !updatePhase && !updateBusy.current;
      if (loggedIn || !idle) {
        return { done: false, text: loggedIn ? 'Wartet: Benutzer angemeldet, wird bei Abmeldung ausgeführt' : 'Wartet: Update-Vorgang läuft' };
      }
      if (command === 'reload') {
        window.setTimeout(() => window.location.reload(), 2500);
        return { done: true, text: 'Lädt neu' };
      }
      // update-install
      try {
        const update = candidateRef.current ?? await checkForUpdate(false);
        if (!update) return { done: true, text: `Kein Update, Version ${APP_VERSION}` };
        if (!candidate) return { done: false, text: 'Update wird vorbereitet, nächster Versuch folgt' };
        if (!homeVisible) {
          // Offene Kasse ohne Benutzer: zuerst zum Startbildschirm, danach startet der normale Update-Ablauf.
          forceUpdateRef.current = true;
          setMenuOpen(false); setHomeVisible(true); setManagementAdministrator(null);
          setAdminUnlocked(false); resetJournalSelection();
          return { done: true, text: `Update ${update.version}: Gerät geht zum Startbildschirm, dann Installation` };
        }
        autoUpdate.current = true;
        void prepareUpdate();
        return { done: true, text: `Update ${update.version} gestartet` };
      } catch (error) { return { done: false, text: 'Update nicht gestartet: ' + readableSyncError(error) }; }
    },
  };
  const forceUpdateRef = useRef(false);
  useEffect(() => {
    if (!forceUpdateRef.current || !homeVisible || currentStaff || !candidate || updatePhase || updateBusy.current) return;
    forceUpdateRef.current = false;
    autoUpdate.current = true;
    void prepareUpdate();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reagiert nur auf Lage-Wechsel
  }, [homeVisible, currentStaff, candidate, updatePhase]);
  useEffect(() => installFullscreenToggle(), []);
  useEffect(() => installKeyboardOnTap(), []);
  useEffect(() => { installStyledAlert(); }, []);
  // Lebenszeichen an gekoppelte Handys: ohne Meldung (Kassen-App geschlossen) endet deren Kopplung nach 30 Minuten.
  const pairSessionId = store.activeSession && !store.activeSession.closed ? store.activeSession.id : null;
  useEffect(() => {
    if (!pairSessionId || testMode) return;
    const beat = () => {
      if (!navigator.onLine) return;
      void callMobileAsTablet<{ active: number }>('pair_heartbeat', { session_id: pairSessionId })
        .then((result) => setPhonePaired(result.active > 0)).catch(() => undefined);
    };
    beat();
    const timer = window.setInterval(beat, 60_000);
    return () => window.clearInterval(timer);
  }, [pairSessionId, testMode]);
  useEffect(() => {
    if (!phonePaired || testMode) return;
    const timer = window.setInterval(() => { if (navigator.onLine) void syncNow(); }, 5000);
    return () => window.clearInterval(timer);
  }, [phonePaired, testMode, syncNow]);
  // Datei-/Ordneranfragen vom PC zügig beantworten (nur im Modus AN, nur online und sichtbar).
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (getDiagMode() !== 'on' || !navigator.onLine || document.visibilityState !== 'visible') return;
      void serveFileTransfers(getDeviceId()).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    installDiagErrorCapture();
    let busy = false;
    let lastRun = 0;
    const run = async (force: boolean) => {
      const mode = getDiagMode();
      if (mode === 'off' || busy) return;
      if (!force && mode === 'ready' && Date.now() - lastRun < 55_000) return;
      busy = true;
      try { await diagnosticsTick(diagCtxRef.current, diagHandlersRef.current); } catch { /* still: nächster Durchlauf */ }
      finally { busy = false; lastRun = Date.now(); }
    };
    const timer = window.setInterval(() => { void run(false); }, 30_000);
    const soon = () => { window.setTimeout(() => { void run(true); }, 1500); };
    window.addEventListener(DIAG_EVENT, soon);
    window.addEventListener('online', soon);
    soon();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(DIAG_EVENT, soon);
      window.removeEventListener('online', soon);
    };
  }, []);

  // Fix 23.11.: Ein Tipp auf „Jetzt installieren“ führt den ganzen vorhandenen Ablauf
  // selbst durch (prüfen -> Speicherort -> Cloud-Abgleich -> aktivieren -> Neustart).
  // Rückfragen kommen nur noch bei Fehlern oder wenn kein Speicherort gespeichert ist.
  // Sicherer Zeitpunkt bleibt: nur auf dem Startbildschirm ohne angemeldeten Mitarbeiter.
  const autoUpdate = useRef(false);
  useEffect(() => {
    if (!autoUpdate.current || updateBusy.current) return;
    if (!homeVisible || currentStaff) { autoUpdate.current = false; return; }
    if (updatePhase === 'prepared' && !updateError) void continueUpdate();
    else if (updatePhase === 'synced' && !updateError) void finishUpdate();
    else if (updatePhase === 'sync-error' || updatePhase === 'offer' || updatePhase === null) autoUpdate.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reagiert nur auf Phasenwechsel
  }, [updatePhase, updateError, homeVisible, currentStaff]);
  useEffect(() => {
    if (!autoInstallPending || !candidate || updatePhase !== null || updateBusy.current) return;
    if (!homeVisible || currentStaff || testMode) return; // sicherer Zeitpunkt: Startbildschirm, niemand angemeldet
    setAutoInstallPending(false);
    autoChecking.current = true;
    // Automatisch nur, wenn alle Kassen abgeschlossen sind; sonst wartet das Update auf „Jetzt installieren“.
    void checkRegistersClosedInCloud().then((status) => {
      if (!status.ready || !status.allClosed) return;
      autoUpdate.current = true;
      void prepareUpdate();
    }).finally(() => { autoChecking.current = false; setReminderTick((n) => n + 1); });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- startet nur bei passender Lage
  }, [autoInstallPending, candidate, updatePhase, homeVisible, currentStaff, testMode]);

  // Sicherheitsprüfung 23.11.: Update nur, wenn in der Cloud ALLE Kassen endgültig
  // abgeschlossen sind. Ohne Cloud-Antwort gilt das Update als nicht freigegeben.
  const [registerStatus, setRegisterStatus] = useState<RegisterStatus | null>(null);
  useEffect(() => {
    if (updatePhase !== 'offer' || testMode) return;
    let active = true;
    setRegisterStatus(null);
    void checkRegistersClosedInCloud().then((status) => { if (active) setRegisterStatus(status); });
    return () => { active = false; };
  }, [updatePhase, testMode]);
  async function requireRegistersClosed() {
    const status = await checkRegistersClosedInCloud();
    setRegisterStatus(status);
    if (!status.ready) throw new Error('Update noch nicht freigegeben: ' + status.lines.join(' '));
  }

  async function prepareUpdate() {
    if (!candidate || updateBusy.current || !homeVisible || currentStaff) return;
    updateBusy.current = true;
    setUpdateError(null);
    setUpdatePhase('preparing');
    try {
      if (!supabase || testMode) throw new Error('Der Cloud-Abgleich für das Update benötigt den aktiven Modus.');
      await requireRegistersClosed();
      await checkStartupData();
      await preparePublishedUpdate(candidate);
      setUpdatePhase('prepared');
    } catch (error) {
      setUpdateError(readableSyncError(error));
      setUpdatePhase('offer');
      void publishedUpdate().then(setCandidate).catch(() => undefined);
    } finally {
      updateBusy.current = false;
    }
  }

  async function continueUpdate() {
    if (updateBusy.current) return;
    setUpdateError(null);
    setUpdatePhase('folder-check');
    // An interrupted setup (cancelled or app closed) always starts again with
    // the setup step; nothing is synced or activated before it is completed.
    // Fix 23.11.: Ein gespeicherter Ordner (z. B. „Kasse 2026“) wird verwendet, die Abfrage entfällt.
    // Nur wenn kein Ordner gespeichert ist oder er fehlt, muss einer gewählt werden.
    if (readDeviceSetup()?.archiveMode === 'folder' && await archiveFolderStatus() !== 'missing') {
      setInitialSetupPending(false);
      await syncBeforeUpdate();
    } else {
      setInitialSetupPending(true);
      if (canOpenSetup) setUpdatePhase('folder');
      else {
        setUpdateError('Ein Administrator muss den Kassenordner einrichten.');
        setUpdatePhase('prepared');
      }
    }
  }

  async function syncBeforeUpdate() {
    if (updateBusy.current) return;
    updateBusy.current = true;
    syncedCashDigest.current = null;
    setUpdateError(null);
    setSyncPercent(0);
    setUpdatePhase('syncing');
    try {
      if (!(await isReachable())) throw new Error(STARTUP_OFFLINE_MESSAGE);
      setSyncPercent(20);
      const result = await syncNow(true);
      if (!result.ok) throw new Error(result.error || 'Der Cloud-Abgleich konnte nicht abgeschlossen werden.');
      setSyncPercent(80);
      await staff.sync();
      await checkStartupData();
      if ((await readPendingOutbox()).length) throw new Error('Es sind noch lokale Übertragungen offen. Bitte erneut synchronisieren.');
      syncedCashDigest.current = await startupCashDigest();
      setSyncPercent(100);
      setUpdatePhase('synced');
    } catch (error) {
      setUpdateError(readableSyncError(error));
      setUpdatePhase('sync-error');
    } finally {
      updateBusy.current = false;
    }
  }

  async function finishUpdate() {
    if (!candidate || updateBusy.current || !homeVisible || currentStaff) return;
    updateBusy.current = true;
    setUpdateError(null);
    setUpdatePhase('activating');
    try {
      await requireRegistersClosed();
      if ((await readPendingOutbox()).length || await startupCashDigest() !== syncedCashDigest.current) {
        syncedCashDigest.current = null;
        throw new Error('Der Kassenstand hat sich seit dem Abgleich geändert. Bitte erneut synchronisieren.');
      }
      await activatePublishedUpdate(candidate);
      setInitialSetupPending(false);
      setUpdatePhase('reload');
      window.location.reload();
    } catch (error) {
      setUpdateError(readableSyncError(error));
      setUpdatePhase(syncedCashDigest.current ? 'synced' : 'sync-error');
    } finally {
      updateBusy.current = false;
    }
  }
  /** Explicit admin save with truthful read-after-write proof in V3 cloud. */
  async function savePfandAndVerify(settings: PfandSettings): Promise<'cloud' | 'local'> {
    // Update only the V3 local catalog; the existing catalog engine handles its
    // versioning, conflict detection, offline queue and cloud write.
    store.updatePfandSettings(settings);
    if (testMode) return 'local';

    // React must commit the updated store before the engine snapshots it.
    // Wait past the existing 700 ms catalog debounce, then synchronize and
    // compare against a fresh server read. Never report success based on state.
    let problem = 'Cloud hat die eingegebenen Pfandwerte noch nicht bestätigt.';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, attempt === 0 ? 900 : 550));
      const result = await catalog.syncCatalog(false);
      if (!result.ok) {
        problem = result.error || problem;
        // Conflict dialogs and offline errors need explicit resolution, not
        // another blind write attempt.
        break;
      }
      try {
        if (pfandCloudMatches(await fetchCatalogRows(), settings)) return 'cloud';
        problem = 'Abgleich durchgeführt, aber der Pfandwert stimmt noch nicht mit der Cloud überein.';
      } catch (error) {
        problem = error instanceof Error ? error.message : 'Cloud-Rücklesen fehlgeschlagen.';
        break;
      }
    }
    throw new Error(problem);
  }

  // Fix 22.11.: Neues/zurückgesetztes Gerät ohne Kassenordner bekommt das
  // Ordner-Setup auch ohne Update (vorher nur im Update-Ablauf). Nur für Admins,
  // nur auf dem Startbildschirm, ändert keine Daten. Abbruch -> beim nächsten Start erneut.
  const [freshSetup, setFreshSetup] = useState(false);
  const freshSetupShown = useRef(false);
  useEffect(() => {
    if (freshSetupShown.current || !canOpenSetup || !homeVisible || currentStaff || updatePhase !== null || deviceSetupOpen) return;
    // Nur ohne gespeicherten Speicherort fragen (23.11.).
    if (readDeviceSetup()) { setInitialSetupPending(false); return; }
    freshSetupShown.current = true;
    setInitialSetupPending(true);
    setFreshSetup(true);
    setDeviceSetupOpen(true);
  }, [canOpenSetup, homeVisible, currentStaff, updatePhase, deviceSetupOpen]);

  async function syncAfterFreshSetup() {
    setFreshSetup(false);
    setDeviceSetupOpen(false);
    setInitialSetupPending(false);
    const result = await syncNow();
    if (!result.ok) alert('Ordner gespeichert. Cloud-Abgleich: ' + (result.error || 'nicht abgeschlossen. Bitte „Sync Cloud“ tippen.'));
  }

  // Any PDF export on this device can request reconfiguration. This includes
  // journal exports from another computer restoring a cloud booking history.
  useEffect(() => {
    const showSetup = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setPdfArchiveWarning(detail?.message || 'Der lokale PDF-Speicherordner muss erneut eingerichtet werden.');
      if (canOpenSetup) setDeviceSetupOpen(true);
    };
    window.addEventListener(PDF_ARCHIVE_SETUP_EVENT, showSetup);
    return () => window.removeEventListener(PDF_ARCHIVE_SETUP_EVENT, showSetup);
  }, [canOpenSetup]);

  // The last finalized balance per location is a suggestion only. It is not
  // copied until the user actually opens the next cash session.
  // Offene Kasse je Standort (aus den synchronisierten Cloud-Daten): Das Eröffnungsfenster zeigt beim
  // Antippen eines Standorts sofort „bereits geöffnet – weiterführen“ statt „eröffnen“.
  const openSessionsByLocation = useMemo<Record<Location, CashSession | null>>(() => ({
    Friedrichshafen: activeSessionForLocation(store.cashSessions, 'Friedrichshafen'),
    Bregenz: activeSessionForLocation(store.cashSessions, 'Bregenz'),
  }), [store.cashSessions]);
  const openingBalanceSuggestions = useMemo<Record<Location, number | null>>(() => {
    const latestFor = (location: Location) => openingBalanceForLocation(store.cashSessions, store.transactions, location);
    return { Friedrichshafen: latestFor('Friedrichshafen'), Bregenz: latestFor('Bregenz') };
  }, [store.cashSessions, store.transactions, store.categories]);
  // 24.11.: Datum des Abschlusses, aus dem der übertragbare Bestand stammt.
  const openingBalanceDates = useMemo<Record<Location, number | null>>(() => ({
    Friedrichshafen: openingBalanceCarryForLocation(store.cashSessions, store.transactions, 'Friedrichshafen').at,
    Bregenz: openingBalanceCarryForLocation(store.cashSessions, store.transactions, 'Bregenz').at,
  }), [store.cashSessions, store.transactions]);

  // The browser profile may be new while the personnel list already exists in
  // the cloud. Load it again once the cloud session is definitely available.
  useEffect(() => {
    if (!startupActive && signedInUser && online) void staff.sync().catch(() => undefined);
  }, [online, signedInUser, staff.sync, startupActive]);

  const syncEverything = useCallback(async () => {
    const result = await syncNow();
    try {
      await staff.sync();
      return result;
    } catch (cause) {
      return { ok: false, error: readableSyncError(cause) };
    }
  }, [staff.sync, syncNow]);

  /** One-time, explicitly approved recovery for a duplicate *unused*
   * local opening. The original cloud cash register and its sales survive.
   * All local evidence is archived before removing the duplicate outbox row. */
  async function recoverUnusedLocalCashConflict(): Promise<string> {
    if (!online || !supabase || testMode) throw new Error('Kassenübernahme benötigt die angemeldete V3-Cloud im aktiven Modus.');
    const generation = knownBookingReset().generation;
    const { data, error } = await supabase.from('pos_cash_sessions')
      .select('id,location,data')
      .eq('booking_generation', generation);
    if (error) throw new Error('Cloud-Kassensitzungen konnten nicht geprüft werden: ' + error.message);
    const remoteActive = (data ?? []).map((row) => row.data as CashSession).filter((session) =>
      !session.closed && !session.discarded && !session.closedAt &&
      !session.dailyCloseFinalizedAt && !session.dailyCloseSnapshot);
    const conflicts = store.cashSessions.filter((local) => !local.closed && !local.discarded &&
      !local.closedAt && !local.dailyCloseFinalizedAt && !local.dailyCloseSnapshot &&
      remoteActive.some((remote) => remote.location === local.location && remote.id !== local.id));
    if (conflicts.length !== 1) throw new Error(
      conflicts.length === 0 ? 'Keine doppelte offene Kasse gefunden. Bitte Synchronisierung erneut prüfen.'
        : 'Mehrere lokale Kassenkonflikte erkannt. Automatische Übernahme ist gesperrt.');
    const local = conflicts[0];
    const remote = remoteActive.find((session) => session.location === local.location && session.id !== local.id)!;
    if (store.cashSessions.some((session) => session.location === local.location &&
      session.id !== local.id && session.id !== remote.id &&
      !session.closed && !session.discarded && !session.closedAt)) {
      throw new Error('Mehrere offene lokale Kassensitzungen. Automatische Übernahme gesperrt.');
    }
    if (sessionTransactions(store.transactions, local).length ||
        local.entries.length || local.corrections.length || local.dailyCloseSnapshot ||
        (local.closingWithdrawalAmount ?? 0) !== 0 ||
        (local.activities ?? []).some((entry) => !['cash_opened', 'login', 'logout'].includes(entry.type))) {
      throw new Error('Die lokale Kasse hat bereits Buchungen oder Kassenbewegungen. Keine automatische Übernahme! Die Daten bleiben erhalten.');
    }
    const pending = await readPendingOutbox();
    const pendingSales = pending.filter((entry) =>
      entry.table === 'pos_transactions' && (
        (entry.row.data as Transaction | undefined)?.cashSessionId === local.id ||
        ((entry.row.data as Transaction | undefined)?.location === local.location &&
          !(entry.row.data as Transaction | undefined)?.cashSessionId &&
          Number((entry.row.data as Transaction | undefined)?.timestamp) >= local.openedAt)));
    if (pendingSales.length) throw new Error('Noch nicht hochgeladene lokale Verkäufe vorhanden. Übernahme gesperrt.');

    const agree = window.confirm(
      `In ${local.location} ist bereits die Cloud-Kasse ${remote.id} geöffnet ` +
      `(Anfangsbestand ${remote.openingBalance.toFixed(2)} €).\n\n` +
      `Die zweite lokale Öffnung ${local.id} (Anfangsbestand ${local.openingBalance.toFixed(2)} €) ` +
      'hat keine Verkäufe oder Bargeldbewegungen.\n\n' +
      'Soll diese unbenutzte lokale Öffnung zuerst vollständig lokal archiviert und dann die vorhandene Cloud-Kasse übernommen werden? ' +
      'Die Cloud-Buchungen bleiben unverändert.');
    if (!agree) throw new Error('Kassenübernahme abgebrochen. Keine Daten verändert.');

    const archiveKey = `woodmo_v3_conflict_archive_${Date.now()}_${crypto.randomUUID()}`;
    const archive = JSON.stringify({ archivedAt: new Date().toISOString(), generation,
      localSession: local, remoteSession: remote, pendingOutbox: pending,
      localTransactions: store.transactions });
    try {
      localStorage.setItem(archiveKey, archive);
      if (localStorage.getItem(archiveKey) !== archive) throw new Error('Archiv konnte nicht verifiziert werden.');
    } catch (cause) {
      throw new Error('Sichere lokale Archivierung gescheitert. Keine Kassensitzung wurde entfernt: ' +
        (cause instanceof Error ? cause.message : String(cause)));
    }
    await removeQueuedUnusedCashSession(local.id, local.location, local.openedAt);
    store.adoptCloudCashSession(local.id, remote);
    return `Unbenutzte lokale Öffnung gesichert und Cloud-Kasse ${remote.id} übernommen. ` +
      'Bitte Synchronisierung erneut starten. Das lokale Archiv bleibt gespeichert.';
  }

  // The store reads test-mode at module init; switching requires a reload.
  function applyModeChange() {
    if (modeConfirm === 'to-test') {
      // Going into test mode: any bookings already saved from an earlier active
      // session would show up in test too. That's fine — they stay read-only in
      // localStorage and test bookings simply aren't written back. But to give
      // the user a clean test slate, we clear persisted bookings on entering test.
      clearBookings();
      setTestMode(true);
    } else if (modeConfirm === 'to-active') {
      // Entering active mode: discard any test bookings (they were never
      // persisted anyway) and turn on persistence for future bookings.
      clearBookings();
      setTestMode(false);
    }
    setModeConfirm(null);
    // Reload so useStore re-initializes with the new mode's data source.
    window.location.reload();
  }

  async function checkResetSafety(onProgress: (result: ResetSafetyResult) => void) {
    // No booking is reset by this read/consistency check. syncNow may upload
    // this device's already queued transactions, exactly as normal sync does.
        let cloud: Awaited<ReturnType<typeof fetchCloudData>> | null = null;
    let stornos: Awaited<ReturnType<typeof loadCloudStornos>> | null = null;
    let ledgerSignature: string | undefined;
    const completedReport = await runResetSafetyChecks([
      {
        id: 'connection', label: 'Cloud-Verbindung',
        run: async () => {
          if (!online || !navigator.onLine || !supabase) {
            throw new Error('Keine Cloud-Verbindung. Bitte Internetverbindung herstellen.');
          }
          await fetchLatestBookingReset();
          return 'Cloud erreichbar';
        },
      },
      {
        id: 'sync', label: 'Dieses Gerät synchronisiert',
        run: async () => {
          if (!online || !navigator.onLine) throw new Error('Offline: zuerst verbinden.');
          const result = await syncNow();
          if (!result.ok) throw new Error(result.error || 'Cloud-Abgleich fehlgeschlagen.');
          return 'Abgleich bestätigt';
        },
      },
      {
        id: 'pending', label: 'Lokale Buchungen übertragen',
        run: async () => {
          const pending = await readPendingOutbox();
          if (pending.length) {
            throw new Error(pending.length + ' Eintrag/Einträge noch nicht synchronisiert.');
          }
          return 'Keine ausstehenden Einträge auf diesem Gerät';
        },
      },
      {
        id: 'ledger', label: 'Cloud-Journal und Stornos geprüft',
        run: async () => {
          if (!online || !navigator.onLine) throw new Error('Cloud offline.');
          const reset = await fetchLatestBookingReset();
          const generation = reset?.generation ?? 0;
          [cloud, stornos] = await Promise.all([
            fetchCloudData(null, generation), loadCloudStornos(generation),
          ]);
                    requireValidBackupIntegrity({
            transactions: cloud.transactions,
            cashSessions: cloud.cashSessions,
            stornos,
          }, 'Sicherheitsprüfung');
          const ledgerBytes = new TextEncoder().encode(JSON.stringify({
            generation, transactions: [...cloud.transactions].sort((a,b) => a.id.localeCompare(b.id)),
            cashSessions: [...cloud.cashSessions].sort((a,b) => a.id.localeCompare(b.id)),
            stornos: [...stornos].sort((a,b) => a.id.localeCompare(b.id)),
          }));
          ledgerSignature = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', ledgerBytes)))
            .map(byte => byte.toString(16).padStart(2, '0')).join('');
          if (stornos.length !== stornoLedger.records.length) {
            throw new Error('Storno-Anzahl weicht ab. Bitte Journal synchronisieren.');
          }
          const localTransactionIds = new Set(cloud.transactions.map(row => row.id));
          const localSessionIds = new Set(cloud.cashSessions.map(row => row.id));
          if (store.transactions.some(row => !localTransactionIds.has(row.id)) ||
              store.cashSessions.some(row => !localSessionIds.has(row.id))) {
            throw new Error('Lokale Buchungen/Kassensitzungen fehlen noch in der Cloud.');
          }
          return cloud.transactions.length + ' Buchungen, ' + stornos.length + ' Stornos geprüft';
        },
      },
      {
        id: 'closed', label: 'Alle Kassen endgültig abgeschlossen',
        run: async () => {
          if (!cloud) throw new Error('Cloud-Journal nicht verfügbar; Abschluss nicht prüfbar.');
          const unfinished = cloud.cashSessions.filter(session =>
            !session.discarded && !(session.closed &&
              session.dailyCloseFinalizedAt && session.dailyCloseSnapshot));
          if (unfinished.length) {
            throw new Error(unfinished.length +
              ' Kasse(n) noch offen/nicht endgültig abgeschlossen. Bitte Tagesabschluss durchführen.');
          }
          return 'Keine offene oder unvollständig abgeschlossene Kasse';
        },
      },
        ], onProgress);
    return { ...completedReport, backupSignature: completedReport.resetAllowed ? ledgerSignature : undefined };
  }

  async function resetBookings(adminPassword: string) {
    // In test mode only ephemeral local test bookings are cleared.
    // Active mode must prove Cloud sync and storno visibility BEFORE
    // committing a new generation; never discard unsent financial entries.
    if (!testMode) {
      if (!online || !navigator.onLine) throw new Error('Buchungs-Reset benötigt eine aktive Cloud-Verbindung.');
      const synced = await syncNow();
      if (!synced.ok) throw new Error(synced.error || 'Cloud-Abgleich vor dem Reset fehlgeschlagen.');
      const pending = await readPendingOutbox();
      if (pending.some((entry) => entry.table === 'pos_transactions' || entry.table === 'pos_cash_sessions')) {
        throw new Error('Noch nicht bestätigte Buchungen oder Kassensitzungen vorhanden. Reset gesperrt, bitte synchronisieren.');
      }
      const verifiedStornos = await loadCloudStornos();
      if (verifiedStornos.length !== stornoLedger.records.length) {
        void stornoLedger.refresh().catch(() => undefined);
        throw new Error('Die Anzahl der Stornobelege hat sich geändert. Bitte den Reset-Dialog schließen und erneut öffnen.');
      }
      // The browser warning is informational; the SQL RPC repeats this
      // check under financial table locks so concurrent devices cannot race it.
      const beforeReset = await fetchLatestBookingReset();
      const snapshot = await fetchCloudData(null, beforeReset?.generation ?? 0);
      const unfinished = snapshot.cashSessions.filter(session =>
        !session.discarded && !(session.closed && session.dailyCloseFinalizedAt && session.dailyCloseSnapshot));
      if (unfinished.length) throw new Error(
        'Reset gesperrt: ' + unfinished.length +
        ' Kasse(n) noch offen oder Tagesabschluss nicht endgültig. Bitte zuerst alle Kassen endgültig abschließen.'
      );
      const reset = await resetCloudBookings(adminPassword);
      // Drop stale offline writes only AFTER the Cloud has committed the new
      // generation. Archived transactions, sessions and storno evidence stay.
      await discardEntriesBeforeGeneration(reset.generation);
      rememberBookingReset(reset);
    }
    store.resetAllData();
    // Refresh the immutable ledger asynchronously. Do not report an already
    // committed Cloud reset as failed because a secondary refresh is offline.
    if (!testMode) void stornoLedger.refresh().catch(() => undefined);
  }

  function navigateTo(nextTab: Tab) {
    setTab(nextTab);
    setHomeVisible(false);
    if (nextTab === 'pos') setPosVisited(true);
    setMenuOpen(false);
  }

  function goHome() {
    // The administration's unsaved SCHUSS draft must not silently disappear.
    if (tab === 'admin' && adminShotDirty && !homeVisible &&
      !window.confirm('Ungespeicherte SCHUSS-Änderungen verwerfen und zur Startseite wechseln?')) return;
    setAdminShotDirty(false);
    setMenuOpen(false);
    setHomeVisible(true);
  }

  function navigateToProtected(nextTab: 'admin' | 'journal') {
    if (currentStaff?.role === 'administrator') {
      setManagementAdministrator(currentStaff);
      setAdminUnlocked(true);
    }
    navigateTo(nextTab);
  }

  function chooseCashAction(action: Exclude<HeaderAction, null>) {
    navigateTo('pos');
    setHeaderAction(action);
  }

  function openManagementFromCashOpening(selectedStaff: StaffUser | null) {
    setHomeVisible(false);
    setMenuOpen(false);
    if (selectedStaff?.role === 'employee') return;
    if (selectedStaff?.role === 'administrator' && currentStaff?.id === selectedStaff.id && currentStaff.role === 'administrator') {
      setManagementAdministrator(currentStaff);
      setAdminUnlocked(true);
      setOpeningManagementAccess(null);
      setTab('admin');
      // Angemeldeter Administrator: direkt das Verwaltungsmenü öffnen statt der Kassen-Übersicht.
      setMenuOpen(true);
      return;
    }
    setAdminUnlocked(false); resetJournalSelection();
    setManagementAdministrator(null);
    if (!selectedStaff) {
      // Home login accepts a personal administrator password or the existing
      // manager gate, never logs the cashier out or weakens role checks.
      setOpeningManagementAccess(null);
    } else if (selectedStaff.role === 'administrator') {
      setOpeningManagementAccess({ kind: 'selected-administrator', administrator: selectedStaff });
    } else {
      setOpeningManagementAccess({ kind: 'employee-denied' });
    }
    setTab('admin');
  }

  /** Am gewählten Standort ist schon eine Kasse offen: Gerät dorthin umstellen und weiterführen.
   * Die Anmeldung des Mitarbeiters wird in DIESER Kasse vermerkt (Mitarbeiterzeiten im Abschluss). */
  function continueOpenSessionAt(location: Location) {
    const session = openSessionsByLocation[location];
    store.switchLocation(location);
    if (session && currentStaff) {
      store.recordStaffActivity(session.id, {
        id: `activity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'login', staffId: currentStaff.id, staffName: currentStaff.name, timestamp: Date.now(),
      });
    }
  }

  function recordStaff(type: 'login' | 'logout', user: StaffUser) {
    if (!store.activeSession) return;
    store.recordStaffActivity(store.activeSession.id, {
      id: `activity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      staffId: user.id,
      staffName: user.name,
      timestamp: Date.now(),
    });
  }

  function handleStaffAuthenticated(user: StaffUser) {
    setAdminUnlocked(user.role === 'administrator');
    setManagementAdministrator(user.role === 'administrator' ? user : null);
    setCurrentStaff(user);
    setLastStaffId(user.id);
    saveJSON(STORAGE_KEYS.lastStaffId, user.id);
    recordStaff('login', user);
  }

  async function commitBonStorno(receipt: Transaction, reason: string, password: string, stornoId: string) {
    const session = store.activeSession;
    const employee = currentStaff;
    if (!session || !employee || session.closed) throw new Error('Kasse oder Mitarbeiter nicht mehr aktiv.');
    if (receipt.location !== session.location || receipt.cashSessionId && receipt.cashSessionId !== session.id) {
      throw new Error('Originalbon gehört nicht zu dieser aktiven Kassensitzung.');
    }
    // The five most recent ORIGINAL receipts determine eligibility. This is
    // calculated independently in the client for immediate user feedback; the
    // database RPC repeats every check atomically.
    const currentCash = Math.round((session.openingBalance +
      store.transactions.filter((tx) => tx.paymentMethod === 'cash' && tx.location === session.location &&
        tx.timestamp >= session.openedAt && (!tx.cashSessionId || tx.cashSessionId === session.id))
        .reduce((sum, tx) => sum + tx.total, 0) +
      session.entries.reduce((sum, row) => sum + (row.type === 'deposit' ? row.amount : -row.amount), 0) +
      stornoLedger.records.filter((entry) => entry.cashSessionId === session.id)
        .reduce((sum, entry) => sum + entry.cashEffect, 0)) * 100) / 100;
    const record = prepareStorno({
      receipt, session, previousStornos: stornoLedger.records,
      allTransactions: store.transactions, reason, employeeId: employee.id,
      employeeName: employee.name, currentCashBalance: currentCash,
      now: Date.now(), stornoId,
    });
    if (!(await verifyStaffPassword(employee, password))) {
      throw new Error('Persönliches Mitarbeiterpasswort ist nicht korrekt.');
    }
    if (testMode) {
      stornoLedger.addSimulatedRecord(record);
      return record;
    }
    if (!online || stornoLedger.status !== 'ready' || !stornoLedger.serviceReady) {
      throw new Error(stornoLedger.serviceError || 'Storno nicht möglich: Stornojournal oder sicherer Serverdienst nicht freigegeben.');
    }
    const synced = await syncEverything();
    if (!synced.ok) throw new Error(synced.error || 'Offene Buchungen erst mit der Cloud synchronisieren.');
    // No offline storno outbox. The service validates personal credentials,
    // generation, original, last-five, cash coverage and duplicates under lock.
    const posted = await submitStornoOnline({
      stornoId, originalTransactionId: receipt.id, cashSessionId: session.id,
      employeeId: employee.id, employeePassword: password, reason: reason.trim(),
    });
    const verified = await stornoLedger.refresh();
    if (!verified.some((entry) => entry.id === posted.id && entry.originalTransactionId === receipt.id)) {
      throw new Error('Storno wurde gesendet, aber Cloud-Nachweis fehlt. Bitte Journal prüfen; keine neue Storno-ID verwenden.');
    }
    return posted;
  }

  async function discardUnusedSession() {
    const session = store.activeSession;
    if (!session) return;
    if (!canDiscardCashSession(session, store.transactions)) throw new Error('Eine Kasse mit Bestand oder Bewegungen darf nicht verworfen werden. Bitte den Tagesabschluss verwenden.');
    if (!testMode) {
      const sync = await syncEverything();
      if (!sync.ok) throw new Error(sync.error ?? 'Cloud-Abgleich fehlgeschlagen.');
      await pauseSyncForRestore();
      try {
        if (!supabase) throw new Error('Cloud ist nicht konfiguriert.');
        const { error } = await supabase.rpc('discard_empty_pos_cash_session', { p_session_id: session.id });
        if (error) throw error;
        store.discardEmptySession(session.id);
      } finally { resumeSyncAfterRestore(); }
    } else store.discardEmptySession(session.id);
  }

  async function handleStaffLogout() {
    const session = store.activeSession;
    if (session && canDiscardCashSession(session, store.transactions)) {
      try { await discardUnusedSession(); } catch (error) { alert(readableSyncError(error)); return; }
    } else {
    if (currentStaff) recordStaff('logout', currentStaff);
    }
    setCurrentStaff(null);
    // A cashier logout closes an administrator's direct workspace access as
    // well. The next person must authenticate with their own credentials.
    setManagementAdministrator(null);
    setAdminUnlocked(false); resetJournalSelection();
  }

  // Keep the current action visible in the heading even when it opens a
  // top-level dialog instead of an AdminScreen-internal modal.
  const activeAdminSectionTitle = deviceSetupOpen && tab === 'admin'
    ? 'Setup / PDF-Ordner'
    : modeConfirm && tab === 'admin'
      ? modeConfirm === 'to-test' ? 'Auf Testmodus wechseln' : 'Auf aktiven Modus wechseln'
      : adminSection;

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      {/* Compact toolbar: Home never closes the register or clears its cart. */}
      {!homeVisible && (
        <>
          <header className="relative z-20 flex min-h-14 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/10 bg-[#0b0f19] px-2 py-1.5 text-white shadow-sm sm:px-3">
            <WoodmoBrand status={!online || catalog.syncStatus === 'error' ? 'error' : !testMode && catalog.syncStatus !== 'saved' ? 'pending' : 'ok'} />
            <h1 className={`ml-1.5 min-w-0 shrink-0 truncate pb-0.5 text-2xl font-extrabold leading-[1.25] sm:ml-2.5 sm:text-[1.7rem] ${!online ? 'woodmo-heading-offline text-red-400' : 'text-white'}`}
              aria-live="polite" title={tab === 'admin' && adminUnlocked ? `Verwaltung · ${activeAdminSectionTitle}` : undefined}>
              {tab === 'pos' ? 'Kasse' : tab === 'admin' ? 'Verwaltung' : 'Journal'}
            </h1>
            <button type="button" aria-label="Zur Startseite" title="Zur Startseite" onClick={goHome}
              className="flex h-10 shrink-0 items-center justify-center gap-1 rounded-xl border border-white/50 bg-transparent px-2.5 text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
              <Home className="h-5 w-5" />
              <span className="hidden min-[1040px]:inline text-xs font-semibold">Home</span>
            </button>
            {(tab !== 'admin' || adminUnlocked) && (
              <button type="button" aria-label={tab === 'admin' ? 'Verwaltungsmenü öffnen' : tab === 'journal' ? 'Journalmenü öffnen' : 'Kassenmenü öffnen'}
                title="Menü" aria-expanded={menuOpen} aria-haspopup="dialog"
                onClick={() => setMenuOpen((wasOpen) => !wasOpen)}
                className={`flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-2.5 font-semibold text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${menuOpen ? 'border-white bg-white !text-slate-900' : 'border-white/50 bg-transparent'}`}>
                <LayoutGrid className="h-5 w-5" />
                <span className="hidden min-[740px]:inline text-xs">Menü</span>
              </button>
            )}
            <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-slate-200"
              role="status"
              title={headerDateLong(headerNow)}>
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {store.activeSession?.location ?? store.selectedLocation} · {headerDateShort(headerNow)}
            </div>
            {tab === 'pos' && !store.activeSession && (
              <button type="button" aria-label="Kasse eröffnen" title="Kasse eröffnen"
                onClick={() => setCashierLoginRequest((request) => request + 1)}
                className="flex h-10 shrink-0 items-center gap-1 rounded-xl border border-emerald-500/70 bg-emerald-950/30 px-2.5 text-xs font-bold text-emerald-200 hover:bg-emerald-900/50">
                <LogIn className="h-4 w-4" />
                <span className="hidden min-[800px]:inline">Kasse eröffnen</span>
              </button>
            )}
            <span className="order-3 w-full text-center text-xl font-extrabold tabular-nums text-white sm:text-2xl min-[1100px]:absolute min-[1100px]:left-1/2 min-[1100px]:w-auto min-[1100px]:-translate-x-1/2"
              role="timer" aria-label={`Uhrzeit ${headerTime(headerNow)} Uhr`}>
              {headerTime(headerNow)} Uhr
            </span>
            <div className="order-2 ml-auto flex shrink-0 items-center gap-1.5">
              {tab === 'pos' && (
                <button type="button"
                  aria-label={currentStaff ? 'Mitarbeiter abmelden' : 'Mitarbeiter anmelden'}
                  title={currentStaff ? `${currentStaff.name} abmelden` : 'Mitarbeiter anmelden'}
                  onClick={() => currentStaff ? void handleStaffLogout() : setCashierLoginRequest((n) => n + 1)}
                  className={`flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-xs font-bold transition focus-visible:outline focus-visible:outline-2 ${currentStaff
                    ? 'border-red-500/80 bg-red-950/30 text-red-200 hover:bg-red-900/40 focus-visible:outline-red-400'
                    : 'border-emerald-500/80 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 focus-visible:outline-emerald-400'}`}>
                  {currentStaff ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                  <span className="hidden min-[970px]:inline">{currentStaff ? 'Abmelden' : 'Anmelden'}</span>
                </button>
              )}
              {tab === 'pos' && currentStaff && (
                <span
                  className="flex h-10 max-w-[10rem] min-w-0 items-center gap-1.5 rounded-xl border border-sky-500/70 bg-sky-950/55 px-2.5 text-xs font-bold text-sky-100 shadow-sm"
                  role="status"
                  aria-label={`Angemeldeter Mitarbeiter: ${currentStaff.name}`}
                  title={`Angemeldeter Mitarbeiter: ${currentStaff.name}`}
                >
                  <UserRound className="h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
                  <span className="hidden min-[1200px]:inline text-sky-300">Mitarbeiter:</span>
                  <span className="min-w-0 truncate">{currentStaff.name}</span>
                </span>
              )}
              <button type="button" aria-label="Cloud synchronisieren" title="Cloud synchronisieren"
                onClick={() => setSyncOpen(true)}
                className="flex h-10 items-center gap-1 rounded-xl border border-emerald-500/60 px-2 text-emerald-300 hover:bg-emerald-900/30">
                <RefreshCw className="h-4 w-4" />
                <span className="hidden min-[1080px]:inline text-xs font-semibold">Sync Cloud</span>
              </button>
              <span role="status" title={!online ? 'Cloud nicht erreichbar' : catalog.syncStatus === 'error' ? 'Artikel-Abgleich fehlgeschlagen' : 'Cloud verbunden'}
                className={`flex h-10 items-center gap-1 rounded-xl border px-2 text-xs font-bold ${!online || catalog.syncStatus === 'error' ? 'border-red-500/80 bg-red-950/35 text-red-300' : 'border-emerald-500/60 bg-emerald-950/20 text-emerald-300'}`}>
                <Cloud className="h-4 w-4" />
                <span className="hidden min-[1100px]:inline">{!online ? 'Offline' : 'Cloud'}</span>
                <span className="text-[10px]">{testMode ? 'TEST' : 'AKTIV'}</span>
              </span>

              <button type="button" aria-label="Darstellung wechseln" title="Hell/Dunkel" onClick={toggle}
                className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-600 text-slate-100 hover:bg-slate-700 min-[780px]:flex">
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>
          </header>
          {/* Sicherheitsarchiv: Kassierer sehen nichts. Nur Administratoren bekommen einen Hinweis,
              und zwar nur, wenn wirklich nicht übertragene Bons oder Kassensitzungen gesichert wurden.
              Reine Alt-Sicherungen (alles übertragen) stehen nur still in der Verwaltung. */}
          {resetArchive && (resetArchive.pendingReceipts > 0 || resetArchive.pendingSessions > 0) &&
            (currentStaff?.role === 'administrator' || adminUnlocked) && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-950 px-3 py-2 text-sm text-amber-100">
              <span>
                <AlertTriangle className="mr-1 inline h-4 w-4" />
                Sicherheitsarchiv: {resetArchive.pendingReceipts} nicht übertragene Bon(s) und {resetArchive.pendingSessions} Kassensitzung(en)
                aus einer früheren Kasse auf diesem Gerät gesichert. Bitte prüfen, nicht automatisch nachbuchen.
              </span>
              <button type="button" onClick={() => navigateToProtected('admin')}
                className="rounded-lg border border-amber-300/60 px-3 py-1.5 font-bold hover:bg-amber-900">
                In Verwaltung prüfen
              </button>
            </div>
          )}
          {menuOpen && (tab !== 'admin' || !adminUnlocked) && (
            <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/65 px-3 pb-4 pt-16"
              onClick={() => setMenuOpen(false)}
              onKeyDown={(event) => { if (event.key === 'Escape') setMenuOpen(false); }}>
              <nav role="dialog" aria-modal="true" aria-label="Kassenmenü"
                className="gx-panel w-full max-w-xl rounded-3xl p-3"
                onClick={(event) => event.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-bold gx-text">Kassenmenü</h2>
                  <button type="button" aria-label="Menü schließen" onClick={() => setMenuOpen(false)}
                    className="gx-btn flex h-10 w-10 items-center justify-center rounded-xl"><X className="h-5 w-5" /></button>
                </div>

                {/* Home and Kasse stay together, also in the employee-only menu. */}
                <div className={`grid gap-2 ${(currentStaff?.role === 'administrator' || (adminUnlocked && currentStaff?.role !== 'employee')) ? 'grid-cols-2' : 'grid-cols-2'}`}>
                  <button type="button" onClick={goHome}
                    className="gx-btn flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center text-sm font-bold">
                    <Home className="h-5 w-5" /> <span>Startseite</span>
                  </button>
                  <button type="button" onClick={() => navigateTo('pos')} className="gx-btn flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center text-sm font-bold">
                    <ShoppingCart className="h-5 w-5" /> Kasse
                  </button>
                  {(currentStaff?.role === 'administrator' || (adminUnlocked && currentStaff?.role !== 'employee')) && (
                    <>
                      <button type="button" onClick={() => navigateToProtected('journal')} className="gx-btn flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center text-sm font-bold">
                        <Receipt className="h-5 w-5" /> Journal
                      </button>
                      <button type="button" onClick={() => navigateToProtected('admin')} className="gx-btn flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center text-sm font-bold">
                        <Settings className="h-5 w-5" /> Verwaltung
                      </button>
                    </>
                  )}
                </div>

                {store.activeSession && currentStaff && (
                  <>
                    <h3 className="gx-heading mt-4 mb-2 text-xs font-bold uppercase tracking-wide">Kassenbewegungen</h3>
                    {/* Gleiche Kachelgröße wie oben: gleiche Spaltenzahl, gleiche Höhe, gleiche Schrift. */}
                    <div className={`grid gap-2 ${(currentStaff?.role === 'administrator' || (adminUnlocked && currentStaff?.role !== 'employee')) ? 'grid-cols-2' : 'grid-cols-2'}`}>
                      <button type="button" onClick={() => chooseCashAction('deposit')} className="gx-btn flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center text-sm font-bold">
                        <ArrowDownCircle className="h-5 w-5" /> Einlage
                      </button>
                      <button type="button" onClick={() => chooseCashAction('withdrawal')} className="gx-btn flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center text-sm font-bold">
                        <ArrowUpCircle className="h-5 w-5" /> Ausgabe
                      </button>
                      <button type="button" onClick={() => chooseCashAction('correction')} className="gx-btn flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center text-sm font-bold">
                        <Settings className="h-5 w-5" /> Bestandskorrektur
                      </button>
                      {!testMode && (
                        <button type="button" onClick={() => { setMenuOpen(false); setShowPhonePair(true); }} className="gx-btn flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center text-sm font-bold">
                          <Smartphone className="h-5 w-5" /> Handy koppeln{phonePaired ? ' ●' : ''}
                        </button>
                      )}
                    </div>
                    <button type="button" onClick={() => chooseCashAction('close')}
                      className="mt-3 flex min-h-24 w-full items-center justify-center gap-3 rounded-xl border border-amber-300 bg-gradient-to-b from-amber-500 to-amber-700 px-4 py-4 text-base font-bold text-white shadow-[0_2px_0_rgba(255,255,255,0.25)_inset,0_4px_10px_rgba(0,0,0,0.5)] transition hover:from-amber-400 active:translate-y-px active:shadow-none">
                      <LockKeyhole className="h-7 w-7 shrink-0" />
                      <span>Tagesabschlussbuchung vornehmen</span>
                    </button>
                  </>
                )}
              </nav>
            </div>
          )}
        </>
      )}

      {showPhonePair && store.activeSession && currentStaff && (
        <PhonePairDialog session={store.activeSession} staff={currentStaff}
          pfandAmount={store.pfandSettings[store.activeSession.location]}
          onClose={() => setShowPhonePair(false)} onPairedChange={setPhonePaired} />
      )}

      {/* Test mode banner */}
      {!homeVisible && testMode && (
        <div className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-1.5 text-center text-xs font-medium text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          Testmodus aktiv — Artikel, Warengruppen und Bilder werden gespeichert und in den aktiven Modus übernommen. Nur Verkäufe und Kassenabschlüsse werden nicht gespeichert.
        </div>
      )}

      {/* Content */}
      <main ref={node => { if (node) node.inert = startupActive; }} className="min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
        {homeVisible && (
          <WoodmoHome
            onCash={() => {
              navigateTo('pos');
              // The Home tile must reopen the existing login/opening flow even
              // after the operator previously chose "Zur Startseite".
              if (!store.activeSession || !currentStaff) setCashierLoginRequest((n) => n + 1);
            }}
            onAdmin={() => openManagementFromCashOpening(currentStaff?.role === 'administrator' ? currentStaff : null)}
            sessionOpen={Boolean(store.activeSession)}
            location={store.activeSession?.location ?? store.selectedLocation}
            status={!online || catalog.syncStatus === 'error' ? 'error' : !testMode && catalog.syncStatus !== 'saved' ? 'pending' : 'ok'}
            testMode={testMode}
            onSetup={canOpenSetup ? () => setDeviceSetupOpen(true) : undefined}
            updateWaiting={candidate?.version}
            onUpdate={!currentStaff ? () => void openUpdateFromHome() : undefined}
          />
        )}
        {posVisited && (
          <div className={homeVisible || tab !== 'pos' ? 'hidden' : 'h-full min-h-0'}>
          <POSScreen
            shotOptions={store.shotOptions}
            categories={store.categories}
            products={store.products}
            activeSession={store.activeSession}
            transactions={store.transactions}
            onCheckout={async (transactions) => {
              const session = store.activeSession;
              const employee = currentStaff;
              if (!employee || !session || session.closed) throw new Error('Keine aktive Kasse oder Mitarbeiteranmeldung. Buchung nicht ausgefuehrt.');
              if (transactions.length === 0) throw new Error('Leerer Bon. Buchung nicht ausgefuehrt.');
              const booked = transactions.map((tx) => ({ ...tx, cashSessionId: session.id, employeeId: employee.id, employeeName: employee.name }));
              // Only a durable IndexedDB receipt may be reported as booked. A card
              // sale with cash Pfand payout writes both receipts in ONE IndexedDB
              // transaction: either both are booked or none.
              if (!testMode) {
                await enqueueEntries(booked.map((entry) => ({ table: 'pos_transactions' as const, row: {
                  id: entry.id, booking_generation: knownBookingReset().generation,
                  location: entry.location, timestamp: entry.timestamp, data: entry,
                } })));
              }
              booked.forEach((entry, index) => {
                store.addTransaction(entry);
                store.recordStaffActivity(session.id, { id: `activity-${Date.now().toString(36)}-${index}`, type: 'sale', staffId: employee.id, staffName: employee.name, timestamp: entry.timestamp, amount: entry.total });
              });
              return testMode ? 'test' : online && navigator.onLine ? 'queued-online' : 'queued-offline';
            }}
            onOpenCash={async (location, balance) => {
              if (!currentStaff) return false;
              // Offline openings stay local until reconnection. If another
              // device opened the same till while offline, the database must
              // reject the collision rather than silently merge cash books.
              if (testMode || !online) {
                store.openCashSession(location, balance, currentStaff);
                return true;
              }
              if (!supabase) throw new Error('Die V3-Cloud ist nicht konfiguriert.');
              // Check the relevant till before creating another session.
              // An unfinished till remains open across midnight.
              const { data, error } = await supabase.from('pos_cash_sessions')
                .select('data')
                .eq('booking_generation', knownBookingReset().generation)
                .eq('location', location)
                .eq('data->>closed', 'false');
              if (error) throw new Error(`Kassenstatus konnte nicht geprüft werden: ${error.message}`);
              const existing = (data ?? []).map((item) => item.data as CashSession)
                .find((session) => !session.closed && !session.discarded && !session.closedAt &&
                  !session.dailyCloseFinalizedAt && !session.dailyCloseSnapshot);
              if (existing) {
                // Adopt the confirmed cloud session in local state without
                // modifying either cloud cash register or its history.
                store.mergeCloudData({ generation: knownBookingReset().generation,
                  transactions: [], cashSessions: [existing], newestTransactionTimestamp: null });
                store.switchLocation(location);
                throw new Error(`In ${location} ist bereits eine Kasse geöffnet. Sie wird übernommen. Bitte mit deinem Mitarbeiterkonto erneut anmelden, statt eine zweite Kasse zu eröffnen.`);
              }
              store.openCashSession(location, balance, currentStaff);
              return true;
            }}
            onCorrectOpening={(amt, reason) => {
              if (store.activeSession && currentStaff) store.correctOpeningBalance(store.activeSession.id, amt, reason, currentStaff);
            }}
            onCashEntry={(type, amt, reason, isPfandRetoure = false) => {
              if (store.activeSession && currentStaff) store.addCashEntry(store.activeSession.id, type, amt, reason, isPfandRetoure, currentStaff, stornoLedger.records);
            }}
            onCloseCash={async (bal, closingWithdrawalAmount, countDifferenceReason) => {
              const session = store.activeSession;
              if (!session || !currentStaff) return { ok: false, error: 'Es ist keine aktive Kasse oder kein angemeldeter Mitarbeiter vorhanden.' };
              if (testMode) {
                // Test mode is a simulation only: no Cloud receipt number,
                // final Cloud write, or official persisted close/PDF.
                store.closeCashSession(session.id, bal, currentStaff, closingWithdrawalAmount, undefined, stornoLedger.records);
                return { ok: true, receiptLabel: 'Testmodus (ohne Belegnummer)', synced: false };
              }
              if (!online || !navigator.onLine) {
                return { ok: false, error: 'Keine Internetverbindung: Der Tagesabschluss wurde NICHT gebucht – die Abschlussnummer kommt aus der Cloud. Bitte stelle die Internetverbindung der App wieder her und schließe dann erneut ab. Die Kasse bleibt bis dahin offen, es geht nichts verloren.' };
              }
              if (stornoLedger.status !== 'ready') {
                return { ok: false, error: 'Stornojournal nicht sicher synchronisiert. Vor endgültigem Tagesabschluss zuerst Cloud und Stornobelege prüfen.' };
              }
              // Ask Android for folder access NOW, while the tap is active;
              // the PDF is saved only after the cloud steps below.
              const archiveAccess = requestArchiveAccess();
              const finalizedAt = Date.now();
              const finalizedIntervals = (session.staffLoginIntervals ?? []).map((interval) => interval.logoutAt ? interval : { ...interval, logoutAt: finalizedAt });
              try {
                await archiveAccess;
                const sync = await syncEverything();
                if (!sync.ok) throw new Error(sync.error ?? 'Kassensitzung konnte nicht mit der Cloud abgeglichen werden.');
                // A final close without the cloud-wide, immutable receipt
                // number is not allowed. The RPC is idempotent per session.
                const receipt = await issueDailyCloseReceipt(session.id, currentStaff.name, session.location, finalizedAt);
                // Freeze ALL receipts and reversals of this session. Last-five
                // selection is NOT a retention limit. The server will refuse a
                // closed session whose storno list no longer matches the DB.
                const verifiedStornos = await stornoLedger.refresh();
                const frozen = prepareFinalCloseStornoSnapshot(
                  store.transactions, verifiedStornos, session, finalizedAt,
                );
                const snapshot = {
                  ...frozen,
                  finalizedAt, finalizedById: currentStaff.id, finalizedByName: currentStaff.name,
                  staffLoginIntervals: finalizedIntervals,
                };
                const closed = buildFinalizedCashSession(
                  session, store.transactions, bal, currentStaff, closingWithdrawalAmount,
                  { closedAt: finalizedAt, receipt, snapshot, countDifferenceReason },
                );
                // An issued receipt number alone does NOT mean the close is saved.
                // First store and read back the closed snapshot in Supabase;
                // only then reflect the irreversible result in the local UI.
                await persistFinalizedCashSession(closed);
                store.commitFinalizedSession(closed);
                const closeReport = closedSessionReport(closed, store.transactions, store.categories, currentStaff.name, verifiedStornos);
                try {
                  // Without an active folder permission, a button lets the
                  // user save with a fresh tap instead of a system alert.
                  if (await saveJournalPdfIfAllowed(closeReport) === 'needs-tap') setPendingClosePdf(closeReport);
                } catch (pdfError) {
                  console.warn('Kasse abgeschlossen; PDF-Export fehlgeschlagen.', pdfError);
                  setPendingClosePdf(closeReport);
                }
                // persistFinalizedCashSession hat den Abschluss in der Cloud gespeichert UND zurückgelesen:
                // „Synchronisiert“ ist damit bestätigt. Die Belegnummer ist je Kasse eindeutig (idempotent).
                return { ok: true, synced: true, receiptLabel: formatDailyCloseReceiptNumber(closed.dailyCloseReceiptNumber, closed.dailyCloseReceiptLocation ?? closed.location, finalizedAt, closed.dailyCloseReceiptYear) ?? undefined };
              } catch (error) {
                console.warn('Tagesabschluss ohne Belegnummer abgelehnt.', error);
                return { ok: false, error: `Tagesabschluss konnte nicht sicher bestätigt werden: ${readableSyncError(error)} Bitte vor weiteren Buchungen den Cloud-Status prüfen und erneut synchronisieren; keine zweite Abschlussbuchung erzwingen.` };
              }
            }}
            stornos={stornoLedger.records}
            stornoStatus={stornoLedger.status}
            stornoError={stornoLedger.errorMessage || stornoLedger.serviceError}
            stornoServiceReady={stornoLedger.serviceReady}
            testMode={testMode}
            onCommitStorno={commitBonStorno}
            onMoveProduct={(sourceId, targetId) => store.moveProductTo(sourceId, targetId)}
            headerAction={headerAction}
            onHeaderActionConsumed={() => setHeaderAction(null)}
            loginRequest={cashierLoginRequest}
            selectedLocation={store.selectedLocation}
            pfandSettings={store.pfandSettings}
            staffUsers={staff.users}
            currentStaff={currentStaff}
            online={online}
            onStaffAuthenticated={handleStaffAuthenticated}
            onSetInitialCredentials={staff.setInitialCredentials}
            onConfigureStaffSecurity={staff.configureSecurity}
            onResetStaffPassword={staff.resetPassword}
            lastStaffId={lastStaffId}
            onDiscardEmptySession={discardUnusedSession}
            onHome={goHome}
            openingBalanceSuggestions={openingBalanceSuggestions}
            openingBalanceDates={openingBalanceDates}
            openSessionsByLocation={openSessionsByLocation}
            onContinueSessionAt={continueOpenSessionAt}
          />
          </div>
        )}
        {!homeVisible && tab === 'admin' && (
          adminUnlocked ? (
            <AdminScreen
              menuOpen={menuOpen}
              onOpenMenu={() => setMenuOpen(true)}
              onCloseMenu={() => setMenuOpen(false)}
              onOpenJournal={() => navigateToProtected('journal')}
              onAdminSectionChange={setAdminSection}
              onShotDraftDirtyChange={setAdminShotDirty}
              onPrepareCatalogImport={catalog.prepareImport}
              onCommitCatalogImport={catalog.commitImport}
              shotOptions={store.shotOptions}
              onUpdateShotOptions={store.updateShotOptions}
              categories={store.categories}
              products={store.products}
              transactions={store.transactions}
              stornos={stornoLedger.records}
              cashSessions={store.cashSessions}
              activeSession={store.activeSession}
              selectedLocation={store.selectedLocation}
              onSwitchLocation={store.switchLocation}
              // 24.11.: Ausgewählte Kasse aus der Kassen-Übersicht bedienen (bestehender Ablauf wie Kachel „Kasse“).
              onOpenCash={() => {
                navigateTo('pos');
                if (!store.activeSession || !currentStaff) setCashierLoginRequest((n) => n + 1);
              }}
              onAddCategory={store.addCategory}
              onUpdateCategory={store.updateCategory}
              onDeleteCategory={store.deleteCategory}
              onReorderCategory={store.reorderCategory}
              onMoveCategoryTo={store.moveCategoryTo}
              onAddProduct={store.addProduct}
              onUpdateProduct={store.updateProduct}
              onDeleteProduct={store.deleteProduct}
              onReorderProduct={store.reorderProduct}
              onMoveProductTo={store.moveProductTo}
              resetQuarantineCount={resetArchive?.archivedEntries ?? 0}
              onExportResetQuarantine={async () => {
                try { setExportedQuarantineKeys(await exportResetQuarantine()); }
                catch (error) { alert(error instanceof Error ? error.message : 'Sicherheitsarchiv-Export fehlgeschlagen.'); }
              }}
              onClearResetQuarantine={async () => {
                const summary = resetArchive;
                if (summary && (summary.pendingReceipts > 0 || summary.pendingSessions > 0)) {
                  alert('Löschen gesperrt: Das Sicherheitsarchiv enthält nicht übertragene Bons oder Kassensitzungen. Diese zuerst prüfen lassen.');
                  return;
                }
                if (!exportedQuarantineKeys) {
                  alert('Bitte zuerst „Sicherheitsarchiv sichern“ ausführen und die Datei aufbewahren. Danach kann gelöscht werden.');
                  return;
                }
                if (!window.confirm('Sicherheitsarchiv auf diesem Gerät endgültig löschen?\n\n' +
                  'Gelöscht werden nur die archivierten Altstände vor einem Reset (diese liegen weiterhin in der Cloud). ' +
                  'Laufende Kassen, aktuelle Buchungen und noch nicht übertragene Buchungen bleiben unberührt.')) return;
                try {
                  await clearResetQuarantine(exportedQuarantineKeys);
                  setExportedQuarantineKeys(null);
                } catch (error) {
                  alert(error instanceof Error ? error.message : 'Sicherheitsarchiv konnte nicht gelöscht werden.');
                }
              }}
              onCheckResetSafety={checkResetSafety}
              onResetAllData={resetBookings}
              onDeviceSetup={() => setDeviceSetupOpen(true)}
              pfandSettings={store.pfandSettings}
              onUpdatePfandSettings={savePfandAndVerify}
              getProductPfand={store.getProductPfand}
              staffUsers={staff.users}
              staffOnline={online}
              onCreateStaff={staff.create}
              onUpdateStaff={staff.update}
              onSetStaffPassword={staff.setPassword}
              onDeleteStaff={staff.remove}
              currentStaff={currentStaff}
              onChangeManagerPassword={(currentPassword, nextPassword) => changeManagerPassword(currentPassword, nextPassword, staff.users.some((user) => user.role === 'administrator' && user.active && !!user.passwordHash))}
              administratorTools={managementAdministrator ? <><ManagerPasswordPanel online={online} hasAdministrator={staff.users.some((user) => user.role === 'administrator' && user.active && !!user.passwordHash)} onChange={(currentPassword, nextPassword) => changeManagerPassword(currentPassword, nextPassword, true)} /><CloudPasswordPanel onChanged={() => { saveJSON(STORAGE_KEYS.rootPasswordChanged, true); saveJSON(STORAGE_KEYS.rootPasswordNoticeDismissed, true); }} /></> : undefined}
              testMode={testMode}
              onToggleMode={() => setModeConfirm(testMode ? 'to-active' : 'to-test')}
              onExportBackup={async () => {
                try {
                // Folder access must be requested while the tap is still active.
                const backupTarget = await prepareBackupTarget();
                // The download must reflect the confirmed V3 Cloud ledger,
                // not just this browser's potentially stale local snapshot.
                if (testMode) throw new Error('Eine vollständige Cloud-Sicherung ist nur im Aktivmodus möglich. Testbuchungen werden nicht als echte Buchungen gesichert.');
                if (!online || !navigator.onLine) throw new Error('Für die vollständige Sicherung ist eine aktive Cloud-Verbindung erforderlich.');
                const sync = await syncNow();
                if (!sync.ok) throw new Error('Backup abgebrochen: Synchronisierung unvollständig. ' + (sync.error || ''));
                const pending = await readPendingOutbox();
                if (pending.length) throw new Error('Backup abgebrochen: Noch nicht bestätigte lokale Buchungen vorhanden.');
                const reset = await fetchLatestBookingReset();
                const generation = reset?.generation ?? 0;
                const cloudBookings = await fetchCloudData(null, generation);
                const backedUpStornos = await loadCloudStornos(generation);
                // Verify the entire cloud ledger. Conflicts are shown, never saved silently.
                requireValidBackupIntegrity({
                  transactions: cloudBookings.transactions,
                  cashSessions: cloudBookings.cashSessions,
                  stornos: backedUpStornos,
                }, 'Backup-Export');
                const coreBackup = store.exportBackup();
                const cloudTransactionIds = new Set(cloudBookings.transactions.map(transaction => transaction.id));
                const cloudSessionIds = new Set(cloudBookings.cashSessions.map(session => session.id));
                if (store.transactions.some(transaction => !cloudTransactionIds.has(transaction.id)) ||
                    store.cashSessions.some(session => !cloudSessionIds.has(session.id))) {
                  throw new Error('Backup abgebrochen: Nicht alle lokalen Kassenbuchungen wurden in der Cloud gefunden. Bitte synchronisieren und erneut sichern.');
                }
                const recoveryMetadata = await exportRecoveryMetadata();
                // A second read detects changes while the backup is being
                // assembled on this device. Fail closed rather than download
                // a mixed-generation, internally inconsistent file.
                const latestAgain = await fetchLatestBookingReset();
                const verifiedBookings = await fetchCloudData(null, latestAgain?.generation ?? 0);
                const verifiedStornos = await loadCloudStornos(latestAgain?.generation ?? 0);
                const financialSignature = (data: unknown) => JSON.stringify(data);
                if ((latestAgain?.generation ?? 0) !== generation ||
                    financialSignature(verifiedBookings.transactions) !== financialSignature(cloudBookings.transactions) ||
                    financialSignature(verifiedBookings.cashSessions) !== financialSignature(cloudBookings.cashSessions) ||
                    financialSignature(verifiedStornos) !== financialSignature(backedUpStornos)) {
                  throw new Error('Backup abgebrochen: Die Kassenbuchungen haben sich während der Sicherung geändert. Bitte erneut sichern.');
                }
                // Passwords are stored only as protected proofs, not plain text.
                const payload: CompleteBackup = {
                  ...coreBackup,
                  version: CLOSE_ARCHIVE_BACKUP_VERSION,
                  data: {
                    ...coreBackup.data,
                    transactions: cloudBookings.transactions,
                    cashSessions: cloudBookings.cashSessions,
                    ...recoveryMetadata,
                    stornos: backedUpStornos,
                    staffUsers: staff.users,
                    managerCredential: loadManagerCredential(),
                    lastStaffId,
                    theme,
                    rootPasswordChanged: loadJSON(STORAGE_KEYS.rootPasswordChanged, false),
                    rootPasswordNoticeDismissed: loadJSON(STORAGE_KEYS.rootPasswordNoticeDismissed, false),
                  },
                };
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                const savedAs = await saveBackupFile(backupTarget, blob, `kasse-backup-${formatDateISO(Date.now())}.json`);
                if (backupTarget.mode === 'folder') {
                  alert(`Backup gespeichert: ${savedAs}`);
                }
                } catch (error) {
                  // Keep the existing error dialog and propagate failure to the
                  // reset checklist: a failed download must never become green.
                  alert(error instanceof Error ? error.message : 'Die vollständige Sicherung konnte nicht erstellt werden.');
                  throw error;
                }
              }}
              onImportBackup={async (file) => {
                let restoreSyncPaused = false;
                try {
                  if (testMode) throw new Error('Rücksicherung aktiver Cloud-Buchungen ist im Testmodus gesperrt. Bitte zum Aktivmodus wechseln.');
                   const text = await file.text();
                  const parsed = JSON.parse(text);
                  if (!parsed || typeof parsed !== 'object' || !parsed.data) {
                    alert('Ungültige Backup-Datei: Format nicht erkannt.');
                    return;
                  }

                  // Financial inconsistencies are rejected before any restore or cloud writes.
                   const selectedBackup = parsed as CompleteBackup;
                   const imported = selectedBackup.data!;
                   if (!Array.isArray(imported.transactions) || !Array.isArray(imported.cashSessions)) {
                     throw new Error('Backup enthält keine vollständigen Buchungs- und Kassensitzungslisten.');
                   }
                   requireValidBackupIntegrity({
                     transactions: imported.transactions,
                     cashSessions: imported.cashSessions,
                     stornos: imported.stornos ?? [],
                   }, 'Backup-Import');
                   await validateBackupCloseArchive(selectedBackup);

                   // Backup 1:1 gleich dem aktuellen Cloud-Stand → nichts zu tun (Wunsch 22.11.2026).
                   {
                     const current = await fetchLatestBookingReset();
                     const currentGeneration = current?.generation ?? 0;
                     const cloudNow = await fetchCloudData(null, currentGeneration);
                     const stornosNow = await loadCloudStornos(currentGeneration);
                     const byId = <T extends { id: string }>(rows: readonly T[]) =>
                       JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)));
                     if (cloudNow.transactions.length > 0 &&
                         byId(cloudNow.transactions) === byId(imported.transactions) &&
                         byId(cloudNow.cashSessions) === byId(imported.cashSessions) &&
                         byId(stornosNow) === byId(imported.stornos ?? [])) {
                       alert('Das Backup ist 1:1 identisch mit dem aktuellen Stand in der Cloud. Ein Import ist nicht nötig.');
                       return;
                     }
                     // Cloud hat Buchungen: ein Import ist erst nach dem Zurücksetzen möglich.
                     if (cloudNow.transactions.length > 0 || cloudNow.cashSessions.length > 0) {
                       const cloudIds = new Set(cloudNow.transactions.map(tx => tx.id));
                       const newer = imported.transactions.every(tx => cloudIds.has(tx.id)) &&
                         cloudNow.transactions.length > imported.transactions.length;
                       alert((newer
                         ? 'In der Cloud sind neuere Daten als in diesem Backup (' + cloudNow.transactions.length + ' statt ' + imported.transactions.length + ' Buchungen).'
                         : 'In der Cloud sind andere Buchungen als in diesem Backup.') +
                         '\n\nSo geht es:\n1. Zuerst das aktuelle Backup sichern (Backup exportieren).\n2. Buchungen zurücksetzen.\n3. Danach dieses Backup importieren.');
                       return;
                     }
                   }

                   // Der Wiederherstellungsdienst gleicht die Daten bereits
                  // gezielt mit der Cloud ab. Die normale Hintergrund-
                  // synchronisation darf dabei nicht parallel weitere
                  // Änderungen einreihen.
                  await pauseSyncForRestore();
                  restoreSyncPaused = true;
                   const restored = (await restoreToCleanGeneration(selectedBackup)) ??
                     (await restoreBackupSafely(selectedBackup));
                  // The Cloud remains authoritative for immutable storno
                  // records. Refresh before announcing recovery success.
                  await stornoLedger.refresh();
                  store.importBackup(restored);
                  staff.replaceLocal(restored.staffUsers);

                  const restoredData = restored.data;
                  if ('managerCredential' in restoredData) {
                    restoreManagerCredential((restoredData.managerCredential as ManagerCredential | null) ?? null);
                  }
                  // Ein eventuell noch lokaler Name darf nicht aus einer alten
                  // Sitzung in die gerade wiederhergestellten Daten hineinragen.
                  const restoredStaffId = typeof restoredData.lastStaffId === 'string' ? restoredData.lastStaffId : null;
                  saveJSON(STORAGE_KEYS.lastStaffId, restoredStaffId);
                  setLastStaffId(restoredStaffId);
                  if ('theme' in restoredData && typeof restoredData.theme === 'string') {
                    saveJSON(STORAGE_KEYS.theme, restoredData.theme);
                  }
                  if ('rootPasswordChanged' in restoredData) {
                    saveJSON(STORAGE_KEYS.rootPasswordChanged, Boolean(restoredData.rootPasswordChanged));
                  }
                  if ('rootPasswordNoticeDismissed' in restoredData) {
                    saveJSON(STORAGE_KEYS.rootPasswordNoticeDismissed, Boolean(restoredData.rootPasswordNoticeDismissed));
                  }

                  // Kein Seiten-Neuladen: Während der Cloud-Abgleich die
                  // wiederhergestellten Sitzungen übernimmt, würde dies die
                  // Kasseneröffnung mehrfach öffnen und schließen lassen.
                  // Der Nutzer bleibt deshalb stabil in der Verwaltung.
                  setCurrentStaff(null);
                  setManagementAdministrator(null);
                  setOpeningManagementAccess(null);
                  setAdminUnlocked(true);
                  setTab('admin');
                  alert('Backup sicher wiederhergestellt. Die Daten sind verfügbar; Sie bleiben in der Verwaltung.');
                } catch (error) {
                  alert(error instanceof Error ? error.message : 'Backup-Datei konnte nicht gelesen werden.');
                } finally {
                  if (restoreSyncPaused) {
                    resumeSyncAfterRestore();
                  }
                }
              }}
            />
          ) : (
            <AdminAccessGate
              onManagerSuccess={(administrator) => {
                const selectedAdministrator = openingManagementAccess?.kind === 'selected-administrator' ? openingManagementAccess.administrator : null;
                setManagementAdministrator(selectedAdministrator ?? administrator ?? null);
                setAdminUnlocked(true);
              }}
              onCancel={() => {
                setOpeningManagementAccess(null);
                setManagementAdministrator(null);
                setAdminUnlocked(false); resetJournalSelection();
                goHome();
              }}
              staffUsers={staff.users}
              title="Verwaltung"
              access={openingManagementAccess}
            />
          )
        )}
        {modeConfirm && (
          <ModeConfirmDialog
            toTestMode={modeConfirm === 'to-test'}
            onCancel={() => setModeConfirm(null)}
            onConfirm={applyModeChange}
          />
        )}
        {!homeVisible && tab === 'journal' && (
          adminUnlocked ? (
            <JournalScreen
              products={store.products}
              transactions={store.transactions}
              stornos={stornoLedger.records}
              categories={store.categories}
              cashSessions={store.cashSessions}
              defaultLocation={store.selectedLocation}
              currentStaff={currentStaff}
            />
          ) : (
            <AdminAccessGate onManagerSuccess={(administrator) => { setManagementAdministrator(administrator ?? null); setAdminUnlocked(true); }} onStaffLogin={() => setStaffAdminLoginOpen(true)} staffUsers={staff.users} title="Journal" />
          )
        )}
      </main>
      {syncedAt !== null && <SyncToast key={syncedAt} onClose={closeSyncToast} />}
      {syncOpen && <SyncDialog syncNow={syncEverything} onRecoverCashConflict={recoverUnusedLocalCashConflict} onClose={() => setSyncOpen(false)} />}
      {staffAdminLoginOpen && (
        <StaffLoginDialog
          users={staff.users}
          allowedRoles={['administrator']}
          online={online}
          title="Administrator anmelden"
          onAuthenticated={(administrator) => { setManagementAdministrator(administrator); setAdminUnlocked(true); setStaffAdminLoginOpen(false); }}
          onSetInitialCredentials={staff.setInitialCredentials}
          onConfigureSecurity={staff.configureSecurity}
          onResetPassword={staff.resetPassword}
          initialStaffId={lastStaffId}
          onCancel={() => setStaffAdminLoginOpen(false)}
        />
      )}
      {pendingClosePdf && <PendingClosePdfDialog report={pendingClosePdf} onDone={() => setPendingClosePdf(null)} />}
      {homeVisible && !currentStaff && updatePhase && updatePhase !== 'folder' && (candidate || updatePhase === 'reload') &&
        <InitialSyncDialog phase={updatePhase} version={candidate?.version} installedVersion={APP_VERSION}
          notes={candidate?.notes} ready={updateReady} registers={registerStatus} error={updateError} percent={syncPercent}
          onPrepare={() => { autoUpdate.current = true; void prepareUpdate(); }} onContinue={() => void continueUpdate()}
          onRetry={() => void syncBeforeUpdate()} onActivate={() => void finishUpdate()}
          onDismiss={() => { autoUpdate.current = false; updateDeferred.current = true; if (updatePhase === 'offer') remindLater(); setUpdatePhase(null); }} onReload={() => window.location.reload()} />}
      {canOpenSetup && (updatePhase === 'folder' || deviceSetupOpen) && <DeviceSetupDialog warning={pdfArchiveWarning}
        firstSetup={updatePhase === 'folder' || freshSetup}
        onContinue={() => void (freshSetup && updatePhase !== 'folder' ? syncAfterFreshSetup() : syncBeforeUpdate())}
        onComplete={() => {
          setPdfArchiveWarning(null);
          void backUpPendingOutbox().catch(() => undefined);
        }}
        onClose={() => {
          setPdfArchiveWarning(null);
          setDeviceSetupOpen(false);
          setFreshSetup(false);
          if (updatePhase === 'folder') setUpdatePhase('prepared');
        }} />}
      <InstallPrompt />
    </div>
  );
}

function readableSyncError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'object' && cause !== null) {
    const error = cause as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [error.message, error.details, error.hint, error.code]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
    if (parts.length > 0) return parts.join(' · ');
  }
  return String(cause);
}

function PendingClosePdfDialog({ report, onDone }: { report: JournalReportData; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await saveJournalPdfFromTap(report));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Das PDF konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" className="w-full max-w-md space-y-4 rounded-3xl border border-emerald-700/40 bg-white p-6 shadow-2xl dark:bg-slate-900">
        <h2 className="text-xl font-bold text-emerald-700 dark:text-emerald-400">✓ Tagesabschluss gespeichert</h2>
        {result ? <>
          <p className="text-sm text-slate-700 dark:text-slate-200">Das PDF wurde gespeichert {result}.</p>
          <button type="button" onClick={onDone} className="min-h-12 w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white">Fertig</button>
        </> : <>
          <p className="text-sm text-slate-700 dark:text-slate-200">Der Abschluss ist sicher in der Cloud. Jetzt noch das PDF auf diesem Tablet ablegen – bei der Frage des Tablets bitte „Zulassen“ tippen.</p>
          <button type="button" onClick={() => void save()} disabled={busy} className="min-h-12 w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Wird gespeichert …' : 'PDF jetzt speichern'}</button>
          <p className="text-xs text-slate-500 dark:text-slate-400">Die Kasse nicht erneut abschließen. Das PDF kann auch später im Journal erzeugt werden.</p>
          <button type="button" onClick={onDone} disabled={busy} className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-200">Später</button>
        </>}
        {error && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{error}</p>}
      </section>
    </div>
  );
}

function AdminAccessGate({ onManagerSuccess, onStaffLogin, onCancel, staffUsers, title, access = null }: { onManagerSuccess: (administrator?: StaffUser) => void; onStaffLogin?: () => void; onCancel?: () => void; staffUsers: StaffUser[]; title: string; access?: OpeningManagementAccess }) {
  const selectedAdministrator = access?.kind === 'selected-administrator' ? access.administrator : null;
  const managerOnly = access?.kind === 'manager-only';
  const employeeDenied = access?.kind === 'employee-denied';
  return <PasswordGate
    onSuccess={onManagerSuccess}
    onCancel={onCancel}
    onStaffLogin={employeeDenied || managerOnly ? undefined : onStaffLogin}
    administrators={selectedAdministrator ? [selectedAdministrator] : managerOnly || employeeDenied ? [] : staffUsers}
    allowManagerPassword={!employeeDenied}
    accessDenied={employeeDenied}
    title={title}
  />;
}

function ModeConfirmDialog({ toTestMode, onCancel, onConfirm }: { toTestMode: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/50 p-4 sm:items-center" onClick={onCancel}>
      <div className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${toTestMode ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'}`}>
            {toTestMode ? <FlaskConical className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {toTestMode ? 'In Testmodus wechseln?' : 'In aktiven Modus wechseln?'}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Modus-Wechsel — Bestätigung erforderlich</p>
          </div>
        </div>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
          {toTestMode ? (
            <>Im Testmodus können Sie die App <strong>vollständig ausprobieren</strong>: Artikel anlegen, Bilder hochladen, Warengruppen verwalten, Verkäufe und Kassenabschlüsse durchführen. <strong>Artikel, Warengruppen und Bilder werden gespeichert</strong> und automatisch in den aktiven Modus übernommen. <strong>Nur Verkäufe und Kassenabschlüsse werden nicht gespeichert</strong> — diese bleiben nur in der aktuellen Sitzung, damit keine Test-Buchungen im realen Betrieb auftauchen.</>
          ) : (
            <>Im aktiven Modus werden <strong>alle Verkäufe, Kassenabschlüsse und Änderungen dauerhaft gespeichert</strong>. Die im Testmodus angelegten Artikel, Warengruppen und Bilder bleiben erhalten und stehen voll funktionsfähig zur Verfügung. Die App wird neu geladen, danach ist der produktive Betrieb aktiv.</>
          )}
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
            Abbrechen
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition active:scale-95 ${toTestMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}`}
          >
            {toTestMode ? 'Testmodus aktivieren' : 'Aktiven Modus aktivieren'}
          </button>
        </div>
      </div>
    </div>
  );
}
