-- Befehle können „erzwungen“ werden (auch wenn das Gerät in Benutzung ist, aber nicht mitten im Verkauf).
-- Das Flag setzt nur der Diagnose-Dienst (service_role, nach Passwortprüfung); Geräte lesen es nur.
ALTER TABLE public.pos_device_diagnostics ADD COLUMN IF NOT EXISTS command_force boolean NOT NULL DEFAULT false;
