import { describe, expect, it } from 'vitest';
import { resolveRelativeDate, zonedNow, zonedTimeToUtc } from '../src/dates';

const TZ = 'America/Guatemala';
// Lunes 9 de marzo de 2026, 3:00 PM hora de Guatemala (UTC-6, sin DST)
const monday = new Date('2026-03-09T15:00:00-06:00');

describe('RN-123 — fechas relativas deterministas', () => {
  it('"el miércoles" desde un lunes resuelve al miércoles de esa semana', () => {
    expect(resolveRelativeDate({ type: 'next_weekday', weekday: 3 }, monday, TZ)).toEqual({
      kind: 'date',
      date: '2026-03-11',
    });
  });

  it('"mañana" resuelve al día siguiente en la timezone del tenant', () => {
    expect(resolveRelativeDate({ type: 'tomorrow' }, monday, TZ)).toEqual({
      kind: 'date',
      date: '2026-03-10',
    });
  });

  it('"el otro lunes" dicho un lunes salta a la semana siguiente', () => {
    expect(resolveRelativeDate({ type: 'weekday_after_next', weekday: 1 }, monday, TZ)).toEqual({
      kind: 'date',
      date: '2026-03-16',
    });
  });

  it('"el 15" resuelve al día 15 del mes en curso', () => {
    expect(resolveRelativeDate({ type: 'day_of_current_month', day: 15 }, monday, TZ)).toEqual({
      kind: 'date',
      date: '2026-03-15',
    });
  });

  it('"esta semana" va de hoy al domingo', () => {
    expect(resolveRelativeDate({ type: 'current_week' }, monday, TZ)).toEqual({
      kind: 'range',
      from: '2026-03-09',
      to: '2026-03-15',
    });
  });

  it('un día inexistente del mes se rechaza', () => {
    const feb = new Date('2026-02-10T12:00:00-05:00');
    expect(() => resolveRelativeDate({ type: 'day_of_current_month', day: 30 }, feb, TZ)).toThrow();
  });
});

describe('RN-125 — resolución contra capturedAt y timezone, nunca contra UTC ni el momento de sync', () => {
  it('a las 9 PM de Guatemala todavía es lunes aunque en UTC ya sea martes', () => {
    const lateNightUtc = new Date('2026-03-10T03:00:00Z');
    expect(zonedNow(TZ, lateNightUtc).date).toBe('2026-03-09');
  });

  it('un comando capturado el lunes resuelve igual sin importar cuándo se procese', () => {
    const capturedMonday = monday;
    const resolved = resolveRelativeDate({ type: 'next_weekday', weekday: 3 }, capturedMonday, TZ);
    expect(resolved).toEqual({ kind: 'date', date: '2026-03-11' });
  });
});

describe('zonedTimeToUtc — hora de pared del tenant a instante UTC', () => {
  it('las 3 PM de Guatemala son las 21:00 UTC', () => {
    expect(zonedTimeToUtc('2026-03-09', 900, TZ).toISOString()).toBe('2026-03-09T21:00:00.000Z');
  });

  it('es inversa de zonedNow', () => {
    const instant = zonedTimeToUtc('2026-07-06', 1020, TZ);
    const back = zonedNow(TZ, instant);
    expect(back).toMatchObject({ date: '2026-07-06', minutes: 1020 });
  });
});
