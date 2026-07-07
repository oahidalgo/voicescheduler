import { describe, expect, it } from 'vitest';
import { checkCapacity } from '../src/capacity';
import { appt, founderConfig } from './helpers';

const MON = '2026-03-09';

describe('RN-021 — la capacidad cuenta solapamientos, no inicios simultáneos', () => {
  it('dos citas de 90 min con 30 min de diferencia consumen cupo juntas durante el tramo común', () => {
    const config = founderConfig(j => (j.maxConcurrentAppointments.in_clinic = 2));
    const existing = [appt(MON, 600, 90, 'in_clinic'), appt(MON, 630, 90, 'in_clinic')];
    const candidate = { date: MON, startMin: 645, durationMin: 30, mode: 'in_clinic' as const };
    const result = checkCapacity(candidate, existing, config);
    expect(result.peak).toBe(3);
    expect(result.ok).toBe(false);
  });

  it('con la capacidad 4 del fundador el mismo escenario sí cabe', () => {
    const config = founderConfig();
    const existing = [appt(MON, 600, 90, 'in_clinic'), appt(MON, 630, 90, 'in_clinic')];
    const candidate = { date: MON, startMin: 645, durationMin: 30, mode: 'in_clinic' as const };
    expect(checkCapacity(candidate, existing, config).ok).toBe(true);
  });

  it('citas que no se solapan no consumen cupo entre sí', () => {
    const config = founderConfig(j => (j.maxConcurrentAppointments.in_clinic = 1));
    const existing = [appt(MON, 600, 60, 'in_clinic')];
    const candidate = { date: MON, startMin: 660, durationMin: 60, mode: 'in_clinic' as const };
    expect(checkCapacity(candidate, existing, config).ok).toBe(true);
  });

  it('las citas canceladas no bloquean cupo', () => {
    const config = founderConfig(j => (j.maxConcurrentAppointments.in_clinic = 1));
    const cancelled = { ...appt(MON, 600, 60, 'in_clinic'), status: 'cancelled' as const };
    const candidate = { date: MON, startMin: 600, durationMin: 60, mode: 'in_clinic' as const };
    expect(checkCapacity(candidate, [cancelled], config).ok).toBe(true);
  });

  it('RN-020: la capacidad es por modalidad — un domicilio no consume cupo de clínica', () => {
    const config = founderConfig(j => (j.maxConcurrentAppointments.in_clinic = 1));
    const existing = [appt(MON, 600, 60, 'home_visit')];
    const candidate = { date: MON, startMin: 600, durationMin: 60, mode: 'in_clinic' as const };
    expect(checkCapacity(candidate, existing, config).ok).toBe(true);
  });
});

describe('RN-022 — home_visit tiene tope duro de 1', () => {
  it('la configuración no puede elevar el máximo de domicilios', () => {
    const config = founderConfig(j => (j.maxConcurrentAppointments.home_visit = 3));
    expect(config.maxConcurrent.home_visit).toBe(1);
    const existing = [appt(MON, 1020, 60, 'home_visit')];
    const candidate = { date: MON, startMin: 1050, durationMin: 60, mode: 'home_visit' as const };
    expect(checkCapacity(candidate, existing, config).ok).toBe(false);
  });
});

describe('RN-041 — los buffers extienden el rango que bloquea disponibilidad', () => {
  it('el buffer de traslado de 30 min impide iniciar otra visita dentro de él', () => {
    const config = founderConfig();
    const existing = [appt(MON, 1020, 60, 'home_visit')];
    const tooSoon = { date: MON, startMin: 1100, durationMin: 60, mode: 'home_visit' as const };
    expect(checkCapacity(tooSoon, existing, config).ok).toBe(false);
    const afterBuffer = { date: MON, startMin: 1110, durationMin: 60, mode: 'home_visit' as const };
    expect(checkCapacity(afterBuffer, existing, config).ok).toBe(true);
  });
});
