export type Mode = 'in_clinic' | 'home_visit' | 'virtual';

/** ISO 8601: 1 = lunes … 7 = domingo */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Minutos desde medianoche en la timezone del tenant. endMin es exclusivo. */
export interface TimeRange {
  startMin: number;
  endMin: number;
}

export interface WorkingRange extends TimeRange {
  modes: Mode[];
}

export type WorkingHours = Partial<Record<Weekday, WorkingRange[]>>;

export type AppointmentStatus = 'scheduled' | 'completed' | 'no_show' | 'cancelled';

/** RN-084: independiente del ciclo de vida */
export type PaymentStatus = 'unpaid' | 'paid';

/** Una cita (o candidata a cita) expresada en hora local del tenant. */
export interface Occurrence {
  /** 'YYYY-MM-DD' en la timezone del tenant */
  date: string;
  startMin: number;
  durationMin: number;
  mode: Mode;
}

export interface ExistingAppointment extends Occurrence {
  id: string;
  status: AppointmentStatus;
}

/** RN-060: cuatro tipos de excepción de calendario */
export type CalendarException =
  | { type: 'holiday'; date: string; reason?: string }
  | { type: 'vacation'; dateFrom: string; dateTo: string; reason?: string }
  | { type: 'time_block'; date: string; startMin: number; endMin: number; reason?: string }
  | { type: 'extended_hours'; date: string; startMin: number; endMin: number; modes?: Mode[]; reason?: string };
