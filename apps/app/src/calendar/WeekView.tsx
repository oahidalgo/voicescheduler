import { addDays, effectiveRanges, mergeRanges } from '@voicescheduler/core';
import type { CalendarException, CoreConfig } from '@voicescheduler/core';
import type { UiAppointment } from '../data/sample';

const DEFAULT_START = 540; // 9:00
const DEFAULT_END = 1260; // 21:00
const HOUR_PX = 24;

const DAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export interface WeekViewProps {
  monday: string;
  today: string;
  appointments: UiAppointment[];
  exceptions: CalendarException[];
  config: CoreConfig;
  onSelectDay: (date: string) => void;
}

export function WeekView({ monday, today, appointments, exceptions, config, onSelectDay }: WeekViewProps) {
  const days = DAY_LETTERS.map((letter, i) => {
    const date = addDays(monday, i);
    const working = mergeRanges([
      ...effectiveRanges(date, 'in_clinic', config, exceptions),
      ...effectiveRanges(date, 'home_visit', config, exceptions),
    ]);
    return { letter, date, dayNum: Number(date.slice(8)), working };
  });

  // La cuadrícula se amplía para siempre cubrir citas y horario de atención,
  // aunque caigan fuera del rango por defecto (p.ej. citas antes de las 9:00).
  const weekAppts = appointments.filter(a => a.status === 'scheduled' && days.some(d => d.date === a.date));
  const candidateStarts = [
    DEFAULT_START,
    ...weekAppts.map(a => a.startMin),
    ...days.flatMap(d => d.working.map(r => r.startMin)),
  ];
  const candidateEnds = [
    DEFAULT_END,
    ...weekAppts.map(a => a.startMin + a.durationMin),
    ...days.flatMap(d => d.working.map(r => r.endMin)),
  ];
  const START = Math.floor(Math.min(...candidateStarts) / 60) * 60;
  const END = Math.ceil(Math.max(...candidateEnds) / 60) * 60;
  const y = (min: number) => ((min - START) / 60) * HOUR_PX;

  const gridHeight = y(END);
  const hourLabels = [];
  for (let m = START; m <= END; m += 180) hourLabels.push(m);

  return (
    <div>
      <div className="vs-wk-head">
        <span />
        {days.map(d => (
          <div key={d.date}>
            {d.letter}
            <div className={`vs-wk-daynum${d.date === today ? ' today' : ''}`}>{d.dayNum}</div>
          </div>
        ))}
      </div>
      <div className="vs-wk-grid" style={{ height: gridHeight }}>
        <div>
          {hourLabels.map(m => (
            <div key={m} className="vs-wk-hourlabel" style={{ position: 'absolute', top: y(m) - 7 }}>
              {Math.floor(m / 60)}:00
            </div>
          ))}
        </div>
        {days.map(d => {
          const dayAppts = appointments.filter(a => a.date === d.date && a.status === 'scheduled');
          const starts = new Map<number, number>();
          return (
            <div
              key={d.date}
              className={`vs-wk-col${d.working.length === 0 ? ' dim' : ''}${d.date === today ? ' today' : ''}`}
              onClick={() => onSelectDay(d.date)}
              role="button"
            >
              {dayAppts.map(a => {
                const idx = starts.get(a.startMin) ?? 0;
                starts.set(a.startMin, idx + 1);
                const half = idx === 0 && dayAppts.some(o => o !== a && o.startMin === a.startMin) ? 'half-l' : idx > 0 ? 'half-r' : '';
                return (
                  <div
                    key={a.id}
                    className={`vs-wk-block ${a.mode === 'home_visit' ? 'home' : 'clinic'} ${half}`}
                    style={{ top: y(a.startMin) + 1, height: y(a.startMin + a.durationMin) - y(a.startMin) - 2 }}
                    title={a.patientName}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
