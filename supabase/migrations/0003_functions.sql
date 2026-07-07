-- VoiceScheduler — fase 1: funciones transaccionales (RPC)
--
-- Reparto de responsabilidades con @voicescheduler/core:
--   · La Edge Function ejecuta el core (horario laboral, excepciones RN-011/061,
--     slot-filling) ANTES de llamar aquí. Esas validaciones no son sensibles a
--     carreras: el horario no cambia en milisegundos.
--   · Este RPC garantiza los invariantes que SÍ son sensibles a concurrencia,
--     dentro de la transacción y bajo advisory lock: capacidad (RN-020/021/022,
--     RN-041) y límites temporales (RN-050/051). Es la única puerta de escritura
--     de citas, y deja listo el RN-173 de V2 (dos pacientes confirmando a la vez).

-- Valida capacidad con el mismo algoritmo que capacity.ts del core:
-- pico de solapamiento de intervalos extendidos por buffers, por modalidad.
create or replace function public._check_capacity(
  p_tenant_id uuid,
  p_starts_at timestamptz,
  p_duration_min int,
  p_mode public.appointment_mode,
  p_exclude_id uuid default null
) returns void
language plpgsql as $$
declare
  v_config jsonb;
  v_limit int;
  v_before int;
  v_after int;
  v_cand_start timestamptz;
  v_cand_end timestamptz;
  v_peak int;
