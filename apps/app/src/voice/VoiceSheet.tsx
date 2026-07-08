import { useEffect, useRef, useState } from 'react';
import {
  addDays,
  dayDiff,
  effectiveRanges,
  expandWeeklySeries,
  resolveRelativeDate,
  toHHMM,
  validateSeries,
  zonedNow,
} from '@voicescheduler/core';
import type { CalendarException, CoreConfig, Mode, RelativeDate, Weekday } from '@voicescheduler/core';
import {
  createAppointment,
  createException,
  createSeries,
  fetchAppointments,
  interpretCommand,
  logVoiceCommand,
  rescheduleAppointment,
  searchPatients,
  updateAppointmentStatus,
} from '../lib/api';
import type { UiAppointment } from '../data/sample';
import type { SpokenTime, VoiceIntent } from './types';

type ChoiceOption = { label: string; sub?: string; value: unknown };

type Phase =
  | { k: 'input'; prompt: string | null }
  | { k: 'busy'; label: string }
  | { k: 'choice'; title: string; options: ChoiceOption[] }
  | { k: 'confirm'; title: string; lines: string[]; low: boolean }
  | { k: 'result'; title: string; items: UiAppointment[] }
  | { k: 'done'; message: string }
  | { k: 'error'; message: string };

const dateFmt = new Intl.DateTimeFormat('es-GT', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const fmtDate = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const DAY_NAMES = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

const SR: (new () => SpeechRecognitionLike) | undefined =
  (window as unknown as Record<string, never>)['SpeechRecognition'] ??
  (window as unknown as Record<string, never>)['webkitSpeechRecognition'];

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export interface VoiceSheetProps {
  live: boolean;
  config: CoreConfig;
  exceptions: CalendarException[];
  onClose: () => void;
  onExecuted: () => void;
}

export function VoiceSheet({ live, config, exceptions, onClose, onExecuted }: VoiceSheetProps) {
  const [phase, setPhase] = useState<Phase>({ k: 'input', prompt: null });
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const resolverRef = useRef<((v: unknown) => void) | null>(null);
  const contextRef = useRef<VoiceIntent | null>(null);
  const turnsRef = useRef(0);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const tz = config.timezone;

  useEffect(() => () => recRef.current?.stop(), []);

  function ask<T>(next: Phase): Promise<T> {
    return new Promise<T>(resolve => {
      resolverRef.current = resolve as (v: unknown) => void;
      setPhase(next);
    });
  }

  function answer(value: unknown) {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(value);
  }

  function resetToInput() {
    contextRef.current = null;
    turnsRef.current = 0;
    setText('');
    setPhase({ k: 'input', prompt: null });
  }

  function finish(message: string) {
    contextRef.current = null;
    turnsRef.current = 0;
    onExecuted();
    setPhase({ k: 'done', message });
  }

  // ── Entrada de voz (Web Speech; en la app empaquetada será el plugin nativo) ──
  function startListening() {
    if (!SR) return;
    const rec = new SR();
    recRef.current = rec;
    rec.lang = 'es-GT';
    rec.interimResults = true;
    rec.onresult = e => {
      let final = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setText(final || interim);
      if (final.trim()) {
        rec.stop();
        void submit(final.trim());
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }

  // ── Pipeline principal ───────────────────────────────────────────────────────
  async function submit(transcript: string) {
    if (!transcript) return;
    if (!live) {
      setPhase({ k: 'error', message: 'La voz requiere conexión a Supabase.' });
      return;
    }
    turnsRef.current += 1;
    if (turnsRef.current > 5) {
      // RN-120: máximo 5 turnos de slot-filling
      resetToInput();
      setPhase({ k: 'error', message: 'Demasiados intentos. Empecemos el comando de nuevo.' });
      return;
    }
    setText('');
    setPhase({ k: 'busy', label: 'Interpretando…' });
    const capturedAt = new Date(); // RN-125: ancla de resolución de fechas
    try {
      const intent = await interpretCommand(transcript, contextRef.current);
      contextRef.current = intent;
      void logVoiceCommand({
        transcript,
        capturedAt: capturedAt.toISOString(),
        intent,
        confidence: intent.confidence ?? null,
        status: 'interpreted',
      });
      await process(intent, capturedAt);
    } catch (e) {
      setPhase({ k: 'error', message: e instanceof Error ? e.message : 'No se pudo procesar el comando.' });
    }
  }

  async function process(intent: VoiceIntent, capturedAt: Date) {
    const low = (intent.confidence ?? 1) < 0.7; // RN-111: confidenceThreshold
    if (intent.intent === 'unknown') {
      contextRef.current = null;
      setPhase({ k: 'error', message: 'No entendí el comando. Prueba con «Agenda a Luis el miércoles a las 3».' });
      return;
    }
    if (intent.followupQuestion && (intent.missing?.length ?? 0) > 0) {
      setPhase({ k: 'input', prompt: intent.followupQuestion }); // RN-120: retiene contexto
      return;
    }
    switch (intent.intent) {
      case 'query':
        return doQuery(intent, capturedAt); // RN-112: sin confirmación
      case 'schedule':
        return doSchedule(intent, capturedAt, low);
      case 'cancel':
        return doCancel(intent, capturedAt, low);
      case 'reschedule':
        return doReschedule(intent, capturedAt, low);
      case 'block':
        return doBlock(intent, capturedAt, low);
    }
  }

  // ── Resolución de entidades ─────────────────────────────────────────────────
  function resolveDateOnly(rel: RelativeDate, capturedAt: Date): string | null {
    const r = resolveRelativeDate(rel, capturedAt, tz);
    return r.kind === 'date' ? r.date : null;
  }

  async function resolveTime(t: SpokenTime, date: string, mode: Mode, durationMin: number): Promise<number> {
    const base = t.hour * 60 + t.minute;
    if (!t.ambiguousAmPm || t.hour >= 12) return base;
    const alt = base + 720;
    const fits = (s: number) =>
      effectiveRanges(date, mode, config, exceptions).some(r => r.startMin <= s && s + durationMin <= r.endMin);
    const baseFits = fits(base);
    const altFits = fits(alt);
    // RN-124: si solo un rango es laboral se usa ese; si ambos, se pregunta
    if (baseFits && !altFits) return base;
    if (altFits && !baseFits) return alt;
    if (!baseFits && !altFits) return alt;
    return ask<number>({
      k: 'choice',
      title: '¿A qué hora te refieres?',
      options: [
        { label: toHHMM(base), value: base },
        { label: toHHMM(alt), value: alt },
      ],
    });
  }

  async function resolvePatient(name: string): Promise<{ id: string | null; name: string }> {
    const hits = await searchPatients(name);
    const strong = hits.filter(h => h.sim >= 0.6);
    // RN-122: un candidato claro → directo; varios → elegir; ninguno → crear (RN-092)
    if (strong.length === 1 && hits.length === 1) return { id: strong[0]!.id, name: strong[0]!.name };
    if (hits.length === 0) return { id: null, name };
    return ask<{ id: string | null; name: string }>({
      k: 'choice',
      title: `¿Quién es «${name}»?`,
      options: [
        ...hits.slice(0, 4).map(h => ({
          label: h.name,
          sub: h.phone ?? undefined,
          value: { id: h.id, name: h.name },
        })),
        { label: `Crear paciente nuevo «${name}»`, value: { id: null, name } },
      ],
    });
  }

  async function findAppointment(intent: VoiceIntent, capturedAt: Date): Promise<UiAppointment> {
    const today = zonedNow(tz, capturedAt).date;
    let from = today;
    let days = 14;
    if (intent.date) {
      const r = resolveRelativeDate(intent.date, capturedAt, tz);
      if (r.kind === 'date') {
        from = r.date;
        days = 1;
      } else {
        from = r.from;
        days = dayDiff(r.from, r.to) + 1;
      }
    }
    const all = await fetchAppointments(tz, from, days);
    let matches = all.filter(a => a.status === 'scheduled');
    if (intent.patientName) {
      const q = norm(intent.patientName);
      matches = matches.filter(a => norm(a.patientName).includes(q) || q.includes(norm(a.patientName)));
    }
    if (intent.time) {
      const t = intent.time.hour * 60 + intent.time.minute;
      const byTime = matches.filter(a => a.startMin === t || a.startMin === t + 720);
      if (byTime.length > 0) matches = byTime;
    }
    if (matches.length === 0) throw new Error('No encontré una cita que coincida.');
    if (matches.length === 1) return matches[0]!;
    return ask<UiAppointment>({
      k: 'choice',
      title: '¿Cuál cita?',
      options: matches.slice(0, 4).map(a => ({
        label: a.patientName,
        sub: `${fmtDate(a.date)} · ${toHHMM(a.startMin)}`,
        value: a,
      })),
    });
  }

  // ── Intenciones ─────────────────────────────────────────────────────────────
  async function doQuery(intent: VoiceIntent, capturedAt: Date) {
    setPhase({ k: 'busy', label: 'Consultando…' });
    const now = zonedNow(tz, capturedAt);
    const variant = intent.queryVariant ?? 'schedule';
    let from = now.date;
    let days = 1;
    let title = 'Agenda de hoy';
    if (variant === 'pending_today') title = 'Pendientes de hoy';
    else if (variant === 'pending_tomorrow') {
      from = addDays(now.date, 1);
      title = 'Pendientes de mañana';
    } else if (variant === 'pending_week') {
      days = 8 - now.weekday;
      title = 'Pendientes de la semana';
    } else if (intent.date) {
      const r = resolveRelativeDate(intent.date, capturedAt, tz);
      if (r.kind === 'date') {
        from = r.date;
        title = `Agenda del ${fmtDate(r.date)}`;
      } else {
        from = r.from;
        days = dayDiff(r.from, r.to) + 1;
        title = 'Agenda de la semana';
      }
    }
    if (variant === 'unpaid') title = 'Pagos pendientes';

    const appts = await fetchAppointments(tz, from, days);
    let items = appts;
    if (variant === 'pending_today' || variant === 'pending_tomorrow' || variant === 'pending_week') {
      items = appts.filter(a => a.status === 'scheduled');
    }
    if (variant === 'unpaid') items = appts.filter(a => !a.paid);
    items = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
    contextRef.current = null;
    turnsRef.current = 0;
    setPhase({ k: 'result', title, items });
  }

  async function doSchedule(intent: VoiceIntent, capturedAt: Date, low: boolean) {
    if (intent.recurrence && intent.recurrence.weekdays.length > 0) {
      return doScheduleSeries(intent, capturedAt, low);
    }
    if (!intent.patientName || !intent.date || !intent.time) {
      setPhase({ k: 'input', prompt: '¿Paciente, día y hora?' });
      return;
    }
    const date = resolveDateOnly(intent.date, capturedAt);
    if (!date) {
      setPhase({ k: 'input', prompt: '¿Para qué día exactamente?' });
      return;
    }
    const mode = intent.mode ?? config.defaultMode; // RN-121: defaultMode
    const durationMin = intent.durationMinutes ?? config.defaultDurationMin;
    const startMin = await resolveTime(intent.time, date, mode, durationMin);
    setPhase({ k: 'busy', label: 'Buscando al paciente…' });
    const patient = await resolvePatient(intent.patientName);
    const lines = [
      patient.id ? `Paciente: ${patient.name}` : `Crear paciente: ${patient.name}`,
      `${fmtDate(date)} · ${toHHMM(startMin)}–${toHHMM(startMin + durationMin)}`,
      mode === 'home_visit' ? 'Domicilio' : 'Clínica',
    ];
    const ok = await ask<boolean>({ k: 'confirm', title: 'Agendar cita', lines, low }); // RN-110
    if (!ok) return resetToInput();
    setPhase({ k: 'busy', label: 'Agendando…' });
    await createAppointment({
      tz,
      date,
      startMin,
      durationMin,
      mode,
      patientId: patient.id,
      patientName: patient.id ? null : patient.name,
    });
    finish(`Cita agendada: ${patient.name}, ${fmtDate(date)} a las ${toHHMM(startMin)}.`);
  }

  // RN-070/071: "Agenda a Luis lunes y jueves a las 3, 12 sesiones"
  async function doScheduleSeries(intent: VoiceIntent, capturedAt: Date, low: boolean) {
    if (!intent.patientName || !intent.time) {
      setPhase({ k: 'input', prompt: '¿Paciente y a qué hora?' });
      return;
    }
    const sessions = intent.recurrence?.sessions;
    if (!sessions || sessions < 1) {
      setPhase({ k: 'input', prompt: '¿Cuántas sesiones serán?' });
      return;
    }
    const firstDate = intent.date ? resolveDateOnly(intent.date, capturedAt) : zonedNow(tz, capturedAt).date;
    if (!firstDate) {
      setPhase({ k: 'input', prompt: '¿A partir de qué día?' });
      return;
    }
    const weekdays = [...new Set(intent.recurrence!.weekdays)]
      .filter(d => d >= 1 && d <= 7)
      .sort((a, b) => a - b) as Weekday[];
    const mode = intent.mode ?? config.defaultMode;
    const durationMin = intent.durationMinutes ?? config.defaultDurationMin;
    const startMin = await resolveTime(intent.time, firstDate, mode, durationMin);

    setPhase({ k: 'busy', label: 'Validando la serie…' });
    const occurrences = expandWeeklySeries({
      weekdays,
      startMin,
      durationMin,
      mode,
      firstDate,
      end: { type: 'count', sessions },
    });
    if (occurrences.length === 0) {
      setPhase({ k: 'error', message: 'La serie no genera ninguna sesión. Revisa los días indicados.' });
      return;
    }
    const lastDate = occurrences[occurrences.length - 1]!.date;
    const existing = await fetchAppointments(tz, firstDate, dayDiff(firstDate, lastDate) + 1);
    const results = validateSeries(occurrences, config, existing, exceptions);
    const valid = results.filter(r => r.ok).map(r => r.occurrence);
    const conflicts = results.filter(r => !r.ok);
    if (valid.length === 0) {
      setPhase({ k: 'error', message: 'Ninguna sesión de la serie tiene horario disponible.' });
      return;
    }

    const patient = await resolvePatient(intent.patientName);
    const lines = [
      patient.id ? `Paciente: ${patient.name}` : `Crear paciente: ${patient.name}`,
      `${weekdays.map(d => DAY_NAMES[d]).join(' y ')} · ${toHHMM(startMin)} · ${valid.length} sesiones`,
      `Primera ${fmtDate(valid[0]!.date)} · última ${fmtDate(valid[valid.length - 1]!.date)}`,
      mode === 'home_visit' ? 'Domicilio' : 'Clínica',
    ];
    if (conflicts.length > 0) {
      lines.push(`Se omiten ${conflicts.length} por conflicto: ${conflicts.map(c => fmtDate(c.occurrence.date)).join(', ')}`);
    }
    const ok = await ask<boolean>({ k: 'confirm', title: 'Agendar serie', lines, low }); // RN-110
    if (!ok) return resetToInput();
    setPhase({ k: 'busy', label: 'Agendando la serie…' });
    await createSeries({
      tz,
      occurrences: valid.map(o => ({ date: o.date, startMin: o.startMin })),
      durationMin,
      mode,
      patientId: patient.id,
      patientName: patient.id ? null : patient.name,
      weekdays,
      startMin,
      endSessions: sessions,
    });
    finish(`Serie agendada: ${patient.name}, ${valid.length} sesiones desde el ${fmtDate(valid[0]!.date)}.`);
  }

  async function doCancel(intent: VoiceIntent, capturedAt: Date, low: boolean) {
    setPhase({ k: 'busy', label: 'Buscando la cita…' });
    const appt = await findAppointment(intent, capturedAt);
    const ok = await ask<boolean>({
      k: 'confirm',
      title: 'Cancelar cita',
      lines: [appt.patientName, `${fmtDate(appt.date)} · ${toHHMM(appt.startMin)}`],
      low,
    });
    if (!ok) return resetToInput();
    setPhase({ k: 'busy', label: 'Cancelando…' });
    await updateAppointmentStatus(appt.id, 'cancelled');
    finish(`Cita de ${appt.patientName} cancelada.`);
  }

  async function doReschedule(intent: VoiceIntent, capturedAt: Date, low: boolean) {
    if (!intent.newDate && !intent.newTime) {
      setPhase({ k: 'input', prompt: '¿Para cuándo la muevo?' });
      return;
    }
    setPhase({ k: 'busy', label: 'Buscando la cita…' });
    const appt = await findAppointment(intent, capturedAt);
    const date = intent.newDate ? resolveDateOnly(intent.newDate, capturedAt) : appt.date;
    if (!date) {
      setPhase({ k: 'input', prompt: '¿A qué día exactamente?' });
      return;
    }
    // RN-121: misma modalidad y duración que la original
    const startMin = intent.newTime ? await resolveTime(intent.newTime, date, appt.mode, appt.durationMin) : appt.startMin;
    const ok = await ask<boolean>({
      k: 'confirm',
      title: 'Reagendar cita',
      lines: [appt.patientName, `${fmtDate(appt.date)} ${toHHMM(appt.startMin)} → ${fmtDate(date)} ${toHHMM(startMin)}`],
      low,
    });
    if (!ok) return resetToInput();
    setPhase({ k: 'busy', label: 'Reagendando…' });
    await rescheduleAppointment({ id: appt.id, tz, date, startMin });
    finish(`Cita movida al ${fmtDate(date)} a las ${toHHMM(startMin)}.`);
  }

  async function doBlock(intent: VoiceIntent, capturedAt: Date, low: boolean) {
    if (!intent.date) {
      setPhase({ k: 'input', prompt: '¿Qué día bloqueo?' });
      return;
    }
    const date = resolveDateOnly(intent.date, capturedAt);
    if (!date) {
      setPhase({ k: 'input', prompt: '¿Qué día exactamente?' });
      return;
    }
    const block = intent.block ?? { allDay: false };
    const allDay = block.allDay || !block.timeFrom || !block.timeTo;
    const startMin = block.timeFrom ? block.timeFrom.hour * 60 + block.timeFrom.minute : 0;
    const endMin = block.timeTo ? block.timeTo.hour * 60 + block.timeTo.minute : 0;
    const lines = allDay
      ? [`Todo el ${fmtDate(date)}`, block.reason ?? 'Día bloqueado']
      : [`${fmtDate(date)} · ${toHHMM(startMin)}–${toHHMM(endMin)}`, block.reason ?? 'Bloqueo de tiempo'];
    const ok = await ask<boolean>({ k: 'confirm', title: 'Bloquear tiempo', lines, low });
    if (!ok) return resetToInput();
    setPhase({ k: 'busy', label: 'Bloqueando…' });
    await createException(
      allDay
        ? { type: 'holiday', date, reason: block.reason ?? null }
        : { type: 'time_block', date, startMin, endMin, reason: block.reason ?? null },
    );
    finish(`Tiempo bloqueado el ${fmtDate(date)}.`);
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="vs-sheet-backdrop" onClick={onClose} />
      <div className="vs-sheet" role="dialog" aria-label="Asistente de voz">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h2 className="h6 mb-0">
            <i className="bi bi-mic me-2" aria-hidden="true" />
            Asistente de voz
          </h2>
          <button className="btn-close" aria-label="Cerrar" onClick={onClose} />
        </div>

        {phase.k === 'input' && (
          <div>
            <p className="text-secondary small mb-2">
              {phase.prompt ??
                'Di o escribe un comando: «Agenda a Luis el miércoles a las 3», «¿Quiénes me faltan hoy?», «Bloquéame el viernes de 12 a 2»…'}
            </p>
            <div className="d-flex gap-2 align-items-center">
              {SR && (
                <button
                  className={`vs-mic-btn${listening ? ' vs-mic-live' : ''}`}
                  aria-label={listening ? 'Detener dictado' : 'Dictar comando'}
                  onClick={() => (listening ? recRef.current?.stop() : startListening())}
                >
                  <i className="bi bi-mic" aria-hidden="true" />
                </button>
              )}
              <input
                className="form-control"
                placeholder={listening ? 'Escuchando…' : 'Escribe el comando'}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && text.trim()) void submit(text.trim());
                }}
              />
              <button
                className="btn btn-primary"
                aria-label="Enviar comando"
                disabled={!text.trim()}
                onClick={() => void submit(text.trim())}
              >
                <i className="bi bi-send" aria-hidden="true" />
              </button>
            </div>
            {!SR && <p className="form-text">Este navegador no tiene dictado por voz; escribe el comando.</p>}
          </div>
        )}

        {phase.k === 'busy' && (
          <p className="text-secondary my-3">
            <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
            {phase.label}
          </p>
        )}

        {phase.k === 'choice' && (
          <div>
            <p className="fw-semibold mb-2">{phase.title}</p>
            <div className="list-group">
              {phase.options.map((o, i) => (
                <button key={i} className="list-group-item list-group-item-action" onClick={() => answer(o.value)}>
                  {o.label}
                  {o.sub && <small className="text-secondary d-block">{o.sub}</small>}
                </button>
              ))}
            </div>
          </div>
        )}

        {phase.k === 'confirm' && (
          <div className={`vs-confirm-card${phase.low ? ' low' : ''}`}>
            <p className="fw-semibold mb-1">{phase.title}</p>
            {phase.low && (
              <p className="small mb-2" style={{ color: 'var(--vs-home-time)' }}>
                <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
                Confianza baja — revisa bien los datos antes de confirmar
              </p>
            )}
            {phase.lines.map((line, i) => (
              <p key={i} className="mb-1">
                {line}
              </p>
            ))}
            <div className="d-flex gap-2 mt-3">
              <button className="btn btn-primary flex-fill" onClick={() => answer(true)}>
                Confirmar
              </button>
              <button className="btn btn-outline-secondary flex-fill" onClick={() => answer(false)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {phase.k === 'result' && (
          <div>
            <p className="fw-semibold mb-2">
              {phase.title} · {phase.items.length}
            </p>
            {phase.items.length === 0 && <p className="text-secondary small">Sin citas en ese periodo.</p>}
            <div className="list-group mb-3" style={{ maxHeight: 280, overflowY: 'auto' }}>
              {phase.items.map(a => (
                <div key={a.id} className="list-group-item d-flex justify-content-between">
                  <span>
                    {a.patientName}
                    <small className="text-secondary d-block">
                      {fmtDate(a.date)} · {toHHMM(a.startMin)}–{toHHMM(a.startMin + a.durationMin)} ·{' '}
                      {a.mode === 'home_visit' ? 'domicilio' : 'clínica'}
                    </small>
                  </span>
                  {!a.paid && (
                    <i
                      className="bi bi-wallet2 align-self-center"
                      style={{ color: 'var(--vs-unpaid)' }}
                      title="Pago pendiente"
                    />
                  )}
                </div>
              ))}
            </div>
            <button className="btn btn-outline-secondary btn-sm" onClick={resetToInput}>
              Otro comando
            </button>
          </div>
        )}

        {(phase.k === 'done' || phase.k === 'error') && (
          <div>
            <p className={phase.k === 'done' ? 'text-success' : 'text-danger'}>
              <i className={`bi ${phase.k === 'done' ? 'bi-check-circle' : 'bi-x-circle'} me-2`} aria-hidden="true" />
              {phase.message}
            </p>
            <div className="d-flex gap-2">
              <button className="btn btn-outline-secondary btn-sm" onClick={resetToInput}>
                Otro comando
              </button>
              <button className="btn btn-primary btn-sm" onClick={onClose}>
                Listo
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
