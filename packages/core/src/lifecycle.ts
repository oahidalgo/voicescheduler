import { dayDiff } from './dates';
import type { ZonedNow } from './dates';
import type { CoreConfig } from './config';
import type { AppointmentStatus, Occurrence } from './types';

/** RN-080: transiciones válidas. completed, no_show y cancelled son terminales (RN-082). */
const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  scheduled: ['completed', 'no_show', 'cancelled'],
  completed: [],
  no_show: [],
  cancelled: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: AppointmentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** RN-050: tolerancia para desfase de reloj del dispositivo. */
export const PAST_TOLERANCE_MIN = 5;

/** RN-050 + RN-051. Devuelve la lista de violaciones (vacía si el inicio es válido). */
export function validateStart(candidate: Occurrence, now: ZonedNow, config: CoreConfig): string[] {
  const errors: string[] = [];
  const daysAhead = dayDiff(now.date, candidate.date);
  const minutesAhead = daysAhead * 1440 + candidate.startMin - now.minutes;

  if (minutesAhead < -PAST_TOLERANCE_MIN) {
    errors.push('RN-050: la cita inicia en el pasado');
  }
  if (config.minAdvanceMin > 0 && minutesAhead < config.minAdvanceMin) {
    errors.push('RN-051: no cumple la anticipación mínima');
  }
  if (daysAhead > config.maxAdvanceDays) {
    errors.push('RN-051: excede la anticipación máxima');
  }
  return errors;
}
