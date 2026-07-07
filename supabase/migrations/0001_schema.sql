-- VoiceScheduler — fase 1: esquema base
-- Convenciones: toda tabla de dominio lleva tenant_id (RN-001).
-- Los slots NO tienen tabla: se calculan (glosario del dominio).

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- unaccent no es immutable; este wrapper sí, para poder indexar (RN-122)
create or replace function public.f_unaccent(text)
returns text language sql immutable parallel safe as
$$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

create type public.user_role as enum ('owner', 'professional', 'assistant', 'platform_admin');
create type public.appointment_mode as enum ('in_clinic', 'home_visit', 'virtual');
create type public.appointment_status as enum ('scheduled', 'completed', 'no_show', 'cancelled');
create type public.payment_status as enum ('unpaid', 'paid');
create type public.exception_type as enum ('holiday', 'time_block', 'vacation', 'extended_hours');
create type public.created_via as enum ('voice', 'touch', 'portal');
create type public.notification_kind as enum ('reminder', 'morning_summary', 'afternoon_summary');
create type public.notification_status as enum ('pending', 'sent', 'failed', 'cancelled');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null,
  industry_template text not null default 'physiotherapy',
  created_at timestamptz not null default now()
);

-- RN-141: las plantillas de industria son datos, no código
create table public.industry_templates (
  name text primary key,
  config jsonb not null
);

-- RN-002: role existe desde V1. id = auth.users.id
create table public.users (
  id uuid primary key,
  tenant_id uuid references public.tenants(id),
  role public.user_role not null,
  full_name text not null,
  push_token text,
  created_at timestamptz not null default now(),
  check (role = 'platform_admin' or tenant_id is not null)
);

-- RN-140/143: configuración versionada, solo INSERT (nunca UPDATE)
create table public.tenant_config_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  version int not null,
  config jsonb not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, version)
);

-- security_invoker: la vista respeta la RLS del que consulta (PG15+)
create view public.tenant_current_config with (security_invoker = on) as
select distinct on (tenant_id) tenant_id, version, config
from public.tenant_config_versions
order by tenant_id, version desc;

-- RN-090: solo el nombre es obligatorio. RN-094: soft delete
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index patients_name_trgm on public.patients
  using gin (public.f_unaccent(lower(name)) extensions.gin_trgm_ops);
create index patients_tenant on public.patients (tenant_id) where deleted_at is null;

-- RN-070/073: serie semanal. weekdays en ISO (1 = lunes … 7 = domingo)
create table public.series (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  patient_id uuid not null references public.patients(id),
  professional_id uuid not null references public.users(id),
  weekdays int[] not null check (array_length(weekdays, 1) >= 1),
  start_time time not null,
  duration_min int not null check (duration_min > 0),
  mode public.appointment_mode not null,
  ends_by text not null check (ends_by in ('count', 'until')),
  end_sessions int,
  end_date date,
  created_at timestamptz not null default now(),
  check (
    (ends_by = 'count' and end_sessions is not null and end_sessions > 0)
    or (ends_by = 'until' and end_date is not null)
  )
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  patient_id uuid not null references public.patients(id),
  professional_id uuid not null references public.users(id),
  starts_at timestamptz not null,
  duration_min int not null check (duration_min > 0),
  mode public.appointment_mode not null,
  status public.appointment_status not null default 'scheduled',
  payment_status public.payment_status not null default 'unpaid',  -- RN-084
  series_id uuid references public.series(id),                      -- RN-072
  rescheduled_from_id uuid references public.appointments(id),      -- RN-081
  rescheduled_to_id uuid references public.appointments(id),
  cancellation_reason text,
  created_via public.created_via not null default 'touch',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index appointments_tenant_time on public.appointments (tenant_id, starts_at);
create index appointments_patient on public.appointments (patient_id);
create index appointments_series on public.appointments (series_id) where series_id is not null;

-- RN-060: excepciones de calendario
create table public.calendar_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  type public.exception_type not null,
  date_from date not null,
  date_to date,
  time_from time,
  time_to time,
  modes public.appointment_mode[],
  reason text,
  created_at timestamptz not null default now(),
  check (type <> 'vacation' or (date_to is not null and date_to >= date_from)),
  check (
    type not in ('time_block', 'extended_hours')
    or (time_from is not null and time_to is not null and time_from < time_to)
  )
);

create index calendar_exceptions_tenant on public.calendar_exceptions (tenant_id, date_from);

-- RN-153: retención 30 días (job pg_cron, ver README). RN-095: sin notas clínicas
create table public.voice_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null references public.users(id),
  transcript text not null,
  captured_at timestamptz not null,   -- RN-125: ancla de resolución de fechas
  intent jsonb,
  confidence numeric(3, 2),
  status text not null default 'received',
  created_at timestamptz not null default now()
);

create table public.scheduled_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  appointment_id uuid references public.appointments(id) on delete cascade,
  kind public.notification_kind not null,
  fire_at timestamptz not null,
  status public.notification_status not null default 'pending',
  created_at timestamptz not null default now()
);

create index scheduled_notifications_due on public.scheduled_notifications (fire_at)
  where status = 'pending';

-- RN-136/153: registro de envíos, retención 12 meses
create table public.notifications_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  kind public.notification_kind not null,
  payload_meta jsonb,   -- RN-135: solo nombre, hora, duración, modalidad
  status text not null,
  sent_at timestamptz not null default now()
);

-- RN-143/153: auditoría, retención 24 meses
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  actor_id uuid,
  action text not null,
  entity text,
  entity_id uuid,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

create index audit_log_tenant on public.audit_log (tenant_id, at);

-- ── Triggers ────────────────────────────────────────────────────────────────

-- RN-082: estados terminales inmutables. RN-086: payment_status siempre editable
create or replace function public.guard_appointment_update()
returns trigger language plpgsql as $$
begin
  if old.status in ('completed', 'no_show', 'cancelled') then
    if new.status is distinct from old.status
       or new.starts_at is distinct from old.starts_at
       or new.duration_min is distinct from old.duration_min
       or new.mode is distinct from old.mode
       or new.patient_id is distinct from old.patient_id then
      raise exception 'RN-082: el estado % es terminal; crea una nueva cita y registra nota de auditoría', old.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger appointments_guard
  before update on public.appointments
  for each row execute function public.guard_appointment_update();

-- RN-131: cancelar la cita cancela su recordatorio pendiente
create or replace function public.cancel_pending_reminders()
returns trigger language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status = 'scheduled' then
    update public.scheduled_notifications
    set status = 'cancelled'
    where appointment_id = new.id and status = 'pending';
  end if;
  return new;
end $$;

create trigger appointments_cancel_reminders
  after update on public.appointments
  for each row execute function public.cancel_pending_reminders();

-- RN-143: toda versión nueva de config queda auditada con el valor anterior
create or replace function public.audit_config_version()
returns trigger language plpgsql as $$
begin
  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, before, after)
  values (
    new.tenant_id,
    new.created_by,
    'config_version_created',
    'tenant_config_versions',
    new.id,
    (select config from public.tenant_config_versions
     where tenant_id = new.tenant_id and version = new.version - 1),
    new.config
  );
  return new;
end $$;

create trigger config_versions_audit
  after insert on public.tenant_config_versions
  for each row execute function public.audit_config_version();
