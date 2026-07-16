// Acceso a Supabase. Toda escritura de citas pasa por los RPC transaccionales
// (create_appointment valida cupo y límites bajo lock); las lecturas van
// directas a las tablas protegidas por RLS.
import { addDays, parseConfig, toHHMM, toMinutes, zonedNow, zonedTimeToUtc } from '@voicescheduler/core';
import type { CalendarException, CoreConfig, Mode, TenantConfigJson } from '@voicescheduler/core';
import { supabase } from './supabase';
import type { UiAppointment } from '../data/sample';
import type { VoiceIntent } from '../voice/types';

function client() {
  if (!supabase) throw new Error('Supabase no configurado (revisa .env.local)');
  return supabase;
}

export async function fetchConfig(): Promise<CoreConfig> {
  const { data, error } = await client().from('tenant_current_config').select('config').single();
  if (error) throw new Error(`No se pudo cargar la configuración del tenant: ${error.message}`);
  return parseConfig(data.config as TenantConfigJson);
}

export interface ConfigVersion {
  version: number;
  config: TenantConfigJson;
}

/** Config cruda (JSON) con su número de versión, para la pantalla de ajustes */
export async function fetchConfigRaw(): Promise<ConfigVersion> {
  const { data, error } = await client().from('tenant_current_config').select('version, config').single();
  if (error) throw new Error(`No se pudo cargar la configuración: ${error.message}`);
  return { version: data.version as number, config: data.config as TenantConfigJson };
}

/**
 * RN-140/143: guardar = insertar versión nueva (nunca UPDATE). El trigger de
 * auditoría registra el valor anterior; el unique(tenant, version) protege
 * contra guardados concurrentes.
 */
