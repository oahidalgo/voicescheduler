import { parseConfig, physiotherapyTemplate } from '../src/config';
import type { TenantConfigJson } from '../src/config';
import type { ExistingAppointment, Mode } from '../src/types';

export function founderJson(): TenantConfigJson {
  return structuredClone(physiotherapyTemplate);
}

export function founderConfig(mutate?: (json: TenantConfigJson) => void) {
  const json = founderJson();
  mutate?.(json);
  return parseConfig(json);
}

let seq = 0;
export function appt(date: string, startMin: number, durationMin: number, mode: Mode): ExistingAppointment {
  return { id: `a${++seq}`, status: 'scheduled', date, startMin, durationMin, mode };
}
