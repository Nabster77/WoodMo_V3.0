-- WOODMO V3: Datei-Übertragung Gerät -> PC (Ende-zu-Ende verschlüsselt, nur kurz im Server, danach gelöscht).
create table if not exists public.pos_file_transfers (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  path text not null check (char_length(path) between 1 and 300),
  status text not null default 'requested' check (status in ('requested','uploaded','done','failed')),
  pc_key jsonb not null,
  device_key jsonb,
  size integer,
  error text check (error is null or char_length(error) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pos_file_transfers enable row level security;
revoke all on public.pos_file_transfers from anon, authenticated;
grant select on public.pos_file_transfers to authenticated;
grant update (status, device_key, size, error, updated_at) on public.pos_file_transfers to authenticated;
drop policy if exists pos_file_transfers_select on public.pos_file_transfers;
drop policy if exists pos_file_transfers_update on public.pos_file_transfers;
create policy pos_file_transfers_select on public.pos_file_transfers for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@kasse.local');
create policy pos_file_transfers_update on public.pos_file_transfers for update to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@kasse.local')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@kasse.local');
-- Anlegen (INSERT) und Löschen von Zeilen nur über die Edge Function (Passwortprüfung, Service-Rolle).

insert into storage.buckets (id, name, public, file_size_limit)
values ('diag-transfer', 'diag-transfer', false, 22000000)
on conflict (id) do update set public = false, file_size_limit = 22000000;

drop policy if exists diag_transfer_select on storage.objects;
drop policy if exists diag_transfer_insert on storage.objects;
drop policy if exists diag_transfer_delete on storage.objects;
create policy diag_transfer_select on storage.objects for select to authenticated
  using (bucket_id = 'diag-transfer' and lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@kasse.local');
create policy diag_transfer_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'diag-transfer' and lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@kasse.local');
create policy diag_transfer_delete on storage.objects for delete to authenticated
  using (bucket_id = 'diag-transfer' and lower(coalesce(auth.jwt() ->> 'email', '')) = 'admin@kasse.local');
