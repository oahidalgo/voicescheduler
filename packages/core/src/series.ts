import { addDays, weekdayOf } from './dates';
import { effectiveRanges } from './exceptions';
import { checkCapacity } from './capacity';
import type { CoreConfig } from './config';
import type { CalendarException, ExistingAppointment, Mode, Occurrence, Weekday } from './types';

/** RN-070/073: V1 implementa únicamente el patrón semanal. */
export interface WeeklySeriesRule {
  weekdays: Weekday[];
  startMin: number;
  durationMin: number;
  mode: Mode;
  /** Primera fecha candidata, inclusive. */
  firstDate: string;
  end: { type: 'count'; sessions: number } | { type: 'until'; date: string };
}

const MAX_HORIZON_DAYS = 366;

export function expandWeeklySeries(rule: WeeklySeriesRule): Occurrence[] {
  if (rule.weekdays.length === 0) return [];
  const out: Occurrence[] = [];
  let date = rule.firstDate;
  for (let i = 0; i < MAX_HORIZON_DAYS; i++) {
    if (rule.end.type === 'until' && date > rule.end.date) break;
    if (rule.end.type === 'count' && out.length >= rule.end.sessions) break;
    if (rule.weekdays.includes(weekdayOf(date))) {
      out.push({ date, startMin: rule.startMin, durationMin: rule.durationMin, mode: rule.mode });
    }
    date = addDays(date, 1);
  }
  return out;
}

export interface OccurrenceValidation {
  occurrence: Occurrence;
  ok: boolean;
  reasons: ('fuera_de_horario' | 'sin_cupo')[];
}

/**
 * RN-071: valida todas las ocurrencias antes de confirmar; los conflictos se
 * listan individualmente para que el profesional decida sobre cada uno.
 */
export function validateSeries(
  occurrences: Occurrence[],
  config: CoreConfig,
  existing: ExistingAppointment[],
  exceptions: CalendarException[],
): OccurrenceValidation[] {
  return occurrences.map(occurrence => {
    const reasons: OccurrenceValidation['reasons'] = [];
    const fits = effectiveRanges(occurrence.date, occurrence.mode, config, exceptions).some(
      r => r.startMin <= occurrence.startMin && occurrence.startMin + occurrence.durationMin <= r.endMin,
    );
    if (!fits) {
      reasons.push('fuera_de_horario');
    } else if (!checkCapacity(occurrence, existing, config).ok) {
      reasons.push('sin_cupo');
    }
    return { occurrence, ok: reasons.length === 0, reasons };
  });
}
