-- VoiceScheduler — seeds
-- RN-141: la plantilla es datos. Debe mantenerse en sincronía con
-- physiotherapyTemplate en packages/core/src/config.ts (misma forma JSON).

insert into public.industry_templates (name, config) values (
  'physiotherapy',
  '{
    "timezone": "America/Guatemala",
    "workingHours": {
      "monday":    [{ "from": "09:00", "to": "17:00", "modes": ["in_clinic"] },
                    { "from": "17:00", "to": "21:00", "modes": ["home_visit"] }],
      "tuesday":   [{ "from": "09:00", "to": "17:00", "modes": ["in_clinic"] },
                    { "from": "17:00", "to": "21:00", "modes": ["home_visit"] }],
      "wednesday": [{ "from": "09:00", "to": "17:00", "modes": ["in_clinic"] },
                    { "from": "17:00", "to": "21:00", "modes": ["home_visit"] }],
      "thursday":  [{ "from": "09:00", "to": "17:00", "modes": ["in_clinic"] },
                    { "from": "17:00", "to": "21:00", "modes": ["home_visit"] }],
      "friday":    [{ "from": "09:00", "to": "17:00", "modes": ["in_clinic"] }],
      "saturday":  [],
      "sunday":    []
    },
    "slotGranularityMinutes": 60,
    "defaultDurationMinutes": 60,
    "minDurationMinutes": 30,
    "maxDurationMinutes": 120,
    "maxConcurrentAppointments": { "in_clinic": 4, "home_visit": 1 },
    "buffers": { "home_visit": { "bufferAfterMinutes": 30 } },
    "minAdvanceMinutes": 0,
    "maxAdvanceDays": 90,
    "defaultMode": "in_clinic",
    "notifications": {
      "morningNotificationTime": "07:00",
      "morningSessionUntil": "13:00",
      "afternoonNotificationTime": "13:30",
      "afternoonSessionFrom": "14:00",
      "reminderBeforeMinutes": 30
    }
  }'::jsonb
) on conflict (name) do update set config = excluded.config;

-- ── Alta del tenant fundador (ejecutar a mano, ajustando datos reales) ──────
-- V1: el admin de plataforma crea tenants manualmente (doc de reglas, §2).
--
-- 1. Crear el usuario en Supabase Auth (dashboard → Authentication → Add user)
--    y copiar su UUID.
--
-- 2. with t as (
--      insert into public.tenants (name, timezone, industry_template)
--      values ('Clínica de Fisioterapia', 'America/Guatemala', 'physiotherapy')
--      returning id
--    ),
--    u as (
--      insert into public.users (id, tenant_id, role, full_name)
--      select '<UUID-DE-AUTH>', t.id, 'owner', 'Nombre de la profesional' from t
--      returning id, tenant_id
--    )
--    insert into public.tenant_config_versions (tenant_id, version, config, created_by)
--    select u.tenant_id, 1, it.config, u.id
--    from u, public.industry_templates it
--    where it.name = 'physiotherapy';
