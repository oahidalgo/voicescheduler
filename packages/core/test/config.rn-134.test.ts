import { describe, expect, it } from 'vitest';
import { parseConfig, validateConfigJson } from '../src/config';
import { founderJson } from './helpers';

describe('RN-141 — la plantilla physiotherapy es una configuración válida', () => {
  it('valida sin errores y normaliza los valores del fundador', () => {
    const json = founderJson();
    expect(validateConfigJson(json)).toEqual([]);
    const config = parseConfig(json);
    expect(config.slotGranularityMin).toBe(60);
    expect(config.maxConcurrent.in_clinic).toBe(4);
    expect(config.buffers.home_visit.afterMin).toBe(30);
    expect(config.workingHours[1]).toHaveLength(2);
    expect(config.workingHours[6]).toEqual([]);
  });
});

describe('RN-134 — coherencia de horarios de notificación', () => {
  it('afternoonNotificationTime fuera del rango es incoherente', () => {
    const json = founderJson();
    json.notifications.afternoonNotificationTime = '12:00';
    expect(validateConfigJson(json).join(' ')).toContain('RN-134');
  });

  it('morningSessionUntil >= afternoonSessionFrom es incoherente', () => {
    const json = founderJson();
    json.notifications.morningSessionUntil = '15:00';
    expect(validateConfigJson(json).length).toBeGreaterThan(0);
  });

  it('parseConfig rechaza una configuración incoherente', () => {
    const json = founderJson();
    json.notifications.morningSessionUntil = '15:00';
    expect(() => parseConfig(json)).toThrow(/RN-134/);
  });
});

describe('RN-030 — límites de duración', () => {
  it('minDuration > defaultDuration es inválido', () => {
    const json = founderJson();
    json.minDurationMinutes = 90;
    expect(validateConfigJson(json).join(' ')).toContain('RN-030');
  });
});

describe('validaciones estructurales', () => {
  it('un rango con from >= to se rechaza', () => {
    const json = founderJson();
    json.workingHours.monday = [{ from: '17:00', to: '09:00', modes: ['in_clinic'] }];
    expect(validateConfigJson(json).length).toBeGreaterThan(0);
  });

  it('un día desconocido se rechaza', () => {
    const json = founderJson();
    (json.workingHours as Record<string, unknown[]>).funday = [];
    expect(validateConfigJson(json).join(' ')).toContain('funday');
  });
});