export async function saveConfigVersion(config: TenantConfigJson, currentVersion: number): Promise<void> {
  const c = client();
  const { data: userData } = await c.auth.getUser();
  const { error } = await c.from('tenant_config_versions').insert({
    tenant_id: await tenantId(),
    version: currentVersion + 1,
    config,
    created_by: userData.user?.id ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function fetchAppointments(tz: string, fromDate: string, days: number): Promise<UiAppointment[]> {
  const fromIso = zonedTimeToUtc(fromDate, 0, tz).toISOString();
  const toIso = zonedTimeToUtc(addDays(fromDate, days), 0, tz).toISOString();
  const { data, error } = await client()
    .from('appointments')
    .select('id, starts_at, duration_min, mode, status, payment_status, series_id, patient:patients(id, name)')
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .neq('status', 'cancelled')
    .order('starts_at');
  if (error) throw new Error(`No se pudieron cargar las citas: ${error.message}`);
  return (data ?? []).map(r => {
    const local = zonedNow(tz, new Date(r.starts_at as string));
    const patient = (Array.isArray(r.patient) ? r.patient[0] : r.patient) as { id: string; name: string } | null;
    return {
      id: r.id as string,
      status: r.status as UiAppointment['status'],
      date: local.date,
      startMin: local.minutes,
      durationMin: r.duration_min as number,
      mode: r.mode as Mode,
      patientName: patient?.name ?? 'Paciente',
      patientId: patient?.id,
      paid: r.payment_status === 'paid',
      seriesId: (r.series_id as string | null) ?? undefined,
    };
  });
}

/** Excepción con su id de fila, para poder eliminarla desde la UI */
export type TenantException = CalendarException & { id: string };

export async function fetchExceptions(): Promise<TenantException[]> {
  const { data, error } = await client()
    .from('calendar_exceptions')
    .select('id, type, date_from, date_to, time_from, time_to, modes, reason');
  if (error) throw new Error(`No se pudieron cargar las excepciones: ${error.message}`);
  const hhmm = (t: string) => toMinutes(t.slice(0, 5));
  return (data ?? []).map((r): TenantException => {
    const id = r.id as string;
    const reason = (r.reason as string | null) ?? undefined;
    switch (r.type as string) {
      case 'holiday':
        return { id, type: 'holiday', date: r.date_from as string, reason };
      case 'vacation':
        return { id, type: 'vacation', dateFrom: r.date_from as string, dateTo: r.date_to as string, reason };
      case 'extended_hours':
        return {
          id,
          type: 'extended_hours',
          date: r.date_from as string,
          startMin: hhmm(r.time_from as string),
          endMin: hhmm(r.time_to as string),
          modes: (r.modes as Mode[] | null) ?? undefined,
          reason,
        };
      default:
        return {
          id,
          type: 'time_block',
          date: r.date_from as string,
          startMin: hhmm(r.time_from as string),
          endMin: hhmm(r.time_to as string),
          reason,
        };
    }
  });
}

/** RN-130: registra este dispositivo para recibir push del profesional */
export async function savePushSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.['p256dh'] || !json.keys?.['auth']) {
    throw new Error('La suscripción push del navegador es inválida');
  }
  const c = client();
  const { data: userData } = await c.auth.getUser();
  if (!userData.user) throw new Error('Sin sesión activa');
  const { error } = await c.from('push_subscriptions').upsert(
    {
      tenant_id: await tenantId(),
      user_id: userData.user.id,
      endpoint: json.endpoint,
      p256dh: json.keys['p256dh'],
      auth: json.keys['auth'],
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw new Error(error.message);
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const { error } = await client().from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw new Error(error.message);
}

export async function deleteException(id: string): Promise<void> {
  const { error } = await client().from('calendar_exceptions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export interface CreateSeriesParams {
  tz: string;
  /** Ocurrencias ya validadas por el core (RN-071); las omitidas no vienen */
  occurrences: { date: string; startMin: number }[];
  durationMin: number;
  mode: Mode;
  patientId: string | null;
  patientName: string | null;
  weekdays: number[];
  startMin: number;
  endSessions: number;
}

/** RN-070/072: crea la serie completa en una sola transacción */
export async function createSeries(p: CreateSeriesParams): Promise<void> {
  const { error } = await client().rpc('create_series', {
    p_starts: p.occurrences.map(o => zonedTimeToUtc(o.date, o.startMin, p.tz).toISOString()),
    p_duration_min: p.durationMin,
    p_mode: p.mode,
    p_weekdays: p.weekdays,
    p_start_time: toHHMM(p.startMin),
    p_ends_by: 'count',
    p_patient_id: p.patientId,
    p_patient_name: p.patientName,
    p_end_sessions: p.endSessions,
  });
  if (error) throw new Error(error.message);
}

/**
 * RN-072: cancelación con alcance. Sin fromDate cancela toda la serie;
 * con fromDate/fromStartMin cancela esa sesión y las siguientes.
 */
export async function cancelSeriesAppointments(p: {
  seriesId: string;
  tz: string;
  fromDate?: string;
  fromStartMin?: number;
  reason?: string;
}): Promise<void> {
  let query = client()
    .from('appointments')
    .update({ status: 'cancelled', cancellation_reason: p.reason ?? null })
    .eq('series_id', p.seriesId)
    .eq('status', 'scheduled');
  if (p.fromDate !== undefined && p.fromStartMin !== undefined) {
    query = query.gte('starts_at', zonedTimeToUtc(p.fromDate, p.fromStartMin, p.tz).toISOString());
  }
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export interface CreateAppointmentParams {
  tz: string;
  date: string;
  startMin: number;
  durationMin: number;
  mode: Mode;
  patientId: string | null;
  /** RN-092: si no hay patientId, se crea el paciente con este nombre */
  patientName: string | null;
}

export async function createAppointment(p: CreateAppointmentParams): Promise<void> {
  const { error } = await client().rpc('create_appointment', {
    p_starts_at: zonedTimeToUtc(p.date, p.startMin, p.tz).toISOString(),
    p_duration_min: p.durationMin,
    p_mode: p.mode,
    p_patient_id: p.patientId,
    p_patient_name: p.patientName,
  });
  if (error) throw new Error(error.message);
}

export async function updateAppointmentStatus(
  id: string,
  status: 'completed' | 'no_show' | 'cancelled',
  reason?: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === 'cancelled' && reason) patch.cancellation_reason = reason;
  const { error } = await client().from('appointments').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

/** RN-084/086: el pago es independiente del ciclo de vida y siempre editable */
export async function setPaymentStatus(id: string, paid: boolean): Promise<void> {
  const { error } = await client()
    .from('appointments')
    .update({ payment_status: paid ? 'paid' : 'unpaid' })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** RN-081: reagendar = nueva cita + original cancelada con vínculo (lo hace el RPC) */
export async function rescheduleAppointment(p: {
  id: string;
  tz: string;
  date: string;
  startMin: number;
}): Promise<void> {
  const { error } = await client().rpc('reschedule_appointment', {
    p_appointment_id: p.id,
    p_new_starts_at: zonedTimeToUtc(p.date, p.startMin, p.tz).toISOString(),
  });
  if (error) throw new Error(error.message);
}

export interface Patient {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

export type PatientFields = Omit<Patient, 'id'>;

let cachedTenantId: string | null = null;

async function tenantId(): Promise<string> {
  if (cachedTenantId) return cachedTenantId;
  const { data: userData } = await client().auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error('Sin sesión activa');
  const { data, error } = await client().from('users').select('tenant_id').eq('id', uid).single();
  if (error) throw new Error(error.message);
  cachedTenantId = data.tenant_id as string;
  return cachedTenantId;
}

export async function fetchPatients(): Promise<Patient[]> {
  const { data, error } = await client()
    .from('patients')
    .select('id, name, phone, email, address, notes')
    .is('deleted_at', null)
    .order('name');
  if (error) throw new Error(`No se pudieron cargar los pacientes: ${error.message}`);
  return (data ?? []) as Patient[];
}

export async function createPatient(fields: PatientFields): Promise<void> {
  const { error } = await client()
    .from('patients')
    .insert({ tenant_id: await tenantId(), ...fields });
  if (error) throw new Error(error.message);
}

export async function updatePatient(id: string, fields: PatientFields): Promise<void> {
  const { error } = await client().from('patients').update(fields).eq('id', id);
  if (error) throw new Error(error.message);
}

/** RN-094: soft delete — desaparece de búsquedas, el historial de citas se preserva */
export async function softDeletePatient(id: string): Promise<void> {
  const { error } = await client()
    .from('patients')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export interface PatientHit {
  id: string;
  name: string;
  phone: string | null;
  sim: number;
}

export async function searchPatients(query: string): Promise<PatientHit[]> {
  const { data, error } = await client().rpc('search_patients', { p_query: query });
  if (error) throw new Error(error.message);
  return (data ?? []) as PatientHit[];
}

/** RN-095: el payload al NLU lleva solo el transcript (y la intención parcial previa) */
export async function interpretCommand(transcript: string, context?: VoiceIntent | null): Promise<VoiceIntent> {
  const { data, error } = await client().functions.invoke('interpret', {
    body: { transcript, context: context ?? null },
  });
  if (error) {
    throw new Error('No se pudo interpretar el comando. ¿Está desplegada la función interpret?');
  }
  if (data?.error) throw new Error(String(data.error));
  return data as VoiceIntent;
}

/** RN-153: transcripciones de voz, retención 30 días (limpieza vía pg_cron) */
export async function logVoiceCommand(entry: {
  transcript: string;
  capturedAt: string;
  intent?: unknown;
  confidence?: number | null;
  status: string;
}): Promise<void> {
  try {
    const c = client();
    const { data: userData } = await c.auth.getUser();
    if (!userData.user) return;
    await c.from('voice_commands').insert({
      tenant_id: await tenantId(),
      user_id: userData.user.id,
      transcript: entry.transcript,
      captured_at: entry.capturedAt,
      intent: entry.intent ?? null,
      confidence: entry.confidence ?? null,
      status: entry.status,
    });
  } catch {
    // el registro es best-effort; nunca bloquea el flujo de voz
  }
}

/** RN-060: la intención `block` crea una excepción de calendario */
export async function createException(e: {
  type: 'holiday' | 'time_block';
  date: string;
  startMin?: number;
  endMin?: number;
  reason?: string | null;
}): Promise<void> {
  const row: Record<string, unknown> = {
    tenant_id: await tenantId(),
    type: e.type,
    date_from: e.date,
    reason: e.reason ?? null,
  };
  if (e.type === 'time_block') {
    row.time_from = toHHMM(e.startMin ?? 0);
    row.time_to = toHHMM(e.endMin ?? 0);
  }
  const { error } = await client().from('calendar_exceptions').insert(row);
  if (error) throw new Error(error.message);
}
