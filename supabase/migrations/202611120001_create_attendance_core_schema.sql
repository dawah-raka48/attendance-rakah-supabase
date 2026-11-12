-- Initial schema for Attendance Rakah (Supabase)
create extension if not exists pgcrypto;

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique,
  full_name text not null,
  department text not null default 'غير محدد',
  device_user_id text unique,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.device_logs (
  id bigint generated always as identity primary key,
  event_hash text not null unique,
  device_user_id text not null,
  device_uid text,
  device_name text,
  punched_at timestamptz not null,
  device_status integer,
  punch_type integer,
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create index device_logs_user_time_idx on public.device_logs(device_user_id, punched_at desc);
create index device_logs_punched_at_idx on public.device_logs(punched_at desc);

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  attendance_date date not null,
  shift_code text not null check (shift_code in ('morning','evening')),
  first_punch timestamptz,
  last_punch timestamptz,
  punch_count integer not null default 0,
  late_minutes integer not null default 0 check (late_minutes >= 0),
  status text not null default 'pending' check (status in ('pending','present','late','absent','incomplete')),
  calculated_at timestamptz not null default now(),
  notes text,
  unique(employee_id, attendance_date, shift_code)
);
create index attendance_sessions_date_shift_idx on public.attendance_sessions(attendance_date, shift_code, status);
create index attendance_sessions_employee_date_idx on public.attendance_sessions(employee_id, attendance_date desc);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'viewer' check (role in ('owner','admin','hr','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shift_settings (
  shift_code text primary key check (shift_code in ('morning','evening')),
  shift_name text not null,
  start_time time not null,
  end_time time not null,
  grace_minutes integer not null default 5 check (grace_minutes between 0 and 60),
  early_arrival_minutes integer not null default 120 check (early_arrival_minutes between 0 and 360),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.shift_settings(shift_code,shift_name,start_time,end_time,grace_minutes,early_arrival_minutes)
values ('morning','الفترة الصباحية','09:00','11:30',5,120),
       ('evening','الفترة المسائية','16:00','21:00',5,120);

create table public.app_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings(setting_key,setting_value) values
 ('timezone','"Asia/Riyadh"'::jsonb),
 ('attendance_calculation','{"first_punch":"arrival","last_punch":"departure","debounce_minutes":5,"grace_minutes":5}'::jsonb);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_at_idx on public.audit_logs(created_at desc);

alter table public.employees enable row level security;
alter table public.device_logs enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.profiles enable row level security;
alter table public.shift_settings enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_logs enable row level security;

create policy "signed in users can read employees" on public.employees for select to authenticated using (true);
create policy "signed in users can manage employees" on public.employees for all to authenticated using (true) with check (true);
create policy "signed in users can read attendance" on public.attendance_sessions for select to authenticated using (true);
create policy "signed in users can manage attendance" on public.attendance_sessions for all to authenticated using (true) with check (true);
create policy "signed in users can read device logs" on public.device_logs for select to authenticated using (true);
create policy "signed in users can read shift settings" on public.shift_settings for select to authenticated using (true);
create policy "signed in users can manage shift settings" on public.shift_settings for all to authenticated using (true) with check (true);
create policy "signed in users can read app settings" on public.app_settings for select to authenticated using (true);
create policy "signed in users can manage app settings" on public.app_settings for all to authenticated using (true) with check (true);
create policy "users can read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "users can update own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "signed in users can read audit logs" on public.audit_logs for select to authenticated using (true);

grant select, insert, update, delete on public.employees to authenticated;
grant select on public.device_logs to authenticated;
grant select, insert, update, delete on public.attendance_sessions to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.shift_settings to authenticated;
grant select, insert, update on public.app_settings to authenticated;
grant select on public.audit_logs to authenticated;
