-- VoiceScheduler — fase V1: series de citas (RN-070..073)
--
-- El cliente calcula las ocurrencias con @voicescheduler/core (expandWeeklySeries)
-- y valida todas antes de confirmar (RN-071); los conflictos que el profesional
-- decide omitir simplemente no vienen en p_starts. Este RPC es la puerta
-- transaccional: revalida cupo y límites por ocurrencia y, si alguna falla,
-- toda la serie se revierte — nunca se crea una serie parcial en silencio.

create or replace function public.create_series(
  p_starts timestamptz[],
  p_duration_min int,
  p_mode public.appointment_mode,
  p_weekdays int[],
  p_start_time time,
  p_ends_by text,
  p_patient_id uuid default null,
  p_patient_name text default null,
  p_end_sessions int default null,
  p_end_date date default null,
  p_created_via public.created_via default 'touch'
) returns uuid
language plpgsql security invoker as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_patient_id uuid := p_patient_id;
  v_series_id uuid;
  v_start timestamptz;
begin
  if v_tenant_id is null then
    raise exception 'RN-001: usuario sin tenant';
  end if;
  if array_length(p_starts, 1) is null then
    raise exception 'RN-070: la serie no tiene ocurrencias';
  end if;
  if v_patient_id is null and p_patient_name is null then
    raise exception 'RN-121: se requiere paciente (id o nombre)';
  end if;

  -- RN-092: creación implícita del paciente en el mismo flujo
  if v_patient_id is null then
    insert into public.patients (tenant_id, name)
    values (v_tenant_id, p_patient_name)
    returning id into v_patient_id;
  end if;

  insert into public.series
    (tenant_id, patient_id, professional_id, weekdays, start_time,
     duration_min, mode, ends_by, end_sessions, end_date)
  values
    (v_tenant_id, v_patient_id, auth.uid(), p_weekdays, p_start_time,
     p_duration_min, p_mode, p_ends_by, p_end_sessions, p_end_date)
  returning id into v_series_id;

  -- RN-072: cada ocurrencia se materializa como cita individual vinculada por
  -- series_id. create_appointment aporta lock, validaciones, recordatorio y
  -- auditoría; una excepción aquí revierte la transacción completa.
  foreach v_start in array p_starts loop
    perform public.create_appointment(
      p_starts_at    => v_start,
      p_duration_min => p_duration_min,
      p_mode         => p_mode,
      p_patient_id   => v_patient_id,
      p_series_id    => v_series_id,
      p_created_via  => p_created_via
    );
  end loop;

  return v_series_id;
end $$;
