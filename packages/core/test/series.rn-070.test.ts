import { describe, expect, it } from 'vitest';
import { expandWeeklySeries, validateSeries } from '../src/series';
import { weekdayOf } from '../src/dates';
import { appt, founderConfig } from './helpers';
import type { WeeklySeriesRule } from '../src/series';

const config = founderConfig();

// "Luis, lunes y jueves a las 3 PM, 12 sesiones" — ejemplo de RN-070
const luisRule: WeeklySeriesRule = {
  weekdays: [1, 4],
  startMin: 900,
  durationMin: 60,
  mode: 'in_clinic',
  firstDate: '2026-03-09',
  end: { type: 'count', sessions: 12 },
};

describe('RN-070/073 — expansión del patrón semanal', () => {
  it('genera exactamente las 12 sesiones pedidas, solo en lunes y jueves', () => {
    const occs = expandWeeklySeries(luisRule);
    expect(occs).toHaveLength(12);
    expect(occs[0]!.date).toBe('2026-03-09');
    expect(occs[1]!.date).toBe('2026-03-12');
    expect(occs[11]!.date).toBe('2026-04-16');
    for (const o of occs) {
      expect([1, 4]).toContain(weekdayOf(o.date));
      expect(o.startMin).toBe(900);
    }
  });

  it('el fin por fecha límite corta la serie', () => {
    const occs = expandWeeklySeries({ ...luisRule, end: { type: 'until', date: '2026-03-31' } });
    expect(occs.map(o => o.date)).toEqual([
      '2026-03-09',
      '2026-03-12',
      '2026-03-16',
      '2026-03-19',
      '2026-03-23',
      '2026-03-26',
      '2026-03-30',
    ]);
  });
});

describe('RN-071 — se validan todas las ocurrencias y los conflictos se listan uno a uno', () => {
  it('un feriado marca solo esa ocurrencia como fuera de horario', () => {
    const occs = expandWeeklySeries(luisRule);
    const results = validateSeries(occs, config, [], [{ type: 'holiday', date: '2026-03-16' }]);
    const conflicted = results.filter(r => !r.ok);
    expect(conflicted).toHaveLength(1);
    expect(conflicted[0]!.occurrence.date).toBe('2026-03-16');
    expect(conflicted[0]!.reasons).toEqual(['fuera_de_horario']);
  });

  it('un día con el cupo lleno se reporta como sin_cupo', () => {
    const occs = expandWeeklySeries(luisRule);
    const full = [
      appt('2026-03-23', 900, 60, 'in_clinic'),
      appt('2026-03-23', 900, 60, 'in_clinic'),
      appt('2026-03-23', 900, 60, 'in_clinic'),
      appt('2026-03-23', 900, 60, 'in_clinic'),
    ];
    const results = validateSeries(occs, config, full, []);
    const conflicted = results.filter(r => !r.ok);
    expect(conflicted).toHaveLength(1);
    expect(conflicted[0]!.occurrence.date).toBe('2026-03-23');
    expect(conflicted[0]!.reasons).toEqual(['sin_cupo']);
  });

  it('sin conflictos, las 12 ocurrencias pasan', () => {
    const results = validateSeries(expandWeeklySeries(luisRule), config, [], []);
    expect(results.every(r => r.ok)).toBe(true);
  });
});
