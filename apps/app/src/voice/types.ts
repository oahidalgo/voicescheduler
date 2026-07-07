// Contrato con la Edge Function `interpret` (RN-100/101/120-125).
import type { Mode, RelativeDate } from '@voicescheduler/core';

export interface SpokenTime {
  hour: number;
  minute: number;
  /** RN-124: "a las 3" sin am/pm — el cliente resuelve contra el horario laboral */
  ambiguousAmPm: boolean;
}

export type QueryVariant = 'schedule' | 'pending_today' | 'pending_tomorrow' | 'pending_week' | 'unpaid';

export interface VoiceIntent {
  intent: 'schedule' | 'cancel' | 'reschedule' | 'query' | 'block' | 'unknown';
  confidence: number;
  patientName?: string;
  date?: RelativeDate;
  time?: SpokenTime;
  durationMinutes?: number;
  mode?: Mode;
  queryVariant?: QueryVariant;
  newDate?: RelativeDate;
  newTime?: SpokenTime;
  block?: {
    allDay: boolean;
    timeFrom?: SpokenTime;
    timeTo?: SpokenTime;
    reason?: string;
  };
  missing?: string[];
  followupQuestion?: string;
}
