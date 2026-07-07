import { useCallback, useEffect, useState } from 'react';
import { addDays, weekdayOf } from '@voicescheduler/core';
import type { CalendarException, CoreConfig } from '@voicescheduler/core';
import { fetchAppointments, fetchConfig, fetchExceptions } from '../lib/api';
import {
  config as sampleConfig,
  sampleAppointments,
  sampleExceptions,
} from '../data/sample';
import type { UiAppointment } from '../data/sample';

export interface AgendaData {
  config: CoreConfig;
  appointments: UiAppointment[];
  exceptions: CalendarException[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * En modo live carga config + citas + excepciones de Supabase (la semana
 * visible ± 1 semana). En modo sample devuelve los datos de ejemplo.
 */
export function useAgenda(live: boolean, selectedDate: string): AgendaData {
  const [config, setConfig] = useState<CoreConfig>(sampleConfig);
  const [appointments, setAppointments] = useState<UiAppointment[]>(live ? [] : sampleAppointments);
  const [exceptions, setExceptions] = useState<CalendarException[]>(live ? [] : sampleExceptions);
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const weekStart = addDays(selectedDate, 1 - weekdayOf(selectedDate));

  useEffect(() => {
    if (!live) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const cfg = await fetchConfig();
        const [appts, exs] = await Promise.all([
          fetchAppointments(cfg.timezone, addDays(weekStart, -7), 21),
          fetchExceptions(),
        ]);
        if (!alive) return;
        setConfig(cfg);
        setAppointments(appts);
        setExceptions(exs);
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Error cargando la agenda');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [live, weekStart, tick]);

  const reload = useCallback(() => setTick(t => t + 1), []);

  return { config, appointments, exceptions, loading, error, reload };
}
