-- 27.11.2026: Handy-Kopplung (Pfand-Retoure) und mobile Administrator-Übersicht.
-- Nur die Edge Function woodmo-v3-mobile (Service-Rolle) liest und schreibt; keine Policies für Clients.
CREATE TABLE IF NOT EXISTS public.pos_mobile_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('pfand', 'admin')),
  code text,
  token_hash text NOT NULL UNIQUE,
  session_id text,
  location text,
  staff_id text,
  staff_name text,
  pfand_amount numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  code_expires_at timestamptz,
  claimed_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS pos_mobile_pairings_code ON public.pos_mobile_pairings (code) WHERE claimed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS pos_mobile_pairings_session ON public.pos_mobile_pairings (session_id);
ALTER TABLE public.pos_mobile_pairings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pos_mobile_attempts (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_mobile_attempts_key ON public.pos_mobile_attempts (key, at);
ALTER TABLE public.pos_mobile_attempts ENABLE ROW LEVEL SECURITY;
