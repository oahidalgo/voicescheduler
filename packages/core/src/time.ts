import type { TimeRange } from './types';

export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Hora inválida: ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new Error(`Hora inválida: ${hhmm}`);
  return h * 60 + min;
}

export function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

export function containsRange(outer: TimeRange, inner: TimeRange): boolean {
  return outer.startMin <= inner.startMin && inner.endMin <= outer.endMin;
}

export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter(r => r.endMin > r.startMin)
    .map(r => ({ startMin: r.startMin, endMin: r.endMin }))
    .sort((a, b) => a.startMin - b.startMin);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.startMin <= last.endMin) last.endMin = Math.max(last.endMin, r.endMin);
    else out.push(r);
  }
  return out;
}

export function subtractRanges(ranges: TimeRange[], holes: TimeRange[]): TimeRange[] {
  let out = ranges.map(r => ({ startMin: r.startMin, endMin: r.endMin }));
  for (const h of holes) {
    const next: TimeRange[] = [];
    for (const r of out) {
      if (!overlaps(r, h)) {
        next.push(r);
        continue;
      }
      if (r.startMin < h.startMin) next.push({ startMin: r.startMin, endMin: h.startMin });
      if (h.endMin < r.endMin) next.push({ startMin: h.endMin, endMin: r.endMin });
    }
    out = next;
  }
  return out;
}
