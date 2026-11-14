# WOODMO Kassen-App V3.0

Eigenständige V3-Version der WOODMO Kasse (Friedrichshafen & Bregenz), getrennt von der laufenden V2.

| | V3.0 (dieses Repo) | V2 (nicht anfassen) |
|---|---|---|
| App | https://nabster77.github.io/WoodMo_V3.0/ | https://nabster77.github.io/holz-bar-kassen-appv2/ |
| Repo | `Nabster77/WoodMo_V3.0` | `Nabster77/holz-bar-kassen-appv2` |
| Supabase | `tulndunkpsynkbbebenf` | `fsztsmnxbffanyfbytnr` |

**Status:** Testbetrieb, keine echten Umsätze. Vor echtem Betrieb TSE (DE, § 146a AO) bzw. RKSV (AT) klären.

## Herkunft
Startstand = Branch `woodmo-v3-heimtest` aus `holz-bar-kassen-appv2` @ `619f642` (geprüft, inkl. PR #14–#16: Reset-Passwort über Edge Function `woodmo-v3-reset`, Rollenprüfung, Backup-Wiederherstellung mit mehreren Kassen je Standort).

## Veröffentlichung
- Push auf `main` → `.github/workflows/deploy-pages.yml` → Typecheck, alle Tests, Build → GitHub Pages.
- Der Workflow läuft nur in diesem Repo und bricht ab, wenn `VITE_SUPABASE_URL` nicht die V3-Datenbank ist.
- Benötigt: Repository-Variable `VITE_SUPABASE_URL` = `https://tulndunkpsynkbbebenf.supabase.co`, Secret `VITE_SUPABASE_ANON_KEY` (anon-Key des V3-Projekts).
- Supabase-Migrationen (`supabase/migrations`) und Edge Functions werden **nicht** automatisch eingespielt.

## Lokal starten (Windows)
```
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```
`.env.local` mit `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` anlegen (siehe `.env.example`).
