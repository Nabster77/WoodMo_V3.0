-- Ordnerlisten vom Gerät abrufen (verschlüsselt, wie Dateien)
alter table public.pos_file_transfers add column if not exists kind text not null default 'file' check (kind in ('file','list'));
