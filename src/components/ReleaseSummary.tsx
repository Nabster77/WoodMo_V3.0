import { APP_RELEASE_NOTES, APP_VERSION } from '@/lib/appVersion';

export function ReleaseSummary() {
  return (
    <section aria-label="Versionsinformationen" className="space-y-2 text-sm">
      <p className="font-semibold">Version {APP_VERSION}</p>
      <h3 className="font-semibold">Was ist neu?</h3>
      {APP_RELEASE_NOTES.length > 0
        ? <ul className="list-disc space-y-1 pl-5">{APP_RELEASE_NOTES.map(note => <li key={note}>{note}</li>)}</ul>
        : <p>Für diese Version sind keine Änderungen hinterlegt.</p>}
    </section>
  );
}
