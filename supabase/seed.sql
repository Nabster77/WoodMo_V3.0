-- NUR FUER DEN LOKALEN TESTSERVER (Supabase CLI, `npx supabase start`).
-- Wird von der echten V3-Cloud NIE ausgefuehrt: Seed-Dateien laufen nur lokal
-- bzw. bei `supabase db reset`, nicht bei Migrationen in einem gehosteten Projekt.
--
-- Legt den Cloud-Anmeldebenutzer an, auf den die Sicherheitsregeln (RLS) der
-- Migrationen fest verdrahtet sind (auth.uid() = 8461bbe1-...).
-- Anmeldung in der App:  Benutzer  Admin   Passwort  woodmo-test
-- Verwaltungspasswort bleibt wie in den Migrationen: kasse

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

INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  '8461bbe1-9c6f-46c4-be41-dcbcc69f8be4',
  '8461bbe1-9c6f-46c4-be41-dcbcc69f8be4',
  jsonb_build_object(
    'sub', '8461bbe1-9c6f-46c4-be41-dcbcc69f8be4',
    'email', 'admin@kasse.local',
    'email_verified', true
  ),
  'email',
  now(), now(), now()
) ON CONFLICT DO NOTHING;
