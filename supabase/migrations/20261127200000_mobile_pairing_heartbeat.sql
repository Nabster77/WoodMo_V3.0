-- 27.11.2026: Kassentablet meldet sich regelmäßig; ohne Meldung (App geschlossen) endet die Handy-Kopplung.
ALTER TABLE public.pos_mobile_pairings ADD COLUMN IF NOT EXISTS tablet_seen_at timestamptz;
