-- Preserve finalized reports independently of the active booking generation.
create table public.pos_daily_close_archive (
  location text not null check (location in ('Bregenz', 'Friedrichshafen')),
  calendar_year integer not null check (calendar_year between 2000 and 9999),
  location_sequence bigint not null check (location_sequence > 0),
  session_id text not null unique,
  report jsonb not null,
  primary key (location, calendar_year, location_sequence)
);
alter table public.pos_daily_close_archive enable row level security;
revoke all on public.pos_daily_close_archive from public, anon, authenticated;

create function public.export_pos_close_archive(p_include_source boolean default true)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  -- Use the same administrator authorization as backup export on this project.
  perform public.export_pos_recovery_metadata();
  return (
    select coalesce(jsonb_agg(q.report order by q.location,q.calendar_year,q.location_sequence),'[]'::jsonb)
    from (
      select a.location,a.calendar_year,a.location_sequence,a.report
      from public.pos_daily_close_archive a
      union all
      select r.location,r.calendar_year,r.location_sequence,s.data
      from public.pos_daily_close_receipts r
      join public.pos_cash_sessions s on s.id=r.session_id
      where p_include_source and s.data->>'closed'='true'
        and jsonb_typeof(s.data->'dailyCloseSnapshot')='object'
        and not exists (
          select 1 from public.pos_daily_close_archive a
          where (a.location,a.calendar_year,a.location_sequence)=(r.location,r.calendar_year,r.location_sequence)
        )
      union all
      -- Older restores may have retained the report with a new session ID
      -- but without a corresponding receipt row.
      select s.location, (s.data->>'dailyCloseReceiptYear')::integer,
        (s.data->>'dailyCloseReceiptNumber')::bigint, s.data
      from public.pos_cash_sessions s
      where p_include_source and s.data->>'closed'='true'
        and s.data->>'discarded' is distinct from 'true'
        and jsonb_typeof(s.data->'dailyCloseSnapshot')='object'
        and s.data->>'dailyCloseReceiptYear' is not null
        and s.data->>'dailyCloseReceiptNumber' is not null
        and not exists (
          select 1 from public.pos_daily_close_archive a
          where a.location=s.location
            and a.calendar_year=(s.data->>'dailyCloseReceiptYear')::integer
            and a.location_sequence=(s.data->>'dailyCloseReceiptNumber')::bigint
        )
        and not exists (
          select 1 from public.pos_daily_close_receipts r
          where r.location=s.location
            and r.calendar_year=(s.data->>'dailyCloseReceiptYear')::integer
            and r.location_sequence=(s.data->>'dailyCloseReceiptNumber')::bigint
        )
    ) q
  );
end;
$$;

create function public.restore_pos_close_archive(p_reports jsonb, p_validate_only boolean)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v jsonb;
  existing jsonb;
  loc text;
  yr integer;
  seq bigint;
  sid text;
begin
  perform public.export_pos_recovery_metadata();
  if p_reports is null or jsonb_typeof(p_reports)<>'array' then
    raise exception 'Ungueltiges Tagesabschlussarchiv.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_reports) reports(report)
    group by report->>'id' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(p_reports) reports(report)
    group by report->>'location', (report->>'dailyCloseReceiptYear')::integer,
      (report->>'dailyCloseReceiptNumber')::bigint having count(*) > 1
  ) then
    raise exception 'Doppelte Belegnummer oder Kassensitzung im Archiv.';
  end if;
  lock table public.pos_daily_close_receipts in share row exclusive mode;
  lock table public.pos_daily_close_archive in share row exclusive mode;
  for v in select value from jsonb_array_elements(p_reports) loop
    loc := v->>'location';
    yr := (v->>'dailyCloseReceiptYear')::integer;
    seq := (v->>'dailyCloseReceiptNumber')::bigint;
    sid := v->>'id';
    if v->>'closed' is distinct from 'true'
       or v->>'discarded' = 'true'
       or jsonb_typeof(v->'dailyCloseSnapshot') is distinct from 'object'
       or jsonb_typeof(v->'dailyCloseSnapshot'->'transactions') is distinct from 'array'
       or v->>'dailyCloseFinalizedAt' is null
       or loc is null or loc not in ('Bregenz','Friedrichshafen')
       or (v->>'dailyCloseReceiptLocation' is not null and v->>'dailyCloseReceiptLocation' <> loc)
       or yr is null or yr not between 2000 and 9999
       or seq is null or seq < 1 or coalesce(sid,'')='' then
      raise exception 'Tagesabschluss ohne vollstaendige Belegdaten.';
    end if;
    if exists (
      select 1 from public.pos_daily_close_receipts r
      where ((r.location,r.calendar_year,r.location_sequence)=(loc,yr,seq) and r.session_id<>sid)
         or (r.session_id=sid and (r.location,r.calendar_year,r.location_sequence)<>(loc,yr,seq))
    ) then
      raise exception 'Belegnummer oder Sitzung ist bereits anders zugeordnet.';
    end if;
    if exists (
      select 1 from public.pos_daily_close_receipts r
      join public.pos_cash_sessions s on s.id=r.session_id
      where r.session_id=sid and s.data is distinct from v
    ) then
      raise exception 'Vorhandener Tagesabschluss weicht von der Sicherung ab.';
    end if;
    select a.report into existing from public.pos_daily_close_archive a
    where (a.location,a.calendar_year,a.location_sequence)=(loc,yr,seq);
    if found then
      if existing is distinct from v then
        raise exception 'Archivierter Tagesabschluss weicht von der Sicherung ab.';
      end if;
    elsif exists (select 1 from public.pos_daily_close_archive a where a.session_id=sid) then
      raise exception 'Archivierte Kassensitzung hat bereits eine andere Belegnummer.';
    elsif not p_validate_only then
      insert into public.pos_daily_close_archive values (loc,yr,seq,sid,v);
    end if;
  end loop;
  if p_validate_only then
    return jsonb_array_length(p_reports);
  end if;
  insert into public.pos_daily_close_receipt_counters(location,calendar_year,last_number)
  select location,calendar_year,max(location_sequence)
  from public.pos_daily_close_archive group by location,calendar_year
  on conflict (location,calendar_year) do update
    set last_number=greatest(public.pos_daily_close_receipt_counters.last_number,excluded.last_number);
  return jsonb_array_length(p_reports);
end;
$$;
revoke all on function public.export_pos_close_archive(boolean) from public, anon;
revoke all on function public.restore_pos_close_archive(jsonb,boolean) from public, anon;
grant execute on function public.export_pos_close_archive(boolean) to authenticated;
grant execute on function public.restore_pos_close_archive(jsonb,boolean) to authenticated;
