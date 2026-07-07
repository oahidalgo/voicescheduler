import { mergeRanges, subtractRanges } from './time';
import { weekdayOf } from './dates';
import type { CoreConfig } from './config';
import type { CalendarException, Mode, TimeRange } from './types';

export function dayBlockedBy(date: string, exceptions: CalendarException[]): CalendarException | undefined {
  return exceptions.find(
    e =>
      (e.type === 'holiday' && e.date === date) ||
      (e.type === 'vacation' && e.dateFrom <= date && date <= e.dateTo),
  );
}

/**
 * Horario efectivo de un día para una modalidad, aplicando la prioridad RN-061:
 * vacation / holiday > time_block > extended_hours > horario regular.
 */
export function effectiveRanges(
  date: string,
  mode: Mode,
  config: CoreConfig,
  exceptions: CalendarException[],
): TimeRange[] {
  if (dayBlockedBy(date, exceptions)) return [];

  const regular: TimeRange[] = (config.workingHours[weekdayOf(date)] ?? [])
    .filter(r => r.modes.includes(mode))
    .map(r => ({ startMin: r.startMin, endMin: r.endMin }));

  const extended: TimeRange[] = [];
  const blocks: TimeRange[] = [];
  for (const e of exceptions) {
    if (e.type === 'extended_hours' && e.date === date && (!e.modes || e.modes.includes(mode))) {
      extended.push({ startMin: e.startMin, endMin: e.endMin });
    }
    if (e.type === 'time_block' && e.date === date) {
      blocks.push({ startMin: e.startMin, endMin: e.endMin });
    }
  }

  return subtractRanges(mergeRanges([...regular, ...extended]), blocks);
}
