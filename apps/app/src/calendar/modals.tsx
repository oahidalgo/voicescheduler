import { useEffect, useMemo, useState } from 'react';
import {
  availableStarts,
  expandWeeklySeries,
  toHHMM,
  toMinutes,
  validateSeries,
  weekdayOf,
  zonedNow,
} from '@voicescheduler/core';
import type { CalendarException, CoreConfig, Mode, Occurrence, OccurrenceValidation, Weekday } from '@voicescheduler/core';
import {
  cancelSeriesAppointments,
  createAppointment,
  createException,
  createSeries,
  rescheduleAppointment,
  searchPatients,
  setPaymentStatus,
  updateAppointmentStatus,
} from '../lib/api';
import type { PatientHit } from '../lib/api';
import type { UiAppointment } from '../data/sample';

export function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="modal d-block" tabIndex={-1} role="dialog" onClick={onClose}>
        <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
          <div className="modal-content">
            <div className="modal-header py-2">
              <h2 className="modal-title h6">{title}</h2>
              <button type="button" className="btn-close" aria-label="Cerrar" onClick={onClose} />
            </div>
            <div className="modal-body">{children}</div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" />
    </>
  );
}

const MODE_LABEL: Record<Mode, string> = {
  in_clinic: 'Clínica',
  home_visit: 'Domicilio',
  virtual: 'Virtual',
};

const WEEKDAY_BTNS: [Weekday, string][] = [
  [1, 'L'],
  [2, 'M'],
  [3, 'X'],
  [4, 'J'],
  [5, 'V'],
  [6, 'S'],
  [7, 'D'],
];

