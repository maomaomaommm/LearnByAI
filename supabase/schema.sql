create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists courses (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  goal text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chapters (
  id uuid primary key,
  course_id uuid not null references courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  status text not null,
  order_index integer not null default 0,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists sections (
  id uuid primary key,
  chapter_id uuid not null references chapters(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  status text not null,
  order_index integer not null default 0,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists annotations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references courses(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  section_id uuid,
  selected_text text not null,
  question text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists annotation_messages (
  id uuid primary key,
  annotation_id uuid not null references annotations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists generation_jobs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references courses(id) on delete cascade,
  chapter_id uuid references chapters(id) on delete cascade,
  type text not null,
  status text not null,
  locked_by text,
  locked_until timestamptz,
  attempts integer not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists quality_reports (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  score integer not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists exports (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  format text not null,
  status text not null,
  file_name text,
  storage_path text,
  storage_provider text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists usage_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);

create table if not exists quota_reservations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

alter table profiles enable row level security;
alter table courses enable row level security;
alter table chapters enable row level security;
alter table sections enable row level security;
alter table annotations enable row level security;
alter table annotation_messages enable row level security;
alter table generation_jobs enable row level security;
alter table quality_reports enable row level security;
alter table exports enable row level security;
alter table usage_events enable row level security;
alter table quota_reservations enable row level security;

create policy "Users can read own profile" on profiles for select using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "Users can read own courses" on courses for select using (auth.uid() = user_id);
create policy "Users can read own chapters" on chapters for select using (auth.uid() = user_id);
create policy "Users can read own sections" on sections for select using (auth.uid() = user_id);
create policy "Users can read own annotations" on annotations for select using (auth.uid() = user_id);
create policy "Users can read own annotation messages" on annotation_messages for select using (auth.uid() = user_id);
create policy "Users can read own jobs" on generation_jobs for select using (auth.uid() = user_id);
create policy "Users can read own quality reports" on quality_reports for select using (auth.uid() = user_id);
create policy "Users can read own exports" on exports for select using (auth.uid() = user_id);
create policy "Users can read own usage" on usage_events for select using (auth.uid() = user_id);
create policy "Users can read own quota reservations" on quota_reservations for select using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.claim_generation_job(
  target_job_id uuid,
  worker_id text,
  lease_ms integer
)
returns table(payload jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.generation_jobs
  set
    locked_by = worker_id,
    locked_until = now() + (lease_ms * interval '1 millisecond'),
    attempts = attempts + 1,
    payload = jsonb_set(
      jsonb_set(
        jsonb_set(payload, '{lockedBy}', to_jsonb(worker_id), true),
        '{lockedUntil}',
        to_jsonb((now() + (lease_ms * interval '1 millisecond'))::text),
        true
      ),
      '{attempts}',
      to_jsonb(attempts + 1),
      true
    ),
    updated_at = now()
  where id = target_job_id
    and status in ('pending', 'queued', 'retrying')
    and (locked_until is null or locked_until <= now())
  returning generation_jobs.payload;
end;
$$;

create or replace function public.reserve_usage_quota(
  target_user_id uuid,
  target_action text,
  quota_limit integer,
  since_iso timestamptz,
  reservation_id uuid,
  reservation_ttl_ms integer default 600000
)
returns table(allowed boolean, used_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
begin
  perform pg_advisory_xact_lock(hashtext(target_user_id::text || ':' || target_action)::bigint);

  delete from public.quota_reservations
  where expires_at <= now();

  select
    (
      select count(*)
      from public.usage_events
      where user_id = target_user_id
        and action = target_action
        and created_at >= since_iso
    ) + (
      select count(*)
      from public.quota_reservations
      where user_id = target_user_id
        and action = target_action
        and created_at >= since_iso
    )
  into current_count;

  if current_count >= quota_limit then
    return query select false, current_count;
    return;
  end if;

  insert into public.quota_reservations (id, user_id, action, created_at, expires_at)
  values (
    reservation_id,
    target_user_id,
    target_action,
    now(),
    now() + (reservation_ttl_ms * interval '1 millisecond')
  );

  return query select true, current_count + 1;
end;
$$;

create or replace function public.commit_usage_quota_reservation(
  reservation_id uuid
)
returns table(id uuid, user_id uuid, action text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved record;
begin
  select *
  into reserved
  from public.quota_reservations
  where quota_reservations.id = reservation_id
  for update;

  if not found then
    return;
  end if;

  delete from public.quota_reservations
  where quota_reservations.id = reservation_id;

  return query
  insert into public.usage_events (id, user_id, action, created_at)
  values (reserved.id, reserved.user_id, reserved.action, now())
  returning usage_events.id, usage_events.user_id, usage_events.action, usage_events.created_at;
end;
$$;

create or replace function public.release_usage_quota_reservation(
  reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.quota_reservations
  where quota_reservations.id = reservation_id;

  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

create or replace function public.learnbyai_schema_version()
returns text
language sql
stable
as $$
  select 'learnbyai-beta-2026-06-07-03'::text;
$$;

revoke execute on function public.claim_generation_job(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.reserve_usage_quota(uuid, text, integer, timestamptz, uuid, integer) from public, anon, authenticated;
revoke execute on function public.commit_usage_quota_reservation(uuid) from public, anon, authenticated;
revoke execute on function public.release_usage_quota_reservation(uuid) from public, anon, authenticated;

grant execute on function public.claim_generation_job(uuid, text, integer) to service_role;
grant execute on function public.reserve_usage_quota(uuid, text, integer, timestamptz, uuid, integer) to service_role;
grant execute on function public.commit_usage_quota_reservation(uuid) to service_role;
grant execute on function public.release_usage_quota_reservation(uuid) to service_role;

create index if not exists generation_jobs_runnable_idx
  on generation_jobs (status, locked_until, created_at);

create index if not exists courses_user_created_idx
  on courses (user_id, created_at desc);

create index if not exists chapters_course_order_idx
  on chapters (course_id, order_index);

create index if not exists sections_chapter_order_idx
  on sections (chapter_id, order_index);

create index if not exists annotations_user_chapter_created_idx
  on annotations (user_id, chapter_id, created_at);

create index if not exists annotation_messages_annotation_created_idx
  on annotation_messages (annotation_id, created_at);

create index if not exists exports_user_course_created_idx
  on exports (user_id, course_id, created_at desc);

create index if not exists usage_events_user_action_created_idx
  on usage_events (user_id, action, created_at desc);

create index if not exists quota_reservations_user_action_expires_idx
  on quota_reservations (user_id, action, expires_at);

create index if not exists quality_reports_user_target_idx
  on quality_reports (user_id, target_type, target_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'learnbyai-exports',
  'learnbyai-exports',
  false,
  10485760,
  array['application/pdf', 'application/x-tex', 'text/plain', 'application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read own export objects" on storage.objects;
create policy "Users can read own export objects"
  on storage.objects for select
  using (
    bucket_id = 'learnbyai-exports'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
