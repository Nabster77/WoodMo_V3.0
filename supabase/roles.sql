-- NUR FUER DEN LOKALEN TESTSERVER (Supabase CLI). Die gehostete V3-Cloud fuehrt
-- diese Datei nie aus. Sie laeuft beim lokalen Start VOR den Migrationen.
--
-- Warum hier und nicht in seed.sql: Die Migration 20261106150000 bricht ab,
-- wenn der Anmeldebenutzer admin@kasse.local noch nicht existiert. seed.sql
-- laeuft aber erst NACH allen Migrationen. Deshalb wird der Benutzer hier
-- vorab angelegt (feste ID, auf die die Sicherheitsregeln verdrahtet sind).
-- Anmeldung in der App: Benutzer  Admin   Passwort  woodmo-test
DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE NOTICE 'auth.users noch nicht vorhanden - Testbenutzer wird in seed.sql angelegt.';
    RETURN;
  END IF;
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    '8461bbe1-9c6f-46c4-be41-dcbcc69f8be4',
    'authenticated', 'authenticated',
    'admin@kasse.local',
    extensions.crypt('woodmo-test', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(), now(),
    '', '', '', ''
  ) ON CONFLICT (id) DO NOTHING;
END $$;
