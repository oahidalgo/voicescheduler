import { effectiveRanges } from './exceptions';
import { checkCapacity } from './capacity';
import { validateStart } from './lifecycle';
import type { ZonedNow } from './dates';
import type { CoreConfig } from './config';
import type { CalendarException, ExistingAppointment, Mode, Occurrence } from './types';

export interface AvailabilityQuery {
  date: string;
  mode: Mode;
  durationMin: number;
  config: CoreConfig;
  existing: ExistingAppointment[];
  exceptions: CalendarException[];
  /** Si se pasa, aplica también RN-050/051 (pasado y anticipación). */
  now?: ZonedNow;
}

/**
 * Inicios de cita disponibles para un día y modalidad. Los slots se calculan,
 * nunca se persisten (glosario del dominio).
 * RN-011: el slot debe caber íntegro en un rango cuya modalidad aplique.
 * RN-012: los inicios se alinean a la granularidad, anclada a medianoche.
 */
export function availableStarts(q: AvailabilityQuery): number[] {
  const g = q.config.slotGranularityMin;
  const starts: number[] = [];
  for (const range of effectiveRanges(q.date, q.mode, q.config, q.exceptions)) {
    const first = Math.ceil(range.startMin / g) * g;
    for (let s = first; s + q.durationMin <= range.endMin; s += g) {
      const candidate: Occurrence = { date: q.date, startMin: s, durationMin: q.durationMin, mode: q.mode };
      if (q.now && validateStart(candidate, q.now, q.config).length > 0) continue;
      if (!checkCapacity(candidate, q.existing, q.config).ok) continue;
      starts.push(s);
    }
  }
  return [...new Set(starts)].sort((a, b) => a - b);
}

/** Validación puntual de un inicio concreto (la que usa el flujo de agendar). */
export function isStartAvailable(q: AvailabilityQuery & { startMin: number }): boolean {
  const fits = effectiveRanges(q.date, q.mode, q.config, q.exceptions).some(
    r => r.startMin <= q.startMin && q.startMin + q.durationMin <= r.endMin,
  );
  if (!fits) return false;
  const candidate: Occurrence = { date: q.date, startMin: q.startMin, durationMin: q.durationMin, mode: q.mode };
  if (q.now && validateStart(candidate, q.now, q.config).length > 0) return false;
  return checkCapacity(candidate, q.existing, q.config).ok;
}
