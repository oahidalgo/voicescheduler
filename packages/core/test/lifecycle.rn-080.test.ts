import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal, validateStart } from '../src/lifecycle';
import { addDays } from '../src/dates';
import { founderConfig } from './helpers';

describe('RN-080/082 — máquina de estados de la cita', () => {
  it('scheduled permite completed, no_show y cancelled', () => {
    expect(canTransition('scheduled', 'completed')).toBe(true);
    expect(canTransition('scheduled', 'no_show')).toBe(true);
    expect(canTransition('scheduled', 'cancelled')).toBe(true);
  });

  it('los estados terminales no admiten ninguna transición', () => {
    for (const terminal of ['completed', 'no_show', 'cancelled'] as const) {
      expect(isTerminal(terminal)).toBe(true);
      expect(canTransition(terminal, 'scheduled')).toBe(false);
      expect(canTransition(terminal, 'cancelled')).toBe(false);
    }
    expect(isTerminal('scheduled')).toBe(false);
  });
});

describe('RN-050/051 — límites temporales del inicio', () => {
  const config = founderConfig();
  const now = { date: '2026-03-09', minutes: 600, weekday: 1 as const };

  it('tolera hasta 5 minutos en el pasado por desfase de reloj', () => {
    expect(validateStart({ date: '2026-03-09', startMin: 597, durationMin: 60, mode: 'in_clinic' }, now, config)).toEqual([]);
    expect(
      validateStart({ date: '2026-03-09', startMin: 594, durationMin: 60, mode: 'in_clinic' }, now, config),
    ).toContain('RN-050: la cita inicia en el pasado');
  });

  it('el fundador puede agendar para ahora mismo (minAdvance = 0)', () => {
    expect(validateStart({ date: '2026-03-09', startMin: 600, durationMin: 60, mode: 'in_clinic' }, now, config)).toEqual([]);
  });

  it('una anticipación mínima configurada se respeta', () => {
    const strict = founderConfig(j => (j.minAdvanceMinutes = 120));
    expect(
      validateStart({ date: '2026-03-09', startMin: 660, durationMin: 60, mode: 'in_clinic' }, now, strict),
    ).toContain('RN-051: no cumple la anticipación mínima');
  });

  it('no se agenda más allá de maxAdvanceDays (90 del fundador)', () => {
    const past90 = addDays(now.date, 91);
    expect(validateStart({ date: past90, startMin: 600, durationMin: 60, mode: 'in_clinic' }, now, config)).toContain(
      'RN-051: excede la anticipación máxima',
    );
    const at90 = addDays(now.date, 90);
    expect(validateStart({ date: at90, startMin: 600, durationMin: 60, mode: 'in_clinic' }, now, config)).toEqual([]);
  });
});
