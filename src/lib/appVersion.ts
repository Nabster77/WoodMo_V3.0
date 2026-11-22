/** The build actually running on this device. */
export const APP_VERSION = typeof __WOODMO_BUILD__ === 'undefined' ? '3.0' : __WOODMO_BUILD__.version ?? '3.0';
export const APP_RELEASE_NOTES = typeof __WOODMO_BUILD__ === 'undefined' ? [] : __WOODMO_BUILD__.notes;

const BUILD_ID = typeof __WOODMO_BUILD__ === 'undefined' ? null : buildId(__WOODMO_BUILD__);
const ACTIVATION_KEY = 'woodmo_approved_activation_v1';
const LAST_ACTIVATED_VERSION = 'woodmo_last_activated_version_v1';
const APPROVAL_CACHE = 'woodmo-update-approval-v1';
const base = new URL(import.meta.env.BASE_URL, location.origin);

export interface PublishedUpdate extends WoodmoBuildInfo {
  version: string;
  files: string[];
  workerGuard: string;
  workerScript?: string;
}

function updateWorkerScript(update: PublishedUpdate): string {
  return base.origin === 'https://testwoodmo.github.io' && update.workerScript === 'sw-release.js'
    ? update.workerScript
    : 'sw.js';
}

function buildId(build: Pick<WoodmoBuildInfo, 'commit' | 'builtAt'>): string {
  return build.commit + ':' + build.builtAt;
}

export function approvedActivation(): string | null {
  try { return sessionStorage.getItem(ACTIVATION_KEY); }
  catch { return null; }
}

export function activationVerified(target: string): boolean {
  if (target !== BUILD_ID) return false;
  sessionStorage.removeItem(ACTIVATION_KEY);
  try { localStorage.setItem(LAST_ACTIVATED_VERSION, APP_VERSION); }
  catch { /* The running build still excludes itself from update offers. */ }
  void caches.open(APPROVAL_CACHE).then(cache => cache.delete(new URL('.woodmo-update-approval', base))).catch(() => undefined);
  return true;
}

export async function publishedUpdate(): Promise<PublishedUpdate | null> {
  if (!BUILD_ID) return null;
  const url = new URL('version.json', base);
  url.searchParams.set('check', String(Date.now()));
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Die Update-Prüfung meldet HTTP ' + response.status + '.');
  const build: Partial<PublishedUpdate> = await response.json();
  if (typeof build.commit !== 'string' || typeof build.builtAt !== 'string' ||
      !Number.isFinite(Date.parse(build.builtAt)) || typeof build.version !== 'string') {
    throw new Error('Die veröffentlichte App-Version konnte nicht geprüft werden.');
  }
  try {
    if (build.version === APP_VERSION && localStorage.getItem(LAST_ACTIVATED_VERSION) === APP_VERSION) return null;
  } catch { /* Use the build identity if storage is restricted. */ }
  if (buildId({ commit: build.commit, builtAt: build.builtAt }) === BUILD_ID ||
      Date.parse(build.builtAt) <= Date.parse(__WOODMO_BUILD__.builtAt)) return null;
  return build as PublishedUpdate;
}

export async function preparePublishedUpdate(candidate: PublishedUpdate): Promise<void> {
  const latest = await publishedUpdate();
  if (!latest || buildId(latest) !== buildId(candidate)) throw new Error('Die veröffentlichte Version hat sich geändert. Bitte erneut prüfen.');
  if (!Array.isArray(latest.files) || !latest.files.length ||
      !latest.files.every(file => typeof file === 'string' && /^[\w-][\w./-]*\.(js|css)$/.test(file) && !file.includes('..')) ||
      !/^woodmo-update-[\w-]+\.js$/.test(latest.workerGuard ?? '')) {
    throw new Error('Die Veröffentlichungsdateien dieser Version sind unvollständig.');
  }
  const fetchFile = async (file: string) => {
    const url = new URL(file, base);
    if (file === 'index.html') url.searchParams.set('woodmo-preflight', latest.commit);
    const response = await fetch(url, { cache: 'reload', signal: AbortSignal.timeout(15000) });
    if (!response.ok || (file !== 'index.html' && response.headers.get('content-type')?.includes('text/html'))) {
      throw new Error('Die Update-Datei ' + file + ' ist nicht verfügbar.');
    }
    return response;
  };
  const [worker, html] = await Promise.all([
    fetchFile(updateWorkerScript(latest)).then(response => response.text()),
    fetchFile('index.html').then(response => response.text()),
    ...[latest.workerGuard, ...latest.files].map(file => fetchFile(file).then(response => response.arrayBuffer())),
  ]);
  if (!worker.includes(latest.workerGuard) ||
      !latest.files.some(file => file.endsWith('.js') && html.includes(file)) ||
      !await navigator.serviceWorker?.getRegistration(base.href)) {
    throw new Error('Der Update-Dienst konnte dieser Version nicht zugeordnet werden.');
  }
}

