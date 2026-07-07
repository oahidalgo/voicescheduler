-- VoiceScheduler — fase 1: Row Level Security
-- RN-001: ninguna consulta cruza tenants salvo el admin de plataforma.
-- El aislamiento vive en el motor: un bug de query no puede saltárselo.

-- security definer: leen public.users saltando su propia RLS
create or replace function public.current_tenant_id()
returns uuid language sql stable security definer
set search_path = public as
$$ select tenant_id from public.users where id = auth.uid() $$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer
set search_path = public as
$$ select exists (select 1 from public.users where id = auth.uid() and role = 'platform_admin') $$;

alter table public.tenants enable row level security;
alter table public.industry_templates enable row level security;
alter table public.users enable row level security;
alter table public.tenant_config_versions enable row level security;
alter table public.patients enable row level security;
alter table public.series enable row level security;
alter table public.appointments enable row level security;
alter table public.calendar_exceptions enable row level security;
alter table public.voice_commands enable row level security;
alter table public.scheduled_notifications enable row level security;
alter table public.notifications_log enable row level security;
alter table public.audit_log enable row level security;

create policy tenants_isolation on public.tenants
  for select using (id = public.current_tenant_id() or public.is_platform_admin());

-- las plantillas son datos públicos para usuarios autenticados (RN-141)
create policy templates_read on public.industry_templates
  for select to authenticated using (true);

create policy users_isolation on public.users
  for select using (
    id = auth.uid() or tenant_id = public.current_tenant_id() or public.is_platform_admin()
  );

create policy config_isolation on public.tenant_config_versions
  for all
  using (tenant_id = public.current_tenant_id() or public.is_platform_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_platform_admin());

create policy patients_isolation on public.patients
  for all
  using (tenant_id = public.current_tenant_id() or public.is_platform_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_platform_admin());

create policy series_isolation on public.series
  for all
  using (tenant_id = public.current_tenant_id() or public.is_platform_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_platform_admin());

create policy appointments_isolation on public.appointments
  for all
  using (tenant_id = public.current_tenant_id() or public.is_platform_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_platform_admin());

create policy exceptions_isolation on public.calendar_exceptions
  for all
  using (tenant_id = public.current_tenant_id() or public.is_platform_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_platform_admin());

create policy voice_commands_isolation on public.voice_commands
  for all
  using (tenant_id = public.current_tenant_id() or public.is_platform_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_platform_admin());

create policy scheduled_notifications_isolation on public.scheduled_notifications
  for all
  using (tenant_id = public.current_tenant_id() or public.is_platform_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_platform_admin());

create policy notifications_log_isolation on public.notifications_log
  for all
  using (tenant_id = public.current_tenant_id() or public.is_platform_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_platform_admin());

-- la auditoría se escribe desde triggers en el contexto del usuario
create policy audit_read on public.audit_log
  for select using (tenant_id = public.current_tenant_id() or public.is_platform_admin());
create policy audit_insert on public.audit_log
  for insert with check (tenant_id = public.current_tenant_id() or public.is_platform_admin());
