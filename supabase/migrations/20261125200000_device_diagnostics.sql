/*
# Geräte-Diagnose (Statusbericht, Fern-Einschalten, Befehle)

1. Summary
- Eine Zeile je Gerät. Das Gerät schreibt nur seinen Statusbericht (report) und Stammdaten.
- Der Modus ('off','ready','on') und Befehle (pending_command) werden nur über die Edge Function
  woodmo-v3-diagnostics gesetzt, die das Administrator- oder Verwaltungspasswort prüft.

2. Security
- Nur das gemeinsame Kassenkonto (admin@kasse.local) darf lesen/schreiben; anon hat nichts.
- Geräte dürfen den Modus nur auf 'off' oder 'ready' stellen, 'on' und Befehle nur service_role.
- Geräte dürfen pending_command nur löschen (auf NULL setzen).
- Keine Passwörter, Kundendaten oder Mitarbeiternamen im Bericht (App-Seite beschränkt Inhalt, Größe hier begrenzt).
- Löschen nur service_role.
*/
CREATE TABLE IF NOT EXISTS public.pos_device_diagnostics (
  device_id text PRIMARY KEY CHECK (char_length(device_id) BETWEEN 8 AND 64),
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 80),
  location text CHECK (location IS NULL OR char_length(location) <= 40),
  app_version text CHECK (app_version IS NULL OR char_length(app_version) <= 40),
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off','ready','on')),
  report jsonb CHECK (report IS NULL OR pg_column_size(report) <= 8192),
  reported_at timestamptz,
  pending_command text CHECK (pending_command IS NULL OR pending_command IN ('status','update-check','reload','update-install')),
  command_id text CHECK (command_id IS NULL OR char_length(command_id) <= 64),
  command_sent_at timestamptz,
  command_result text CHECK (command_result IS NULL OR char_length(command_result) <= 200),
  command_result_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_device_diagnostics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_device_diagnostics FROM anon, authenticated;
GRANT SELECT ON public.pos_device_diagnostics TO authenticated;
GRANT INSERT (device_id, label, location, app_version, report, reported_at, mode)
  ON public.pos_device_diagnostics TO authenticated;
GRANT UPDATE (label, location, app_version, report, reported_at, mode, pending_command, command_result, command_result_at)
  ON public.pos_device_diagnostics TO authenticated;

DROP POLICY IF EXISTS "cash_account_select_device_diagnostics" ON public.pos_device_diagnostics;
DROP POLICY IF EXISTS "cash_account_insert_device_diagnostics" ON public.pos_device_diagnostics;
DROP POLICY IF EXISTS "cash_account_update_device_diagnostics" ON public.pos_device_diagnostics;
CREATE POLICY "cash_account_select_device_diagnostics" ON public.pos_device_diagnostics FOR SELECT
  TO authenticated USING ((auth.jwt() ->> 'email') = 'admin@kasse.local');
CREATE POLICY "cash_account_insert_device_diagnostics" ON public.pos_device_diagnostics FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt() ->> 'email') = 'admin@kasse.local');
CREATE POLICY "cash_account_update_device_diagnostics" ON public.pos_device_diagnostics FOR UPDATE
  TO authenticated USING ((auth.jwt() ->> 'email') = 'admin@kasse.local')
  WITH CHECK ((auth.jwt() ->> 'email') = 'admin@kasse.local');

CREATE OR REPLACE FUNCTION public.guard_device_diagnostics()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $guard$
DECLARE
  v_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
BEGIN
  IF v_role = 'service_role' OR v_role IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.mode = 'on' OR NEW.pending_command IS NOT NULL THEN
      RAISE EXCEPTION 'Nur der Diagnose-Dienst darf Modus an oder Befehle setzen.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.mode IS DISTINCT FROM OLD.mode AND NEW.mode = 'on' THEN
    RAISE EXCEPTION 'Einschalten nur über den Diagnose-Dienst mit Passwort.' USING ERRCODE = '42501';
  END IF;
  IF NEW.pending_command IS NOT NULL AND NEW.pending_command IS DISTINCT FROM OLD.pending_command THEN
    RAISE EXCEPTION 'Befehle dürfen Geräte nur löschen, nicht setzen.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$guard$;
DROP TRIGGER IF EXISTS guard_device_diagnostics ON public.pos_device_diagnostics;
CREATE TRIGGER guard_device_diagnostics BEFORE INSERT OR UPDATE ON public.pos_device_diagnostics
  FOR EACH ROW EXECUTE FUNCTION public.guard_device_diagnostics();
GRANT ALL ON public.pos_device_diagnostics TO service_role;