begin
  select config into v_config
  from public.tenant_current_config where tenant_id = p_tenant_id;
  if v_config is null then
    raise exception 'RN-140: el tenant no tiene configuración';
  end if;

  v_limit := coalesce((v_config #>> array['maxConcurrentAppointments', p_mode::text])::int, 1);
  if p_mode = 'home_visit' then
    v_limit := least(v_limit, 1);   -- RN-022: tope duro
  end if;
  v_before := coalesce((v_config #>> array['buffers', p_mode::text, 'bufferBeforeMinutes'])::int, 0);
  v_after  := coalesce((v_config #>> array['buffers', p_mode::text, 'bufferAfterMinutes'])::int, 0);

  -- RN-041: rango extendido por buffers
  v_cand_start := p_starts_at - make_interval(mins => v_before);
  v_cand_end   := p_starts_at + make_interval(mins => p_duration_min + v_after);

  -- RN-021: pico de citas solapadas (no inicios simultáneos)
  with ivs as (
    select a.starts_at - make_interval(mins => v_before) as s,
           a.starts_at + make_interval(mins => a.duration_min + v_after) as e
    from public.appointments a
    where a.tenant_id = p_tenant_id
      and a.mode = p_mode
      and a.status = 'scheduled'
      and (p_exclude_id is null or a.id <> p_exclude_id)
      and a.starts_at - make_interval(mins => v_before) < v_cand_end
      and a.starts_at + make_interval(mins => a.duration_min + v_after) > v_cand_start
  ),
  pts as (
    select v_cand_start as p
    union all
    select s from ivs where s > v_cand_start and s < v_cand_end
  ),
  counts as (
    select 1 + (select count(*) from ivs where ivs.s <= pts.p and pts.p < ivs.e) as c
    from pts
  )
  select coalesce(max(c), 1) into v_peak from counts;

  if v_peak > v_limit then
    raise exception 'RN-020: capacidad excedida para % (pico % de %)', p_mode, v_peak, v_limit
      using errcode = 'P0001';
  end if;
end $$;

-- Límites temporales contra el reloj del servidor, en la timezone del tenant
create or replace function public._check_temporal_limits(
  p_tenant_id uuid,
  p_starts_at timestamptz
) returns void
language plpgsql as $$
declare
  v_config jsonb;
  v_tz text;
  v_min_advance int;
  v_max_days int;
begin
  select t.timezone, c.config into v_tz, v_config
  from public.tenants t
  join public.tenant_current_config c on c.tenant_id = t.id
  where t.id = p_tenant_id;

  -- RN-050: tolerancia de 5 minutos por desfase de reloj
  if p_starts_at < now() - interval '5 minutes' then
    raise exception 'RN-050: la cita inicia en el pasado' using errcode = 'P0001';
  end if;

  v_min_advance := coalesce((v_config ->> 'minAdvanceMinutes')::int, 0);
  if v_min_advance > 0 and p_starts_at < now() + make_interval(mins => v_min_advance) then
    raise exception 'RN-051: no cumple la anticipación mínima' using errcode = 'P0001';
  end if;

  v_max_days := coalesce((v_config ->> 'maxAdvanceDays')::int, 90);
  if (p_starts_at at time zone v_tz)::date - (now() at time zone v_tz)::date > v_max_days then
    raise exception 'RN-051: excede la anticipación máxima de % días', v_max_days using errcode = 'P0001';
  end if;
end $$;

-- Puerta única de creación de citas.
-- RN-092: si p_patient_id es null y viene p_patient_name, crea el paciente
-- en el mismo flujo (creación implícita, sin fricción RN-091).
create or replace function public.create_appointment(
  p_starts_at timestamptz,
  p_duration_min int,
  p_mode public.appointment_mode,
  p_patient_id uuid default null,
  p_patient_name text default null,
  p_series_id uuid default null,
  p_created_via public.created_via default 'touch'
) returns public.appointments
language plpgsql security invoker as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_tz text;
  v_patient_id uuid := p_patient_id;
  v_reminder_min int;
  v_fire_at timestamptz;
  v_appt public.appointments;
begin
  if v_tenant_id is null then
    raise exception 'RN-001: usuario sin tenant';
  end if;
  if v_patient_id is null and p_patient_name is null then
    raise exception 'RN-121: se requiere paciente (id o nombre)';
  end if;

  select timezone into v_tz from public.tenants where id = v_tenant_id;

  -- serializa las escrituras del tenant en el mismo día local (RN-173-ready)
  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant_id::text || ':' || ((p_starts_at at time zone v_tz)::date)::text, 42)
  );

  perform public._check_temporal_limits(v_tenant_id, p_starts_at);
  perform public._check_capacity(v_tenant_id, p_starts_at, p_duration_min, p_mode);

  if v_patient_id is null then
    insert into public.patients (tenant_id, name)
    values (v_tenant_id, p_patient_name)
    returning id into v_patient_id;
  end if;

  insert into public.appointments
    (tenant_id, patient_id, professional_id, starts_at, duration_min, mode, series_id, created_via)
  values
    (v_tenant_id, v_patient_id, auth.uid(), p_starts_at, p_duration_min, p_mode, p_series_id, p_created_via)
  returning * into v_appt;

  -- RN-131: recordatorio pre-cita programado al crear
  select coalesce((config #>> '{notifications,reminderBeforeMinutes}')::int, 30)
  into v_reminder_min
  from public.tenant_current_config where tenant_id = v_tenant_id;

  v_fire_at := p_starts_at - make_interval(mins => v_reminder_min);
  if v_fire_at > now() then
    insert into public.scheduled_notifications (tenant_id, appointment_id, kind, fire_at)
    values (v_tenant_id, v_appt.id, 'reminder', v_fire_at);
  end if;

  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, after)
  values (v_tenant_id, auth.uid(), 'appointment_created', 'appointments', v_appt.id, to_jsonb(v_appt));

  return v_appt;
end $$;

-- RN-081: reagendar = nueva cita + cancelar la original con vínculo bidireccional
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_starts_at timestamptz,
  p_new_duration_min int default null,
  p_new_mode public.appointment_mode default null
) returns public.appointments
language plpgsql security invoker as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_tz text;
  v_old public.appointments;
  v_new public.appointments;
  v_duration int;
  v_mode public.appointment_mode;
  v_reminder_min int;
  v_fire_at timestamptz;
begin
  select * into v_old from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'Cita no encontrada';
  end if;
  if v_old.status <> 'scheduled' then
    raise exception 'RN-082: solo se reagendan citas en estado scheduled';
  end if;

  -- RN-121: misma modalidad y duración que la original si no se indican
  v_duration := coalesce(p_new_duration_min, v_old.duration_min);
  v_mode := coalesce(p_new_mode, v_old.mode);

  select timezone into v_tz from public.tenants where id = v_tenant_id;
  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant_id::text || ':' || ((p_new_starts_at at time zone v_tz)::date)::text, 42)
  );

  perform public._check_temporal_limits(v_tenant_id, p_new_starts_at);
  perform public._check_capacity(v_tenant_id, p_new_starts_at, v_duration, v_mode, p_appointment_id);

  insert into public.appointments
    (tenant_id, patient_id, professional_id, starts_at, duration_min, mode,
     series_id, rescheduled_from_id, created_via)
  values
    (v_tenant_id, v_old.patient_id, v_old.professional_id, p_new_starts_at, v_duration, v_mode,
     v_old.series_id, v_old.id, v_old.created_via)
  returning * into v_new;

  update public.appointments
  set status = 'cancelled', rescheduled_to_id = v_new.id
  where id = v_old.id;

  select coalesce((config #>> '{notifications,reminderBeforeMinutes}')::int, 30)
  into v_reminder_min
  from public.tenant_current_config where tenant_id = v_tenant_id;

  v_fire_at := p_new_starts_at - make_interval(mins => v_reminder_min);
  if v_fire_at > now() then
    insert into public.scheduled_notifications (tenant_id, appointment_id, kind, fire_at)
    values (v_tenant_id, v_new.id, 'reminder', v_fire_at);
  end if;

  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, before, after)
  values (v_tenant_id, auth.uid(), 'appointment_rescheduled', 'appointments', v_old.id,
          to_jsonb(v_old), to_jsonb(v_new));

  return v_new;
end $$;

-- RN-122: matching por trigram + sin acentos, en español.
-- El umbral alto/medio lo interpreta el caller (core) para decidir entre
-- usar directo, pedir desambiguación o crear paciente nuevo (RN-092).
create or replace function public.search_patients(p_query text)
returns table (id uuid, name text, phone text, sim real)
language sql stable security invoker as $$
  select p.id, p.name, p.phone,
         extensions.similarity(public.f_unaccent(lower(p.name)), public.f_unaccent(lower(p_query))) as sim
  from public.patients p
  where p.tenant_id = public.current_tenant_id()
    and p.deleted_at is null
    and (
      public.f_unaccent(lower(p.name)) operator(extensions.%) public.f_unaccent(lower(p_query))
      or public.f_unaccent(lower(p.name)) like '%' || public.f_unaccent(lower(p_query)) || '%'
    )
  order by sim desc
  limit 5
$$;

-- RN-152: derecho al olvido — anonimiza, las citas históricas se preservan
create or replace function public.anonymize_patient(p_patient_id uuid)
returns void
language plpgsql security invoker as $$
begin
  update public.patients
  set name = 'Paciente eliminado', phone = null, email = null,
      address = null, notes = null, deleted_at = now()
  where id = p_patient_id;

  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id)
  values (public.current_tenant_id(), auth.uid(), 'patient_anonymized', 'patients', p_patient_id);
end $$;
