import { effectiveRanges, mergeRanges, toHHMM } from '@voicescheduler/core';
import type { CalendarException, CoreConfig, TimeRange } from '@voicescheduler/core';
import type { UiAppointment } from '../data/sample';

const DEFAULT_START = 480; // 8:00
const DEFAULT_END = 1260; // 21:00
const HOUR_PX = 48;

interface Positioned extends UiAppointment {
  lane: number;
  lanes: number;
}

/** Carriles para citas solapadas de clínica (RN-163). */
function layoutLanes(appts: UiAppointment[]): Positioned[] {
  const sorted = [...appts].sort((a, b) => a.startMin - b.startMin || a.patientName.localeCompare(b.patientName));
  const laneEnds: number[] = [];
  const placed: Positioned[] = sorted.map(a => {
    let lane = laneEnds.findIndex(end => end <= a.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = a.startMin + a.durationMin;
    return { ...a, lane, lanes: 1 };
  });
  for (const p of placed) p.lanes = laneEnds.length;
  return placed;
}

export interface DayViewProps {
  date: string;
  appointments: UiAppointment[];
  exceptions: CalendarException[];
  config: CoreConfig;
  /** RN-162: tap en zona libre abre el formulario con la hora pre-llenada */
  onTapEmpty?: (startMin: number) => void;
  onTapAppointment?: (appt: UiAppointment) => void;
  onTapException?: (exception: CalendarException) => void;
}

export function DayView({
  date,
  appointments,
  exceptions,
  config,
  onTapEmpty,
  onTapAppointment,
  onTapException,
}: DayViewProps) {
  const dayAppts = appointments.filter(a => a.date === date && a.status !== 'cancelled');
  const clinic = layoutLanes(dayAppts.filter(a => a.mode === 'in_clinic'));
  const home = dayAppts.filter(a => a.mode === 'home_visit');

  // Zonas fuera de horario (RN-162): complemento de la unión de rangos efectivos
  const working = mergeRanges([
    ...effectiveRanges(date, 'in_clinic', config, exceptions),
    ...effectiveRanges(date, 'home_visit', config, exceptions),
  ]);

  // La cuadrícula se amplía para siempre cubrir citas y horario de atención,
  // aunque caigan fuera del rango por defecto (p.ej. citas antes de las 8:00).
  const candidateStarts = [DEFAULT_START, ...dayAppts.map(a => a.startMin), ...working.map(r => r.startMin)];
  const candidateEnds = [
    DEFAULT_END,
    ...dayAppts.map(a => a.startMin + a.durationMin),
    ...working.map(r => r.endMin),
  ];
  const START = Math.floor(Math.min(...candidateStarts) / 60) * 60;
  const END = Math.ceil(Math.max(...candidateEnds) / 60) * 60;

  const y = (min: number) => ((min - START) / 60) * HOUR_PX;
  const h = (from: number, to: number) => y(to) - y(from);

  const dims: TimeRange[] = [];
  let cursor = START;
  for (const r of working) {
    if (r.startMin > cursor) dims.push({ startMin: cursor, endMin: r.startMin });
    cursor = Math.max(cursor, r.endMin);
  }
  if (cursor < END) dims.push({ startMin: cursor, endMin: END });

  const dayExceptions = exceptions.filter(
    e => (e.type === 'time_block' || e.type === 'extended_hours') && e.date === date,
  );

  // RN-163: por cada tramo ocupado, cupos usados y acceso directo a agendar otro
  const clinicLimit = config.maxConcurrent.in_clinic;
  const addSlots = [...new Set(clinic.map(a => a.startMin))].map(s => ({
    s,
    count: clinic.filter(a => a.startMin <= s && s < a.startMin + a.durationMin).length,
  }));

  const hours = [];
  for (let m = START; m <= END; m += 60) hours.push(m);

  const buffer = config.buffers.home_visit.afterMin;

  return (
    <div className="vs-cal" style={{ height: y(END) + 8 }}>
      {hours.map(m => (
        <div key={m}>
          <div className="vs-hourline" style={{ top: y(m) }} />
          {m < END && (
            <span className="vs-hourlabel" style={{ top: y(m) }}>
              {toHHMM(m)}
            </span>
          )}
        </div>
      ))}
      <div
        className="vs-grid"
        style={onTapEmpty ? { cursor: 'pointer' } : undefined}
        onClick={
          onTapEmpty
            ? e => {
                const rect = e.currentTarget.getBoundingClientRect();
                const min = START + ((e.clientY - rect.top) / HOUR_PX) * 60;
                const g = config.slotGranularityMin;
                onTapEmpty(Math.max(START, Math.floor(min / g) * g));
              }
            : undefined
        }
      >
        {dims.map(r => (
          <div key={`dim-${r.startMin}`} className="vs-dim" style={{ top: y(r.startMin) + 1, height: h(r.startMin, r.endMin) - 2 }} />
        ))}
        {dayExceptions.map((e, i) =>
          e.type === 'time_block' ? (
            <div
              key={`ex-${i}`}
              className="vs-exception"
              style={{
                top: y(e.startMin) + 1,
                height: h(e.startMin, e.endMin) - 2,
                cursor: onTapException ? 'pointer' : undefined,
              }}
              onClick={
                onTapException
                  ? ev => {
                      ev.stopPropagation();
                      onTapException(e);
                    }
                  : undefined
              }
            >
              <i className="bi bi-lock" aria-hidden="true" />
              {e.reason ?? 'Bloqueado'}
            </div>
          ) : null,
        )}
        {clinic.map(a => (
          <div
            key={a.id}
            className={`vs-apt vs-apt-clinic${a.status !== 'scheduled' ? ' vs-apt-done' : ''}`}
            onClick={
              onTapAppointment
                ? e => {
                    e.stopPropagation();
                    onTapAppointment(a);
                  }
                : undefined
            }
            style={{
              top: y(a.startMin) + 1,
              height: h(a.startMin, a.startMin + a.durationMin) - 2,
              left: `calc((100% - 32px) * ${a.lane / a.lanes})`,
              width: `calc((100% - 32px) / ${a.lanes} - 4px)`,
            }}
          >
            <span className="vs-apt-name">{a.patientName}</span>{' '}
            {a.status === 'completed' && <i className="bi bi-check2-circle" aria-hidden="true" title="Completada" />}
            {a.status === 'no_show' && <i className="bi bi-person-x" aria-hidden="true" title="No llegó" />}{' '}
            {!a.paid && (
              <span className="vs-unpaid">
                <i className="bi bi-wallet2" aria-hidden="true" title="Pago pendiente" />
              </span>
            )}
            <br />
            <span className="vs-apt-time">
              {toHHMM(a.startMin)}–{toHHMM(a.startMin + a.durationMin)}
            </span>
          </div>
        ))}
        {home.map(a => (
          <div key={a.id}>
            <div
              className={`vs-apt vs-apt-home${a.status !== 'scheduled' ? ' vs-apt-done' : ''}`}
              onClick={
                onTapAppointment
                  ? e => {
                      e.stopPropagation();
                      onTapAppointment(a);
                    }
                  : undefined
              }
              style={{ top: y(a.startMin) + 1, height: h(a.startMin, a.startMin + a.durationMin) - 2, left: 0, right: 0 }}
            >
              <span className="vs-apt-name">
                <i className="bi bi-house-door" aria-hidden="true" /> {a.patientName}
              </span>{' '}
              {!a.paid && (
                <span className="vs-unpaid">
                  <i className="bi bi-wallet2" aria-hidden="true" title="Pago pendiente" />
                </span>
              )}
              <br />
              <span className="vs-apt-time">
                {toHHMM(a.startMin)}–{toHHMM(a.startMin + a.durationMin)} · domicilio
              </span>
            </div>
            {buffer > 0 && (
              <div
                className="vs-exception"
                style={{
                  top: y(a.startMin + a.durationMin) + 2,
                  height: h(0, buffer) - 4,
                  borderColor: 'var(--vs-home-border)',
                  color: 'var(--vs-home-time)',
                  background: 'transparent',
                }}
              >
                <i className="bi bi-car-front" aria-hidden="true" /> buffer traslado {buffer} min
              </div>
            )}
          </div>
        ))}
        {addSlots.map(({ s, count }) => {
          const style = { top: y(s) + 1, height: h(0, 60) - 2 };
          if (count < clinicLimit && onTapEmpty) {
            return (
              <button
                key={`add-${s}`}
                className="vs-add-lane"
                style={style}
                aria-label={`Agregar otra cita a las ${toHHMM(s)} (${count} de ${clinicLimit} cupos ocupados)`}
                onClick={e => {
                  e.stopPropagation();
                  onTapEmpty(s);
                }}
              >
                <i className="bi bi-plus-lg" aria-hidden="true" />
                <span>
                  {count}/{clinicLimit}
                </span>
              </button>
            );
          }
          if (count >= clinicLimit || count > 1) {
            return (
              <span key={`add-${s}`} className={`vs-add-lane full${count >= clinicLimit ? ' maxed' : ''}`} style={style}>
                <span>
                  {count}/{clinicLimit}
                </span>
              </span>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