const dateFmt = new Intl.DateTimeFormat('es-GT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDate = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

export interface NewAppointmentModalProps {
  date: string;
  defaultStart: number;
  config: CoreConfig;
  appointments: UiAppointment[];
  exceptions: CalendarException[];
  onClose: () => void;
  onCreated: () => void;
}

export function NewAppointmentModal({
  date,
  defaultStart,
  config,
  appointments,
  exceptions,
  onClose,
  onCreated,
}: NewAppointmentModalProps) {
  const [query, setQuery] = useState('');
  const [patientId, setPatientId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PatientHit[]>([]);
  const [mode, setMode] = useState<Mode>(config.defaultMode);
  const [duration, setDuration] = useState(config.defaultDurationMin);
  const [startMin, setStartMin] = useState(defaultStart);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [weekdays, setWeekdays] = useState<Weekday[]>([weekdayOf(date)]);
  const [sessions, setSessions] = useState(12);
  const [seriesPlan, setSeriesPlan] = useState<{ valid: Occurrence[]; conflicts: OccurrenceValidation[] } | null>(
    null,
  );

  // Slots del core: horario, excepciones, cupo y "no en el pasado" (RN-011/021/050)
  const options = useMemo(
    () =>
      availableStarts({
        date,
        mode,
        durationMin: duration,
        config,
        existing: appointments,
        exceptions,
        now: zonedNow(config.timezone),
      }),
    [date, mode, duration, config, appointments, exceptions],
  );

  useEffect(() => {
    if (!options.includes(startMin) && options.length > 0) setStartMin(options[0]!);
  }, [options, startMin]);

  // RN-122: sugerencias por similitud mientras se escribe el nombre
  useEffect(() => {
    if (patientId || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      searchPatients(query.trim())
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, patientId]);

  const canSubmit = !busy && options.length > 0 && (patientId !== null || query.trim().length > 0);

  // RN-071: se validan TODAS las ocurrencias antes de confirmar
  const prepareSeries = () => {
    if (weekdays.length === 0) {
      setError('Elige al menos un día de la semana');
      return;
    }
    if (sessions < 1 || sessions > 52) {
      setError('El número de sesiones debe estar entre 1 y 52');
      return;
    }
    setError(null);
    const occurrences = expandWeeklySeries({
      weekdays: [...weekdays].sort((a, b) => a - b),
      startMin,
      durationMin: duration,
      mode,
      firstDate: date,
      end: { type: 'count', sessions },
    });
    const results = validateSeries(occurrences, config, appointments, exceptions);
    setSeriesPlan({
      valid: results.filter(r => r.ok).map(r => r.occurrence),
      conflicts: results.filter(r => !r.ok),
    });
  };

  const submitSeries = async () => {
    if (!seriesPlan || seriesPlan.valid.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await createSeries({
        tz: config.timezone,
        occurrences: seriesPlan.valid.map(o => ({ date: o.date, startMin: o.startMin })),
        durationMin: duration,
        mode,
        patientId,
        patientName: patientId ? null : query.trim(),
        weekdays: [...weekdays].sort((a, b) => a - b),
        startMin,
        endSessions: sessions,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la serie');
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await createAppointment({
        tz: config.timezone,
        date,
        startMin,
        durationMin: duration,
        mode,
        patientId,
        patientName: patientId ? null : query.trim(),
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la cita');
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`Nueva cita · ${date}`} onClose={onClose}>
      <div className="mb-3 position-relative">
        <label className="form-label small text-secondary" htmlFor="patient">
          Paciente
        </label>
        <input
          id="patient"
          className="form-control"
          placeholder="Nombre del paciente"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setPatientId(null);
          }}
          autoFocus
        />
        {suggestions.length > 0 && (
          <div className="list-group position-absolute w-100 shadow-sm" style={{ zIndex: 5 }}>
            {suggestions.map(s => (
              <button
                key={s.id}
                type="button"
                className="list-group-item list-group-item-action py-2"
                onClick={() => {
                  setPatientId(s.id);
                  setQuery(s.name);
                  setSuggestions([]);
                }}
              >
                {s.name}
                {s.phone && <small className="text-secondary ms-2">{s.phone}</small>}
              </button>
            ))}
          </div>
        )}
        {!patientId && query.trim().length > 1 && suggestions.length === 0 && (
          <small className="text-secondary">
            <i className="bi bi-person-plus me-1" aria-hidden="true" />
            Se creará el paciente «{query.trim()}» junto con la cita
          </small>
        )}
      </div>

      <div className="row g-2 mb-3">
        <div className="col-6">
          <label className="form-label small text-secondary" htmlFor="mode">
            Modalidad
          </label>
          <select id="mode" className="form-select" value={mode} onChange={e => setMode(e.target.value as Mode)}>
            <option value="in_clinic">{MODE_LABEL.in_clinic}</option>
            <option value="home_visit">{MODE_LABEL.home_visit}</option>
          </select>
        </div>
        <div className="col-6">
          <label className="form-label small text-secondary" htmlFor="duration">
            Duración (min)
          </label>
          <input
            id="duration"
            type="number"
            className="form-control"
            min={config.minDurationMin}
            max={config.maxDurationMin}
            step={15}
            value={duration}
            onChange={e => setDuration(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="form-label small text-secondary" htmlFor="start">
          Hora
        </label>
        {options.length > 0 ? (
          <select id="start" className="form-select" value={startMin} onChange={e => setStartMin(Number(e.target.value))}>
            {options.map(o => (
              <option key={o} value={o}>
                {toHHMM(o)}
              </option>
            ))}
          </select>
        ) : (
          <div className="alert alert-warning py-2 small mb-0">
            No hay horarios disponibles para {MODE_LABEL[mode].toLowerCase()} este día.
          </div>
        )}
      </div>

      <div className="form-check form-switch mb-2">
        <input
          className="form-check-input"
          type="checkbox"
          id="repeat"
          checked={repeat}
          onChange={e => {
            setRepeat(e.target.checked);
            setSeriesPlan(null);
          }}
        />
        <label className="form-check-label" htmlFor="repeat">
          Repetir semanalmente (serie)
        </label>
      </div>

      {repeat && (
        <div className="mb-3">
          <div className="d-flex gap-1 mb-2">
            {WEEKDAY_BTNS.map(([d, label]) => (
              <button
                key={d}
                type="button"
                className={`btn btn-sm flex-fill ${weekdays.includes(d) ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => {
                  setWeekdays(w => (w.includes(d) ? w.filter(x => x !== d) : [...w, d]));
                  setSeriesPlan(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="d-flex align-items-center gap-2">
            <label htmlFor="sessions" className="form-label small text-secondary mb-0">
              Sesiones
            </label>
            <input
              id="sessions"
              type="number"
              className="form-control"
              style={{ width: 90 }}
              min={1}
              max={52}
              value={sessions}
              onChange={e => {
                setSessions(Number(e.target.value));
                setSeriesPlan(null);
              }}
            />
          </div>
        </div>
      )}

      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      {seriesPlan ? (
        <div>
          <div className="alert alert-light border py-2 small mb-2">
            Se agendarán <strong>{seriesPlan.valid.length}</strong> sesiones
            {seriesPlan.valid.length > 0 && (
              <>
                {' '}
                · primera {fmtDate(seriesPlan.valid[0]!.date)} · última{' '}
                {fmtDate(seriesPlan.valid[seriesPlan.valid.length - 1]!.date)}
              </>
            )}
          </div>
          {seriesPlan.conflicts.length > 0 && (
            <div className="alert alert-warning py-2 small mb-2">
              <p className="mb-1 fw-semibold">Se omitirán {seriesPlan.conflicts.length} sesiones por conflicto:</p>
              {seriesPlan.conflicts.map(c => (
                <div key={c.occurrence.date}>
                  {fmtDate(c.occurrence.date)} — {c.reasons.includes('sin_cupo') ? 'sin cupo' : 'fuera de horario'}
                </div>
              ))}
            </div>
          )}
          <div className="d-flex gap-2">
            <button
              className="btn btn-primary flex-fill"
              disabled={busy || seriesPlan.valid.length === 0 || (patientId === null && query.trim().length === 0)}
              onClick={submitSeries}
            >
              {busy ? 'Guardando…' : `Agendar ${seriesPlan.valid.length} sesiones`}
            </button>
            <button className="btn btn-outline-secondary" disabled={busy} onClick={() => setSeriesPlan(null)}>
              Volver
            </button>
          </div>
        </div>
      ) : (
        <div className="d-flex gap-2">
          <button
            className="btn btn-primary flex-fill"
            disabled={!canSubmit}
            onClick={() => (repeat ? prepareSeries() : void submit())}
          >
            {busy ? 'Guardando…' : repeat ? 'Revisar serie' : 'Agendar'}
          </button>
          <button className="btn btn-outline-secondary" onClick={onClose}>
            Cancelar
          </button>
        </div>
      )}
    </ModalShell>
  );
}

export interface AppointmentDetailModalProps {
  appt: UiAppointment;
  config: CoreConfig;
  appointments: UiAppointment[];
  exceptions: CalendarException[];
  onClose: () => void;
  onChanged: () => void;
}

type DetailPane = 'info' | 'cancel' | 'reschedule';

export function AppointmentDetailModal({
  appt,
  config,
  appointments,
  exceptions,
  onClose,
  onChanged,
}: AppointmentDetailModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<DetailPane>('info');
  const [reason, setReason] = useState('');
  const [newDate, setNewDate] = useState(appt.date);
  const [newStart, setNewStart] = useState(appt.startMin);

  // Slots destino de la reagenda: misma modalidad y duración (RN-121),
  // excluyendo la propia cita del conteo de cupo
  const rescheduleOptions = useMemo(
    () =>
      availableStarts({
        date: newDate,
        mode: appt.mode,
        durationMin: appt.durationMin,
        config,
        existing: appointments.filter(a => a.id !== appt.id),
        exceptions,
        now: zonedNow(config.timezone),
      }),
    [newDate, appt, config, appointments, exceptions],
  );

  useEffect(() => {
    if (pane === 'reschedule' && rescheduleOptions.length > 0 && !rescheduleOptions.includes(newStart)) {
      setNewStart(rescheduleOptions[0]!);
    }
  }, [pane, rescheduleOptions, newStart]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar la cita');
      setBusy(false);
    }
  };

  return (
    <ModalShell title={appt.patientName} onClose={onClose}>
      <p className="mb-2">
        <i className="bi bi-clock me-2" aria-hidden="true" />
        {appt.date} · {toHHMM(appt.startMin)}–{toHHMM(appt.startMin + appt.durationMin)}
        <br />
        <i className={`bi ${appt.mode === 'home_visit' ? 'bi-house-door' : 'bi-building'} me-2`} aria-hidden="true" />
        {MODE_LABEL[appt.mode]}
        {appt.seriesId && (
          <>
            <br />
            <i className="bi bi-arrow-repeat me-2" aria-hidden="true" />
            Parte de una serie semanal
          </>
        )}
        {appt.status !== 'scheduled' && (
          <>
            <br />
            <i className="bi bi-flag me-2" aria-hidden="true" />
            Estado: {appt.status === 'completed' ? 'completada' : 'no llegó'}
          </>
        )}
      </p>

      <div className="form-check form-switch mb-3">
        <input
          className="form-check-input"
          type="checkbox"
          id="paid"
          checked={appt.paid}
          disabled={busy}
          onChange={() => run(() => setPaymentStatus(appt.id, !appt.paid))}
        />
        <label className="form-check-label" htmlFor="paid">
          {appt.paid ? 'Pagada' : 'Pago pendiente'}
        </label>
      </div>

      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      {appt.status === 'scheduled' && pane === 'info' && (
        <div className="d-flex flex-wrap gap-2">
          <button
            className="btn btn-outline-success btn-sm"
            disabled={busy}
            onClick={() => run(() => updateAppointmentStatus(appt.id, 'completed'))}
          >
            <i className="bi bi-check2 me-1" aria-hidden="true" />
            Completada
          </button>
          <button
            className="btn btn-outline-warning btn-sm"
            disabled={busy}
            onClick={() => run(() => updateAppointmentStatus(appt.id, 'no_show'))}
          >
            <i className="bi bi-person-x me-1" aria-hidden="true" />
            No llegó
          </button>
          <button className="btn btn-outline-primary btn-sm" disabled={busy} onClick={() => setPane('reschedule')}>
            <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />
            Reagendar
          </button>
          <button className="btn btn-outline-danger btn-sm ms-auto" disabled={busy} onClick={() => setPane('cancel')}>
            <i className="bi bi-x-circle me-1" aria-hidden="true" />
            Cancelar cita
          </button>
        </div>
      )}

      {pane === 'cancel' && (
        <div>
          <label className="form-label small text-secondary" htmlFor="reason">
            Motivo (opcional)
          </label>
          <input id="reason" className="form-control mb-2" value={reason} onChange={e => setReason(e.target.value)} />
          {appt.seriesId ? (
            // RN-072: tres alcances de cancelación para citas de serie
            <div className="d-grid gap-2">
              <button
                className="btn btn-danger btn-sm"
                disabled={busy}
                onClick={() => run(() => updateAppointmentStatus(appt.id, 'cancelled', reason.trim() || undefined))}
              >
                Cancelar solo esta sesión
              </button>
              <button
                className="btn btn-outline-danger btn-sm"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    cancelSeriesAppointments({
                      seriesId: appt.seriesId!,
                      tz: config.timezone,
                      fromDate: appt.date,
                      fromStartMin: appt.startMin,
                      reason: reason.trim() || undefined,
                    }),
                  )
                }
              >
                Cancelar esta y las siguientes
              </button>
              <button
                className="btn btn-outline-danger btn-sm"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    cancelSeriesAppointments({
                      seriesId: appt.seriesId!,
                      tz: config.timezone,
                      reason: reason.trim() || undefined,
                    }),
                  )
                }
              >
                Cancelar toda la serie
              </button>
              <button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => setPane('info')}>
                Volver
              </button>
            </div>
          ) : (
            <div className="d-flex gap-2">
              <button
                className="btn btn-danger btn-sm"
                disabled={busy}
                onClick={() => run(() => updateAppointmentStatus(appt.id, 'cancelled', reason.trim() || undefined))}
              >
                Confirmar cancelación
              </button>
              <button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => setPane('info')}>
                Volver
              </button>
            </div>
          )}
        </div>
      )}

      {pane === 'reschedule' && (
        <div>
          <div className="row g-2 mb-2">
            <div className="col-6">
              <label className="form-label small text-secondary" htmlFor="newdate">
                Nueva fecha
              </label>
              <input
                id="newdate"
                type="date"
                className="form-control"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
              />
            </div>
            <div className="col-6">
              <label className="form-label small text-secondary" htmlFor="newstart">
                Nueva hora
              </label>
              {rescheduleOptions.length > 0 ? (
                <select
                  id="newstart"
                  className="form-select"
                  value={newStart}
                  onChange={e => setNewStart(Number(e.target.value))}
                >
                  {rescheduleOptions.map(o => (
                    <option key={o} value={o}>
                      {toHHMM(o)}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="form-text text-danger">Sin horarios ese día</div>
              )}
            </div>
          </div>
          <p className="form-text mb-2">
            La cita original quedará cancelada y vinculada a la nueva; el historial se conserva.
          </p>
          <div className="d-flex gap-2">
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || rescheduleOptions.length === 0}
              onClick={() =>
                run(() =>
                  rescheduleAppointment({ id: appt.id, tz: config.timezone, date: newDate, startMin: newStart }),
                )
              }
            >
              Confirmar reagenda
            </button>
            <button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => setPane('info')}>
              Volver
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

export interface BlockTimeModalProps {
  date: string;
  appointments: UiAppointment[];
  onClose: () => void;
  onCreated: () => void;
}

/** RN-060/062: crear excepción de calendario por táctil, avisando citas afectadas */
export function BlockTimeModal({ date: initialDate, appointments, onClose, onCreated }: BlockTimeModalProps) {
  const [date, setDate] = useState(initialDate);
  const [allDay, setAllDay] = useState(false);
  const [from, setFrom] = useState('12:00');
  const [to, setTo] = useState('13:00');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startMin = /^\d{1,2}:\d{2}$/.test(from) ? toMinutes(from) : 0;
  const endMin = /^\d{1,2}:\d{2}$/.test(to) ? toMinutes(to) : 0;

  // RN-062: el bloqueo NUNCA cancela citas en silencio — se listan y el
  // profesional decide después qué hacer con cada una
  const affected = appointments.filter(
    a =>
      a.date === date &&
      a.status === 'scheduled' &&
      (allDay || (a.startMin < endMin && startMin < a.startMin + a.durationMin)),
  );

  const submit = async () => {
    if (!allDay && startMin >= endMin) {
      setError('La hora de inicio debe ser menor que la de fin');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createException(
        allDay
          ? { type: 'holiday', date, reason: reason.trim() || null }
          : { type: 'time_block', date, startMin, endMin, reason: reason.trim() || null },
      );
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el bloqueo');
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Bloquear tiempo" onClose={onClose}>
      <div className="row g-2 mb-2">
        <div className="col-6">
          <label className="form-label small text-secondary" htmlFor="b-date">
            Fecha
          </label>
          <input id="b-date" type="date" className="form-control" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="col-6 d-flex align-items-end">
          <div className="form-check form-switch mb-2">
            <input
              className="form-check-input"
              type="checkbox"
              id="b-allday"
              checked={allDay}
              onChange={e => setAllDay(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="b-allday">
              Todo el día
            </label>
          </div>
        </div>
      </div>

      {!allDay && (
        <div className="row g-2 mb-2">
          <div className="col-6">
            <label className="form-label small text-secondary" htmlFor="b-from">
              Desde
            </label>
            <input id="b-from" type="time" className="form-control" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="col-6">
            <label className="form-label small text-secondary" htmlFor="b-to">
              Hasta
            </label>
            <input id="b-to" type="time" className="form-control" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </div>
      )}

      <div className="mb-3">
        <label className="form-label small text-secondary" htmlFor="b-reason">
          Motivo (opcional)
        </label>
        <input
          id="b-reason"
          className="form-control"
          placeholder="Almuerzo, trámite, feriado…"
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
      </div>

      {affected.length > 0 && (
        <div className="alert alert-warning py-2 small mb-3">
          <p className="mb-1 fw-semibold">
            <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
            {affected.length} cita{affected.length > 1 ? 's quedan' : ' queda'} dentro del bloqueo y NO se cancelan
            automáticamente:
          </p>
          {affected.map(a => (
            <div key={a.id}>
              {a.patientName} · {toHHMM(a.startMin)}
            </div>
          ))}
          <p className="mb-0 mt-1">Decide reagendarlas o cancelarlas una por una desde el calendario.</p>
        </div>
      )}

      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      <div className="d-flex gap-2">
        <button className="btn btn-primary flex-fill" disabled={busy} onClick={submit}>
          {busy ? 'Guardando…' : 'Bloquear'}
        </button>
        <button className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
      </div>
    </ModalShell>
  );
}
