import { overlaps } from './time';
import type { CoreConfig } from './config';
import type { ExistingAppointment, Mode, Occurrence, TimeRange } from './types';

/** RN-041: la disponibilidad evalúa el rango extendido por los buffers de la modalidad. */
export function bufferedInterval(occ: Occurrence, config: CoreConfig): TimeRange {
  const b = config.buffers[occ.mode];
  return {
    startMin: occ.startMin - b.beforeMin,
    endMin: occ.startMin + occ.durationMin + b.afterMin,
  };
}

/** RN-022: home_visit nunca admite más de 1, aunque la configuración diga otra cosa. */
export function capacityLimit(config: CoreConfig, mode: Mode): number {
  const limit = config.maxConcurrent[mode];
  return mode === 'home_visit' ? Math.min(limit, 1) : limit;
}

/**
 * RN-021: cuenta citas que se solapan en el tiempo, no las que inician a la
 * misma hora. Devuelve el pico de concurrencia si se agregara `candidate`,
 * contando solo citas `scheduled` de la misma fecha y modalidad.
 */
export function peakConcurrency(
  candidate: Occurrence,
  existing: ExistingAppointment[],
  config: CoreConfig,
): number {
  const cand = bufferedInterval(candidate, config);
  const intervals = existing
    .filter(a => a.status === 'scheduled' && a.date === candidate.date && a.mode === candidate.mode)
    .map(a => bufferedInterval(a, config))
    .filter(iv => overlaps(iv, cand));

  const points = [
    cand.startMin,
    ...intervals.map(iv => iv.startMin).filter(p => p > cand.startMin && p < cand.endMin),
  ];
  let peak = 0;
  for (const p of points) {
    const count = 1 + intervals.filter(iv => iv.startMin <= p && p < iv.endMin).length;
    if (count > peak) peak = count;
  }
  return peak;
}

export interface CapacityCheck {
  ok: boolean;
  peak: number;
  limit: number;
}

/** RN-020/021/022/041 */
export function checkCapacity(
  candidate: Occurrence,
  existing: ExistingAppointment[],
  config: CoreConfig,
): CapacityCheck {
  const limit = capacityLimit(config, candidate.mode);
  const peak = peakConcurrency(candidate, existing, config);
  return { ok: peak <= limit, peak, limit };
}
