// Edge Function `notify` — envío de push al profesional (RN-130..136).
//
// La dispara pg_cron cada minuto (migración 0005_push.sql). Hace dos cosas:
//  1. Recordatorios pre-cita (RN-131): scheduled_notifications vencidas.
//  2. Resúmenes de mañana/tarde (RN-132/133) a la hora configurada del tenant.
//
// RN-135: los payloads llevan solo nombre, hora, duración y modalidad.
// RN-136: un envío fallido queda `failed`; no se reintenta indefinidamente.
//
// Secretos requeridos:
//   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:ohgovilla@gmail.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

// ── Helpers de zona horaria (espejo mínimo de packages/core/src/dates.ts;
//    Deno exige extensiones en los imports, así que no se puede reusar directo) ──
function zoned(at: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hhmm: `${p.hour}:${p.minute}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Instante UTC de una hora de pared del tenant (corrección en dos pasadas). */
function wallToUtc(dateISO: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  for (let i = 0; i < 2; i++) {
    const local = zoned(new Date(guess), timeZone);
    const [ly, lm, ld] = local.date.split('-').map(Number);
    const dayDiff = Math.round((Date.UTC(ly, lm - 1, ld) - Date.UTC(y, m - 1, d)) / 86_400_000);
    const diff = dayDiff * 1440 + local.minutes - minutes;
    if (diff === 0) break;
    guess -= diff * 60_000;
  }
  return new Date(guess);
}

// ── Envío ────────────────────────────────────────────────────────────────────
interface PushPayload {
  title: string;
  body: string;
}

async function sendToTenant(tenantId: string, payload: PushPayload): Promise<boolean> {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('tenant_id', tenantId);
  if (!subs || subs.length === 0) return false;
  let delivered = false;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
      delivered = true;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      // suscripción muerta: el dispositivo revocó el permiso o cambió de endpoint
      if (code === 404 || code === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }
  return delivered;
}

// ── Recordatorios pre-cita (RN-131) ─────────────────────────────────────────
async function processReminders(): Promise<number> {
  const { data: due } = await supabase
    .from('scheduled_notifications')
    .select(
      'id, tenant_id, appointment:appointments!inner(starts_at, duration_min, mode, status, patient:patients(name))',
    )
    .eq('status', 'pending')
    .eq('kind', 'reminder')
    .lte('fire_at', new Date().toISOString())
    .limit(50);

  let count = 0;
  for (const row of due ?? []) {
    const appt = Array.isArray(row.appointment) ? row.appointment[0] : row.appointment;
    if (!appt || appt.status !== 'scheduled') {
      await supabase.from('scheduled_notifications').update({ status: 'cancelled' }).eq('id', row.id);
      continue;
    }
    const { data: tenant } = await supabase.from('tenants').select('timezone').eq('id', row.tenant_id).single();
    const tz = tenant?.timezone ?? 'America/Guatemala';
    const local = zoned(new Date(appt.starts_at as string), tz);
    const patient = Array.isArray(appt.patient) ? appt.patient[0] : appt.patient;

    const delivered = await sendToTenant(row.tenant_id, {
      title: `Cita con ${patient?.name ?? 'paciente'} a las ${local.hhmm}`,
      body: `${appt.mode === 'home_visit' ? 'Domicilio' : 'Clínica'} · ${appt.duration_min} min`,
    });
    await supabase
      .from('scheduled_notifications')
      .update({ status: delivered ? 'sent' : 'failed' })
      .eq('id', row.id);
    await supabase.from('notifications_log').insert({
      tenant_id: row.tenant_id,
      kind: 'reminder',
      status: delivered ? 'sent' : 'failed',
      payload_meta: { hhmm: local.hhmm, mode: appt.mode },
    });
    count++;
  }
  return count;
}

// ── Resúmenes de mañana y tarde (RN-132/133) ────────────────────────────────
interface SummaryAppt {
  starts_at: string;
  mode: string;
  patient: { name: string } | { name: string }[] | null;
}

async function processSummaries(): Promise<number> {
  const { data: tenants } = await supabase.from('tenants').select('id, timezone');
  let count = 0;

  for (const tenant of tenants ?? []) {
    const { data: cfgRow } = await supabase
      .from('tenant_current_config')
      .select('config')
      .eq('tenant_id', tenant.id)
      .single();
    const notif = (cfgRow?.config as { notifications?: Record<string, string | number> } | null)?.notifications;
    if (!notif) continue;

    const nowLocal = zoned(new Date(), tenant.timezone);

    for (const kind of ['morning_summary', 'afternoon_summary'] as const) {
      const sendAt =
        kind === 'morning_summary'
          ? String(notif.morningNotificationTime ?? '')
          : String(notif.afternoonNotificationTime ?? '');
      if (!sendAt || nowLocal.hhmm !== sendAt.slice(0, 5)) continue;

      // dedupe: ¿ya se envió hoy? (por si el job corre dos veces en el minuto)
      const { data: already } = await supabase
        .from('notifications_log')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('kind', kind)
        .filter('payload_meta->>date', 'eq', nowLocal.date)
        .limit(1);
      if (already && already.length > 0) continue;

      const fromMin = kind === 'morning_summary' ? 0 : toMin(String(notif.afternoonSessionFrom ?? '14:00'));
      const toMinutes_ = kind === 'morning_summary' ? toMin(String(notif.morningSessionUntil ?? '13:00')) : 1440;

      const { data: appts } = await supabase
        .from('appointments')
        .select('starts_at, mode, patient:patients(name)')
        .eq('tenant_id', tenant.id)
        .eq('status', 'scheduled')
        .gte('starts_at', wallToUtc(nowLocal.date, fromMin, tenant.timezone).toISOString())
        .lt('starts_at', wallToUtc(nowLocal.date, toMinutes_, tenant.timezone).toISOString())
        .order('starts_at');

      // RN-132/133: si el bloque está vacío, no se envía
      if (!appts || appts.length === 0) continue;

      const items = (appts as SummaryAppt[]).map(a => {
        const local = zoned(new Date(a.starts_at), tenant.timezone);
        const patient = Array.isArray(a.patient) ? a.patient[0] : a.patient;
        return `${local.hhmm} ${patient?.name ?? 'paciente'} (${a.mode === 'home_visit' ? 'domicilio' : 'clínica'})`;
      });

      const delivered = await sendToTenant(tenant.id, {
        title:
          kind === 'morning_summary'
            ? `Buenos días — Mañana: ${appts.length} cita${appts.length > 1 ? 's' : ''}`
            : `Tarde: ${appts.length} cita${appts.length > 1 ? 's' : ''}`,
        body: items.join(' · ').slice(0, 3500),
      });
      await supabase.from('notifications_log').insert({
        tenant_id: tenant.id,
        kind,
        status: delivered ? 'sent' : 'failed',
        payload_meta: { date: nowLocal.date, count: appts.length },
      });
      count++;
    }
  }
  return count;
}

Deno.serve(async () => {
  try {
    const reminders = await processReminders();
    const summaries = await processSummaries();
    return new Response(JSON.stringify({ reminders, summaries }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('notify error', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
