import type { Weekday } from './types';

const DAY_MS = 86_400_000;

function toUTC(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function fromUTC(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function weekdayOf(dateISO: string): Weekday {
  const dow = new Date(toUTC(dateISO)).getUTCDay();
  return (dow === 0 ? 7 : dow) as Weekday;
}

export function addDays(dateISO: string, days: number): string {
  return fromUTC(toUTC(dateISO) + days * DAY_MS);
}

export function dayDiff(fromISO: string, toISO: string): number {
  return Math.round((toUTC(toISO) - toUTC(fromISO)) / DAY_MS);
}

export function daysInMonth(dateISO: string): number {
  const [y, m] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** Momento actual expresado en la timezone del tenant. */
export interface ZonedNow {
  date: string;
  minutes: number;
  weekday: Weekday;
}

export function zonedNow(timeZone: string, at: Date = new Date()): ZonedNow {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: weekdayOf(date) };
}

/**
 * Instante UTC que corresponde a una hora de pared en la timezone dada.
 * Corrección iterativa en dos pasadas: cubre cualquier offset IANA sin tablas.
 */
export function zonedTimeToUtc(dateISO: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  let guess = Date.UTC(y!, m! - 1, d!, Math.floor(minutes / 60), minutes % 60);
  for (let i = 0; i < 2; i++) {
    const local = zonedNow(timeZone, new Date(guess));
    const diff = dayDiff(dateISO, local.date) * 1440 + local.minutes - minutes;
    if (diff === 0) break;
    guess -= diff * 60_000;
  }
  return new Date(guess);
}

/** RN-123: el NLU devuelve estructuras relativas; el backend las resuelve. */
export type RelativeDate =
  | { type: 'today' }
  | { type: 'tomorrow' }
  | { type: 'next_weekday'; weekday: Weekday }
  | { type: 'weekday_after_next'; weekday: Weekday }
  | { type: 'day_of_current_month'; day: number }
  | { type: 'current_week' };

export type ResolvedDate =
  | { kind: 'date'; date: string }
  | { kind: 'range'; from: string; to: string };

/**
 * RN-123 / RN-125: resolución determinista contra `capturedAt` y la timezone
 * del tenant, nunca contra el momento de sincronización.
 * Convención: "el miércoles" dicho un miércoles resuelve a hoy; si la hora ya
 * pasó, RN-050 rechaza la cita y fuerza la aclaración.
 */
export function resolveRelativeDate(rel: RelativeDate, capturedAt: Date, timeZone: string): ResolvedDate {
  const today = zonedNow(timeZone, capturedAt);
  switch (rel.type) {
    case 'today':
      return { kind: 'date', date: today.date };
    case 'tomorrow':
      return { kind: 'date', date: addDays(today.date, 1) };
    case 'next_weekday':
      return { kind: 'date', date: addDays(today.date, (rel.weekday - today.weekday + 7) % 7) };
    case 'weekday_after_next':
      return { kind: 'date', date: addDays(today.date, ((rel.weekday - today.weekday + 7) % 7) + 7) };
    case 'day_of_current_month': {
      if (rel.day < 1 || rel.day > daysInMonth(today.date)) {
        throw new Error(`Día inválido para el mes actual: ${rel.day}`);
      }
      return { kind: 'date', date: `${today.date.slice(0, 8)}${String(rel.day).padStart(2, '0')}` };
    }
    case 'current_week':
      return { kind: 'range', from: today.date, to: addDays(today.date, 7 - today.weekday) };
  }
}
