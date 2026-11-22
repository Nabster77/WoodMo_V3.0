import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const testUrl = 'https://qpoafsvsnrwfpvlizkpq.supabase.co';
if (process.env.GITHUB_REPOSITORY !== 'TESTwoodmo/testwoodmo.github.io' ||
    process.env.VITE_DEPLOY_BASE !== '/' || process.env.VITE_SUPABASE_URL !== testUrl ||
    !process.env.VITE_SUPABASE_ANON_KEY || process.env.WOODMO_TEST_REPLAY !== '1') {
  throw new Error('Der Wiederholungstest ist ausschließlich für die getrennte WOODMO-Testumgebung vorgesehen.');
}

const out = resolve('dist');
const scratch = await mkdtemp(join(tmpdir(), 'woodmo-replay-'));
const notesPath = resolve('src/releaseNotes.json');
let originalNotes;
try {
  originalNotes = await readFile(notesPath, 'utf8');
  const target = JSON.parse(originalNotes);
  if (typeof target.version !== 'string' || !target.version) throw new Error('Die Zielversion fehlt.');
  const startingVersion = target.version + '-start';
  const build = directory => execFileSync(process.execPath,
    ['node_modules/vite/bin/vite.js', 'build', '--outDir', directory, '--emptyOutDir'], { stdio: 'inherit' });

  await writeFile(notesPath, JSON.stringify({ ...target, version: startingVersion, title: 'WOODMO ' + startingVersion }, null, 2));
  build(scratch);
  await writeFile(notesPath, originalNotes);
  build(out);

  const startingBuild = JSON.parse(await readFile(join(scratch, 'version.json'), 'utf8'));
  const release = JSON.parse(await readFile(join(out, 'version.json'), 'utf8'));
  if (release.version !== target.version || release.workerScript !== 'sw-release.js' ||
      Date.parse(release.builtAt) <= Date.parse(startingBuild.builtAt)) {
    throw new Error('Start- und Zielbuild konnten nicht eindeutig zugeordnet werden.');
  }

  await mkdir(join(out, 'assets'), { recursive: true });
  await cp(join(scratch, 'assets'), join(out, 'assets'), { recursive: true, force: false });
  const startingHtml = await readFile(join(scratch, 'index.html'), 'utf8');
  const releaseHtml = await readFile(join(out, 'index.html'), 'utf8');
  if (!startingHtml.includes('<head>') || !releaseHtml.includes('<head>')) throw new Error('HTML-Kopf fehlt.');
  await writeFile(join(out, 'update-test-start.html'), startingHtml.replace('<head>', `<head><script>
try { sessionStorage.removeItem('woodmo_approved_activation_v1'); } catch {}
history.replaceState(history.state, '', '/');
</script>`));
  await writeFile(join(out, 'index.html'), releaseHtml.replace('<head>', `<head><script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    if (!await navigator.serviceWorker.getRegistration('/')) {
      await navigator.serviceWorker.register('/sw-release.js', { scope: '/' });
    }
  });
}
</script>`));

  for (const file of ['sw.js', 'update-test.html']) {
    await copyFile(new URL('./test-replay/' + file, import.meta.url), join(out, file));
  }
} finally {
  if (originalNotes !== undefined) await writeFile(notesPath, originalNotes);
  await rm(scratch, { recursive: true, force: true });
}
