-- VoiceScheduler — fase 3: notificaciones Web Push + retención (RN-130..136, RN-153)
--
-- Requiere las extensiones pg_cron y pg_net (disponibles en Supabase).
-- Si re-ejecutas este archivo, elimina antes los jobs con:
--   select cron.unschedule(jobname) from cron.job where jobname like 'voicescheduler-%';

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Suscripciones Web Push del profesional (una por dispositivo/navegador)
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null references public.users(id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_isolation on public.push_subscriptions
  for all
  using (tenant_id = public.current_tenant_id() or public.is_platform_admin())
  with check (tenant_id = public.current_tenant_id() or public.is_platform_admin());

-- ── Job: disparar la edge function notify cada minuto ───────────────────────
-- Envía recordatorios vencidos (RN-131) y resúmenes de mañana/tarde (RN-132/133).
-- El Bearer es la anon key (pública); la función usa la service role internamente.
select cron.schedule(
  'voicescheduler-notify',
  '* * * * *',
  $job$
  select net.http_post(
    url     := 'https://cmswskiusxhekkjovwsm.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtc3dza2l1c3hoZWtram92d3NtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzODQ0OTksImV4cCI6MjA5ODk2MDQ5OX0.FL3xSWqPjD6b648UBBZuqbgNbAG77hLcgAPJIdEnCIA'
    ),
    body    := '{}'::jsonb
  );
  $job$
);

-- ── Jobs de retención (RN-153) — corren a las 08:00 UTC (02:00 en Guatemala) ─
select cron.schedule(
  'voicescheduler-retention-voice',
  '0 8 * * *',
  $job$ delete from public.voice_commands where created_at < now() - interval '30 days'; $job$
);

select cron.schedule(
  'voicescheduler-retention-notifs',
  '5 8 * * *',
  $job$ delete from public.notifications_log where sent_at < now() - interval '12 months'; $job$
);

select cron.schedule(
  'voicescheduler-retention-audit',
  '10 8 * * *',
  $job$ delete from public.audit_log where at < now() - interval '24 months'; $job$
);

select cron.schedule(
  'voicescheduler-retention-scheduled',
  '15 8 * * *',
  $job$ delete from public.scheduled_notifications where status <> 'pending' and created_at < now() - interval '30 days'; $job$
);
