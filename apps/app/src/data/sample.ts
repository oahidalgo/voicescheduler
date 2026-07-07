// Datos de ejemplo para la fase 2. Se reemplazan por la réplica local + Supabase
// en la fase de sincronización.
import { addDays, parseConfig, physiotherapyTemplate, zonedNow } from '@voicescheduler/core';
import type { CalendarException, ExistingAppointment } from '@voicescheduler/core';

export const config = parseConfig(physiotherapyTemplate);

const now = zonedNow(config.timezone);
export const today = now.date;

/** Lunes de la semana actual: ancla los ejemplos a días laborales. */
export const monday = addDays(today, 1 - now.weekday);

export interface UiAppointment extends ExistingAppointment {
  patientName: string;
  patientId?: string;
  paid: boolean;
}

const d = (offset: number) => addDays(monday, offset);

let n = 0;
const mk = (
  offset: number,
  startMin: number,
  durationMin: number,
  mode: UiAppointment['mode'],
  patientName: string,
  paid: boolean,
): UiAppointment => ({
  id: `sample-${++n}`,
  status: 'scheduled',
  date: d(offset),
  startMin,
  durationMin,
  mode,
  patientName,
  paid,
});

export const sampleAppointments: UiAppointment[] = [
  mk(0, 540, 60, 'in_clinic', 'María López', true),
  mk(0, 540, 60, 'in_clinic', 'Juan García', false),
  mk(0, 660, 90, 'in_clinic', 'Luis Pérez', false),
  mk(0, 900, 60, 'in_clinic', 'Carmen Ruiz', true),
  mk(0, 1020, 60, 'home_visit', 'Pedro Ramírez', false),
  mk(1, 570, 60, 'in_clinic', 'Ana Morales', true),
  mk(1, 840, 60, 'in_clinic', 'Roberto Lima', false),
  mk(1, 1080, 60, 'home_visit', 'Elsa Girón', true),
  mk(2, 600, 60, 'in_clinic', 'María López', true),
  mk(2, 900, 60, 'in_clinic', 'Luis Pérez', false),
  mk(2, 1050, 60, 'home_visit', 'Pedro Ramírez', true),
  mk(3, 540, 60, 'in_clinic', 'Juan García', true),
  mk(3, 660, 60, 'in_clinic', 'Carmen Ruiz', true),
  mk(3, 900, 60, 'in_clinic', 'Ana Morales', false),
  mk(4, 600, 60, 'in_clinic', 'Roberto Lima', true),
  mk(4, 780, 60, 'in_clinic', 'María López', true),
];

export const sampleExceptions: CalendarException[] = [
  { type: 'time_block', date: d(0), startMin: 750, endMin: 810, reason: 'Almuerzo' },
];
