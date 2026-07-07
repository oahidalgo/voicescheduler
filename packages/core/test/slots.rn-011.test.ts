import { describe, expect, it } from 'vitest';
import { availableStarts, isStartAvailable } from '../src/slots';
import { appt, founderConfig } from './helpers';

const config = founderConfig();
const MON = '2026-03-09';
const base = { config, existing: [], exceptions: [] };

describe('RN-011/012 — slots dentro de rangos con la modalidad y granularidad correctas', () => {
  it('domicilios de 60 min un lunes: inicios en punto entre 17:00 y 20:00', () => {
    const starts = availableStarts({ ...base, date: MON, mode: 'home_visit', durationMin: 60 });
    expect(starts).toEqual([1020, 1080, 1140, 1200]);
  });

  it('clínica de 60 min un lunes: 8 inicios entre 9:00 y 16:00', () => {
    const starts = availableStarts({ ...base, date: MON, mode: 'in_clinic', durationMin: 60 });
    expect(starts).toEqual([540, 600, 660, 720, 780, 840, 900, 960]);
  });

  it('una cita de 120 min no puede iniciar a las 16:00 porque no cabe en el rango', () => {
    const starts = availableStarts({ ...base, date: MON, mode: 'in_clinic', durationMin: 120 });
    expect(starts).not.toContain(960);
    expect(starts).toContain(900);
  });

  it('un tramo con el cupo lleno desaparece de los slots (RN-021)', () => {
    const existing = [
      appt(MON, 600, 60, 'in_clinic'),
      appt(MON, 600, 60, 'in_clinic'),
      appt(MON, 600, 60, 'in_clinic'),
      appt(MON, 600, 60, 'in_clinic'),
    ];
    const starts = availableStarts({ ...base, existing, date: MON, mode: 'in_clinic', durationMin: 60 });
    expect(starts).not.toContain(600);
    expect(starts).toContain(540);
    expect(starts).toContain(660);
  });

  it('con `now`, los inicios ya pasados se excluyen (RN-050)', () => {
    const now = { date: MON, minutes: 690, weekday: 1 as const };
    const starts = availableStarts({ ...base, now, date: MON, mode: 'in_clinic', durationMin: 60 });
    expect(starts).toEqual([720, 780, 840, 900, 960]);
  });

  it('isStartAvailable rechaza inicios fuera de todo rango (RN-011)', () => {
    expect(isStartAvailable({ ...base, date: MON, mode: 'in_clinic', durationMin: 60, startMin: 480 })).toBe(false);
    expect(isStartAvailable({ ...base, date: MON, mode: 'in_clinic', durationMin: 60, startMin: 600 })).toBe(true);
  });
});
