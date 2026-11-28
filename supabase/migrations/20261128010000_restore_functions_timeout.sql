-- WOODMO V3: Import/Rücksicherung darf nicht an der Standard-Grenze (8 s) scheitern.
-- Nur Schutzgrenze gegen hängende Vorgänge; die App wartet auf das echte Ergebnis.
-- Funktionskörper bleiben unverändert (nur Konfiguration).
ALTER FUNCTION public.restore_pos_clean_backup_v3(jsonb,bigint,timestamptz) SET statement_timeout='1800s';
ALTER FUNCTION public.restore_pos_close_archive(jsonb,boolean) SET statement_timeout='1800s';
-- Rollback:
-- ALTER FUNCTION public.restore_pos_clean_backup_v3(jsonb,bigint,timestamptz) RESET statement_timeout;
-- ALTER FUNCTION public.restore_pos_close_archive(jsonb,boolean) RESET statement_timeout;
