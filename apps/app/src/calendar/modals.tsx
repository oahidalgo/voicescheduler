import { useEffect, useMemo, useState } from 'react';
import { availableStarts, toHHMM, zonedNow } from '@voicescheduler/core';
import type { CalendarException, CoreConfig, Mode } from '@voicescheduler/core';
import {
  createAppointment,
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

      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      <div className="d-flex gap-2">
        <button className="btn btn-primary flex-fill" disabled={!canSubmit} onClick={submit}>
          {busy ? 'Guardando…' : 'Agendar'}
        </button>
        <button className="btn btn-outline-secondary" onClick={onClose}>
          Cancelar
        </button>
      </div>
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
