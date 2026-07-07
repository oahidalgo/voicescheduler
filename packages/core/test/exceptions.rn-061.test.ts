import { describe, expect, it } from 'vitest';
import { effectiveRanges } from '../src/exceptions';
import { founderConfig } from './helpers';

const config = founderConfig();
const MON = '2026-03-09';
const SAT = '2026-03-14';

describe('RN-060/061 — prioridad de excepciones de calendario', () => {
  it('holiday bloquea todo el día, incluso sobre extended_hours', () => {
    const ranges = effectiveRanges(MON, 'in_clinic', config, [
      { type: 'holiday', date: MON },
      { type: 'extended_hours', date: MON, startMin: 1080, endMin: 1200 },
    ]);
    expect(ranges).toEqual([]);
  });

  it('vacation bloquea los días dentro del rango de fechas', () => {
    const vacation = { type: 'vacation' as const, dateFrom: '2026-03-09', dateTo: '2026-03-13' };
    expect(effectiveRanges('2026-03-11', 'in_clinic', config, [vacation])).toEqual([]);
    expect(effectiveRanges('2026-03-16', 'in_clinic', config, [vacation])).not.toEqual([]);
  });

  it('time_block recorta el horario regular (almuerzo)', () => {
    const ranges = effectiveRanges(MON, 'in_clinic', config, [
      { type: 'time_block', date: MON, startMin: 720, endMin: 840 },
    ]);
    expect(ranges).toEqual([
      { startMin: 540, endMin: 720 },
      { startMin: 840, endMin: 1020 },
    ]);
  });

  it('extended_hours habilita disponibilidad fuera del horario regular (RN-011)', () => {
    const ranges = effectiveRanges(SAT, 'in_clinic', config, [
      { type: 'extended_hours', date: SAT, startMin: 600, endMin: 780 },
    ]);
    expect(ranges).toEqual([{ startMin: 600, endMin: 780 }]);
  });

  it('time_block recorta también las extended_hours (prioridad mayor)', () => {
    const ranges = effectiveRanges(SAT, 'in_clinic', config, [
      { type: 'extended_hours', date: SAT, startMin: 600, endMin: 780 },
      { type: 'time_block', date: SAT, startMin: 660, endMin: 720 },
    ]);
    expect(ranges).toEqual([
      { startMin: 600, endMin: 660 },
      { startMin: 720, endMin: 780 },
    ]);
  });

  it('el horario respeta la modalidad del rango: lunes 17-21 es solo domicilio', () => {
    expect(effectiveRanges(MON, 'in_clinic', config, [])).toEqual([{ startMin: 540, endMin: 1020 }]);
    expect(effectiveRanges(MON, 'home_visit', config, [])).toEqual([{ startMin: 1020, endMin: 1260 }]);
  });

  it('sábado sin horario regular ni excepciones no tiene rangos', () => {
    expect(effectiveRanges(SAT, 'in_clinic', config, [])).toEqual([]);
  });
});
