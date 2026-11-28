-- 28.11.2026: Handy meldet sich regelmäßig; ohne Meldung (Browser geschlossen) zählt die Kopplung am Tablet nicht mehr.
ALTER TABLE public.pos_mobile_pairings ADD COLUMN IF NOT EXISTS phone_seen_at timestamptz;
-- Rollback: ALTER TABLE public.pos_mobile_pairings DROP COLUMN IF EXISTS phone_seen_at;