export async function activatePublishedUpdate(candidate: PublishedUpdate): Promise<void> {
  const latest = await publishedUpdate();
  if (!latest || buildId(latest) !== buildId(candidate)) throw new Error('Eine andere Version wurde veröffentlicht. Bitte beginnen Sie mit der Update-Prüfung erneut.');
  const registration = await navigator.serviceWorker?.getRegistration(base.href);
  if (!registration?.active) throw new Error('Der Update-Dienst ist noch nicht bereit. Öffnen Sie die App erneut.');
  const build = buildId(candidate);
  const cache = await caches.open(APPROVAL_CACHE);
  const approval = new URL('.woodmo-update-approval', registration.scope);
  sessionStorage.setItem(ACTIVATION_KEY, build);

  const previousWorker = registration.active;
  let installing = registration.installing;
  const rememberInstalling = () => { installing = registration.installing ?? installing; };
  registration.addEventListener('updatefound', rememberInstalling);

  const waitForWorker = async (findWorker: () => ServiceWorker | null, timeoutMessage: string) => {
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      const worker = findWorker();
      if (worker) return worker;
      if (installing?.state === 'redundant') {
        throw new Error('Der Browser hat die Installation verworfen. Bitte schließen Sie weitere WOODMO-Fenster, falls welche geöffnet sind, und versuchen Sie es erneut.');
      }
      await new Promise(resolve => window.setTimeout(resolve, 200));
    }
    throw new Error(timeoutMessage);
  };

  const confirmWorker = (worker: ServiceWorker) => new Promise<boolean>(resolve => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => { channel.port1.close(); resolve(false); }, 4000);
    channel.port1.onmessage = event => {
      window.clearTimeout(timer);
      channel.port1.close();
      resolve(event.data === true);
    };
    worker.postMessage({ type: 'WOODMO_APPROVED_UPDATE', build }, [channel.port2]);
  });

  try {
    await cache.put(approval, new Response(build));
    if (await confirmWorker(previousWorker)) return;
    const script = new URL(updateWorkerScript(latest), base);
    if (previousWorker.scriptURL === script.href) {
      await registration.update();
    } else {
      await navigator.serviceWorker.register(script.href, { scope: registration.scope, updateViaCache: 'none' });
    }
    // Chromium can activate the replacement directly when the old worker controls no tabs.
    const worker = await waitForWorker(
      () => registration.waiting ?? (registration.active !== previousWorker && registration.active?.state === 'activated' ? registration.active : null),
      'Der Browser hat die neue Version noch nicht zur Aktivierung bereitgestellt. Bitte erneut versuchen.',
    );
    if (!await confirmWorker(worker)) throw new Error('Der Browser hat die Zielversion nicht bestätigt. Falls weitere WOODMO-Tabs geöffnet sind, schließen Sie diese und versuchen Sie es erneut.');
    await waitForWorker(
      () => worker.state === 'activated' ? worker : null,
      'Die neue Version wurde noch nicht aktiviert. Bitte erneut versuchen.',
    );
  } catch (error) {
    sessionStorage.removeItem(ACTIVATION_KEY);
    throw error;
  } finally {
    registration.removeEventListener('updatefound', rememberInstalling);
    await cache.delete(approval).catch(() => undefined);
  }
}
