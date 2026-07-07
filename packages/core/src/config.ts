import { toMinutes } from './time';
import type { Mode, Weekday, WorkingHours } from './types';

export interface BufferMinutes {
  beforeMin: number;
  afterMin: number;
}

/** Configuración normalizada (minutos, weekdays numéricos) que consume el dominio. */
export interface CoreConfig {
  timezone: string;
  workingHours: WorkingHours;
  slotGranularityMin: number;
  defaultDurationMin: number;
  minDurationMin: number;
  maxDurationMin: number;
  maxConcurrent: Record<Mode, number>;
  buffers: Record<Mode, BufferMinutes>;
  minAdvanceMin: number;
  maxAdvanceDays: number;
  defaultMode: Mode;
  notifications: {
    morningTimeMin: number;
    morningUntilMin: number;
    afternoonTimeMin: number;
    afternoonFromMin: number;
    reminderBeforeMin: number;
    autoCompleteAfterHours: number;
  };
}

export interface WorkingRangeJson {
  from: string;
  to: string;
  modes: Mode[];
}

/** RN-140: forma del documento `tenant.config` tal como se persiste. */
export interface TenantConfigJson {
  timezone: string;
  workingHours: Record<string, WorkingRangeJson[]>;
  slotGranularityMinutes: number;
  defaultDurationMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  maxConcurrentAppointments: Partial<Record<Mode, number>>;
  buffers?: Partial<Record<Mode, { bufferBeforeMinutes?: number; bufferAfterMinutes?: number }>>;
  minAdvanceMinutes: number;
  maxAdvanceDays: number;
  defaultMode: Mode;
  notifications: {
    morningNotificationTime: string;
    morningSessionUntil: string;
    afternoonNotificationTime: string;
    afternoonSessionFrom: string;
    reminderBeforeMinutes: number;
    autoCompleteAfterHours?: number;
  };
}

const WEEKDAY_BY_NAME: Record<string, Weekday> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

export function validateConfigJson(json: TenantConfigJson): string[] {
  const errors: string[] = [];
  for (const [day, ranges] of Object.entries(json.workingHours)) {
    if (!(day in WEEKDAY_BY_NAME)) {
      errors.push(`Día desconocido en workingHours: ${day}`);
      continue;
    }
    for (const r of ranges) {
      if (toMinutes(r.from) >= toMinutes(r.to)) errors.push(`Rango inválido en ${day}: ${r.from}–${r.to}`);
      if (r.modes.length === 0) errors.push(`Rango sin modalidades en ${day}: ${r.from}–${r.to}`);
    }
  }
  if (json.slotGranularityMinutes <= 0) errors.push('RN-012: slotGranularityMinutes debe ser positivo');
  if (
    !(
      json.minDurationMinutes <= json.defaultDurationMinutes &&
      json.defaultDurationMinutes <= json.maxDurationMinutes
    )
  ) {
    errors.push('RN-030: se requiere minDuration ≤ defaultDuration ≤ maxDuration');
  }
  if (json.maxAdvanceDays <= 0) errors.push('RN-051: maxAdvanceDays debe ser positivo');
  const n = json.notifications;
  const morningUntil = toMinutes(n.morningSessionUntil);
  const afternoonFrom = toMinutes(n.afternoonSessionFrom);
  const afternoonAt = toMinutes(n.afternoonNotificationTime);
  if (!(morningUntil < afternoonFrom)) {
    errors.push('RN-134: morningSessionUntil debe ser menor que afternoonSessionFrom');
  }
  if (!(morningUntil <= afternoonAt && afternoonAt <= afternoonFrom)) {
    errors.push('RN-134: afternoonNotificationTime debe caer entre morningSessionUntil y afternoonSessionFrom');
  }
  return errors;
}

export function parseConfig(json: TenantConfigJson): CoreConfig {
  const errors = validateConfigJson(json);
  if (errors.length > 0) throw new Error(`Configuración inválida: ${errors.join(' · ')}`);

  const workingHours: WorkingHours = {};
  for (const [day, ranges] of Object.entries(json.workingHours)) {
    workingHours[WEEKDAY_BY_NAME[day]!] = ranges.map(r => ({
      startMin: toMinutes(r.from),
      endMin: toMinutes(r.to),
      modes: r.modes,
    }));
  }

  const buffer = (mode: Mode): BufferMinutes => ({
    beforeMin: json.buffers?.[mode]?.bufferBeforeMinutes ?? 0,
    afterMin: json.buffers?.[mode]?.bufferAfterMinutes ?? 0,
  });

  return {
    timezone: json.timezone,
    workingHours,
    slotGranularityMin: json.slotGranularityMinutes,
    defaultDurationMin: json.defaultDurationMinutes,
    minDurationMin: json.minDurationMinutes,
    maxDurationMin: json.maxDurationMinutes,
    maxConcurrent: {
      in_clinic: json.maxConcurrentAppointments.in_clinic ?? 1,
      // RN-022: el máximo simultáneo de domicilios es 1, diga lo que diga la config
      home_visit: Math.min(json.maxConcurrentAppointments.home_visit ?? 1, 1),
      virtual: json.maxConcurrentAppointments.virtual ?? 1,
    },
    buffers: {
      in_clinic: buffer('in_clinic'),
      home_visit: buffer('home_visit'),
      virtual: buffer('virtual'),
    },
    minAdvanceMin: json.minAdvanceMinutes,
    maxAdvanceDays: json.maxAdvanceDays,
    defaultMode: json.defaultMode,
    notifications: {
      morningTimeMin: toMinutes(json.notifications.morningNotificationTime),
      morningUntilMin: toMinutes(json.notifications.morningSessionUntil),
      afternoonTimeMin: toMinutes(json.notifications.afternoonNotificationTime),
      afternoonFromMin: toMinutes(json.notifications.afternoonSessionFrom),
      reminderBeforeMin: json.notifications.reminderBeforeMinutes,
      autoCompleteAfterHours: json.notifications.autoCompleteAfterHours ?? 24,
    },
  };
}

const CLINIC_AND_HOME: WorkingRangeJson[] = [
  { from: '09:00', to: '17:00', modes: ['in_clinic'] },
  { from: '17:00', to: '21:00', modes: ['home_visit'] },
];

/** RN-141: plantilla de industria del tenant fundador. La timezone se ajusta por tenant. */
export const physiotherapyTemplate: TenantConfigJson = {
  timezone: 'America/Guatemala',
  workingHours: {
    monday: CLINIC_AND_HOME,
    tuesday: CLINIC_AND_HOME,
    wednesday: CLINIC_AND_HOME,
    thursday: CLINIC_AND_HOME,
    friday: [{ from: '09:00', to: '17:00', modes: ['in_clinic'] }],
    saturday: [],
    sunday: [],
  },
  slotGranularityMinutes: 60,
  defaultDurationMinutes: 60,
  minDurationMinutes: 30,
  maxDurationMinutes: 120,
  maxConcurrentAppointments: { in_clinic: 4, home_visit: 1 },
  buffers: { home_visit: { bufferAfterMinutes: 30 } },
  minAdvanceMinutes: 0,
  maxAdvanceDays: 90,
  defaultMode: 'in_clinic',
  notifications: {
    morningNotificationTime: '07:00',
    morningSessionUntil: '13:00',
    afternoonNotificationTime: '13:30',
    afternoonSessionFrom: '14:00',
    reminderBeforeMinutes: 30,
  },
};
