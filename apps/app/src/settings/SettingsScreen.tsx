import { useEffect, useState } from 'react';
import { effectiveRanges, parseConfig, toHHMM, validateConfigJson, zonedNow } from '@voicescheduler/core';
import type { CalendarException, Mode, TenantConfigJson } from '@voicescheduler/core';
import {
  fetchAppointments,
  fetchConfigRaw,
  removePushSubscription,
  saveConfigVersion,
  savePushSubscription,
} from '../lib/api';
import { supabase } from '../lib/supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

type PushState = 'unsupported' | 'off' | 'on' | 'busy' | 'denied';

const DAYS: [string, string][] = [
  ['monday', 'Lunes'],
  ['tuesday', 'Martes'],
  ['wednesday', 'Miércoles'],
  ['thursday', 'Jueves'],
  ['friday', 'Viernes'],
  ['saturday', 'Sábado'],
  ['sunday', 'Domingo'],
];

export interface SettingsScreenProps {
  live: boolean;
  email: string | null;
  exceptions: CalendarException[];
  onSaved: () => void;
}

export function SettingsScreen({ live, email, exceptions, onSaved }: SettingsScreenProps) {
  const [raw, setRaw] = useState<TenantConfigJson | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(live);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  /** RN-142: citas futuras que la nueva config dejaría fuera de horario */
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [push, setPush] = useState<PushState>('unsupported');
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    if (!live || !VAPID_PUBLIC_KEY) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const sub = await reg.pushManager.getSubscription();
        setPush(sub ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off');
      } catch {
        setPush('unsupported');
      }
    })();
  }, [live]);

  async function enablePush() {
    if (!VAPID_PUBLIC_KEY) return;
    setPush('busy');
    setPushError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPush(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
      await savePushSubscription(sub);
      setPush('on');
    } catch (e) {
      setPushError(e instanceof Error ? e.message : 'No se pudo activar');
      setPush('off');
    }
  }

  async function disablePush() {
    setPush('busy');
    setPushError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setPush('off');
    } catch (e) {
      setPushError(e instanceof Error ? e.message : 'No se pudo desactivar');
      setPush('on');
    }
  }

  useEffect(() => {
    if (!live) return;
    let alive = true;
    fetchConfigRaw()
      .then(({ version: v, config }) => {
        if (!alive) return;
        const workingHours = { ...config.workingHours };
        for (const [key] of DAYS) {
          if (!workingHours[key]) workingHours[key] = [];
        }
        setRaw({ ...config, workingHours });
        setVersion(v);
      })
      .catch(e => alive && setErrors([e instanceof Error ? e.message : 'No se pudo cargar la configuración']))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [live]);

  const mutate = (fn: (draft: TenantConfigJson) => void) => {
    setRaw(prev => {
      if (!prev) return prev;
      const copy = structuredClone(prev);
      fn(copy);
      return copy;
    });
    setWarnings(null);
    setSaved(false);
    setErrors([]);
  };

  async function computeWarnings(cfg: TenantConfigJson): Promise<string[]> {
    const core = parseConfig(cfg);
    const today = zonedNow(core.timezone).date;
    const appts = await fetchAppointments(core.timezone, today, 90);
    const affected: string[] = [];
    for (const a of appts.filter(x => x.status === 'scheduled')) {
      const fits = effectiveRanges(a.date, a.mode, core, exceptions).some(
        r => r.startMin <= a.startMin && a.startMin + a.durationMin <= r.endMin,
      );
      if (!fits) affected.push(`${a.patientName} · ${a.date} ${toHHMM(a.startMin)}`);
    }
    return affected;
  }

  async function save(force: boolean) {
    if (!raw) return;
    const validationErrors = validateConfigJson(raw);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      if (!force) {
        const affected = await computeWarnings(raw);
        if (affected.length > 0) {
          setWarnings(affected);
          setSaving(false);
          return;
        }
      }
      await saveConfigVersion(raw, version);
      setVersion(v => v + 1);
      setWarnings(null);
      setSaved(true);
      onSaved();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'No se pudo guardar la configuración']);
    } finally {
      setSaving(false);
    }
  }

  const sessionCard = (
    <div className="card border-0 shadow-sm mb-3">
      <div className="card-body">
        <p className="mb-1 small text-secondary">Sesión</p>
        <p className="mb-2">{email ?? 'modo ejemplo (sin sesión)'}</p>
        {live && (
          <button className="btn btn-outline-danger btn-sm" onClick={() => supabase?.auth.signOut()}>
            <i className="bi bi-box-arrow-right me-1" />
            Cerrar sesión
          </button>
        )}
      </div>
    </div>
  );

  if (!live) {
    return (
      <div className="p-2">
        {sessionCard}
        <p className="small text-secondary px-1">La configuración del negocio requiere conexión a Supabase.</p>
      </div>
    );
  }
  if (loading) {
    return (
      <p className="text-secondary p-3">
        <span className="spinner-border spinner-border-sm me-2" />
        Cargando configuración…
      </p>
    );
  }
  if (!raw) {
    return <div className="alert alert-danger m-2">{errors[0] ?? 'No se pudo cargar la configuración.'}</div>;
  }

  const clinicMax = raw.maxConcurrentAppointments.in_clinic ?? 1;
  const homeBuffer = raw.buffers?.home_visit?.bufferAfterMinutes ?? 0;

  const toggleMode = (day: string, i: number, mode: Mode) =>
    mutate(d => {
      const range = d.workingHours[day]![i]!;
      range.modes = range.modes.includes(mode) ? range.modes.filter(m => m !== mode) : [...range.modes, mode];
    });

  return (
    <div className="p-2">
      {sessionCard}

      <div className="card border-0 shadow-sm mb-3">
        <div className="card-body">
          <p className="mb-2 fw-semibold">
            <i className="bi bi-clock me-2" />
            Horario laboral
          </p>
          {DAYS.map(([key, label]) => (
            <div key={key} className="mb-2 pb-2 border-bottom">
              <div className="d-flex justify-content-between align-items-center">
                <span className="small fw-semibold">{label}</span>
                <button
                  className="btn btn-sm btn-link p-0"
                  onClick={() =>
                    mutate(d => {
                      d.workingHours[key]!.push({ from: '09:00', to: '17:00', modes: ['in_clinic'] });
                    })
                  }
                >
                  <i className="bi bi-plus-circle" /> rango
                </button>
              </div>
              {raw.workingHours[key]!.length === 0 && <small className="text-secondary">Sin atención</small>}
              {raw.workingHours[key]!.map((range, i) => (
                <div key={i} className="d-flex align-items-center gap-1 mt-1">
                  <input
                    type="time"
                    className="form-control form-control-sm"
                    style={{ width: 96 }}
                    value={range.from}
                    onChange={e =>
                      mutate(d => {
                        d.workingHours[key]![i]!.from = e.target.value;
                      })
                    }
                  />
                  <span className="small text-secondary">–</span>
                  <input
                    type="time"
                    className="form-control form-control-sm"
                    style={{ width: 96 }}
                    value={range.to}
                    onChange={e =>
                      mutate(d => {
                        d.workingHours[key]![i]!.to = e.target.value;
                      })
                    }
                  />
                  <button
                    type="button"
                    className={`btn btn-sm ${range.modes.includes('in_clinic') ? 'btn-primary' : 'btn-outline-secondary'}`}
                    title="Clínica"
                    onClick={() => toggleMode(key, i, 'in_clinic')}
                  >
                    <i className="bi bi-building" />
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${range.modes.includes('home_visit') ? 'btn-primary' : 'btn-outline-secondary'}`}
                    title="Domicilio"
                    onClick={() => toggleMode(key, i, 'home_visit')}
                  >
                    <i className="bi bi-house-door" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger ms-auto"
                    aria-label="Quitar rango"
                    onClick={() =>
                      mutate(d => {
                        d.workingHours[key]!.splice(i, 1);
                      })
                    }
                  >
                    <i className="bi bi-trash" />
                  </button>
                </div>
              ))}
            </div>
          ))}
          <small className="text-secondary">Cada rango indica dónde atiendes: clínica, domicilio o ambos.</small>
        </div>
      </div>

      <div className="card border-0 shadow-sm mb-3">
        <div className="card-body">
          <p className="mb-2 fw-semibold">
            <i className="bi bi-calendar-check me-2" />
            Citas
          </p>
          <div className="row g-2">
            <div className="col-4">
              <label className="form-label small text-secondary">Duración (min)</label>
              <input
                type="number"
                className="form-control form-control-sm"
                min={15}
                step={15}
                value={raw.defaultDurationMinutes}
                onChange={e => mutate(d => (d.defaultDurationMinutes = Number(e.target.value)))}
              />
            </div>
            <div className="col-4">
              <label className="form-label small text-secondary">Mínima</label>
              <input
                type="number"
                className="form-control form-control-sm"
                min={15}
                step={15}
                value={raw.minDurationMinutes}
                onChange={e => mutate(d => (d.minDurationMinutes = Number(e.target.value)))}
              />
            </div>
            <div className="col-4">
              <label className="form-label small text-secondary">Máxima</label>
              <input
                type="number"
                className="form-control form-control-sm"
                min={15}
                step={15}
                value={raw.maxDurationMinutes}
                onChange={e => mutate(d => (d.maxDurationMinutes = Number(e.target.value)))}
              />
            </div>
            <div className="col-4">
              <label className="form-label small text-secondary">Inicios cada</label>
              <select
                className="form-select form-select-sm"
                value={raw.slotGranularityMinutes}
                onChange={e => mutate(d => (d.slotGranularityMinutes = Number(e.target.value)))}
              >
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
            </div>
            <div className="col-4">
              <label className="form-label small text-secondary">Cupos clínica</label>
              <input
                type="number"
                className="form-control form-control-sm"
                min={1}
                max={10}
                value={clinicMax}
                onChange={e =>
                  mutate(d => {
                    d.maxConcurrentAppointments = { ...d.maxConcurrentAppointments, in_clinic: Number(e.target.value) };
                  })
                }
              />
            </div>
            <div className="col-4">
              <label className="form-label small text-secondary">Buffer domicilio</label>
              <input
                type="number"
                className="form-control form-control-sm"
                min={0}
                step={15}
                value={homeBuffer}
                onChange={e =>
                  mutate(d => {
                    d.buffers = { ...d.buffers, home_visit: { bufferAfterMinutes: Number(e.target.value) } };
                  })
                }
              />
            </div>
            <div className="col-6">
              <label className="form-label small text-secondary">Agendar hasta (días)</label>
              <input
                type="number"
                className="form-control form-control-sm"
                min={1}
                max={365}
                value={raw.maxAdvanceDays}
                onChange={e => mutate(d => (d.maxAdvanceDays = Number(e.target.value)))}
              />
            </div>
          </div>
          <small className="text-secondary d-block mt-2">
            Domicilios: siempre 1 a la vez (no puedes estar en dos casas al mismo tiempo).
          </small>
        </div>
      </div>

      <div className="card border-0 shadow-sm mb-3">
        <div className="card-body">
          <p className="mb-2 fw-semibold">
            <i className="bi bi-bell me-2" />
            Notificaciones
          </p>
          <div className="row g-2">
            <div className="col-6">
              <label className="form-label small text-secondary">Recordatorio (min antes)</label>
              <input
                type="number"
                className="form-control form-control-sm"
                min={5}
                step={5}
                value={raw.notifications.reminderBeforeMinutes}
                onChange={e => mutate(d => (d.notifications.reminderBeforeMinutes = Number(e.target.value)))}
              />
            </div>
            <div className="col-6" />
            <div className="col-6">
              <label className="form-label small text-secondary">Resumen mañana a las</label>
              <input
                type="time"
                className="form-control form-control-sm"
                value={raw.notifications.morningNotificationTime}
                onChange={e => mutate(d => (d.notifications.morningNotificationTime = e.target.value))}
              />
            </div>
            <div className="col-6">
              <label className="form-label small text-secondary">Cubre citas hasta</label>
              <input
                type="time"
                className="form-control form-control-sm"
                value={raw.notifications.morningSessionUntil}
                onChange={e => mutate(d => (d.notifications.morningSessionUntil = e.target.value))}
              />
            </div>
            <div className="col-6">
              <label className="form-label small text-secondary">Resumen tarde a las</label>
              <input
                type="time"
                className="form-control form-control-sm"
                value={raw.notifications.afternoonNotificationTime}
                onChange={e => mutate(d => (d.notifications.afternoonNotificationTime = e.target.value))}
              />
            </div>
            <div className="col-6">
              <label className="form-label small text-secondary">Cubre citas desde</label>
              <input
                type="time"
                className="form-control form-control-sm"
                value={raw.notifications.afternoonSessionFrom}
                onChange={e => mutate(d => (d.notifications.afternoonSessionFrom = e.target.value))}
              />
            </div>
          </div>
          <hr className="my-3" />
          <p className="mb-2 small fw-semibold">Notificaciones en este dispositivo</p>
          {push === 'unsupported' && (
            <small className="text-secondary">
              Este navegador no soporta notificaciones push (en iPhone: instala la app en la pantalla de inicio
              primero).
            </small>
          )}
          {push === 'denied' && (
            <small className="text-danger">
              Las notificaciones están bloqueadas para este sitio. Habilítalas en la configuración del navegador.
            </small>
          )}
          {(push === 'off' || push === 'busy') && (
            <button className="btn btn-primary btn-sm" disabled={push === 'busy'} onClick={() => void enablePush()}>
              <i className="bi bi-bell me-1" />
              {push === 'busy' ? 'Activando…' : 'Activar en este dispositivo'}
            </button>
          )}
          {push === 'on' && (
            <div className="d-flex align-items-center gap-2">
              <span className="badge text-bg-success">
                <i className="bi bi-check-circle me-1" />
                Activadas
              </span>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => void disablePush()}>
                Desactivar
              </button>
            </div>
          )}
          {pushError && <div className="alert alert-danger py-1 small mt-2 mb-0">{pushError}</div>}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="alert alert-danger py-2 small">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      {warnings && warnings.length > 0 && (
        <div className="alert alert-warning py-2 small">
          <p className="mb-1 fw-semibold">
            <i className="bi bi-exclamation-triangle me-1" />
            {warnings.length} cita{warnings.length > 1 ? 's' : ''} futura{warnings.length > 1 ? 's quedan' : ' queda'}{' '}
            fuera del nuevo horario (no se cancelan solas):
          </p>
          {warnings.slice(0, 8).map((w, i) => (
            <div key={i}>{w}</div>
          ))}
          {warnings.length > 8 && <div>…y {warnings.length - 8} más</div>}
          <p className="mb-0 mt-1">Puedes guardar igual y luego reagendarlas o cancelarlas una por una.</p>
        </div>
      )}

      {saved && (
        <div className="alert alert-success py-2 small">
          <i className="bi bi-check-circle me-1" />
          Configuración guardada (versión {version}).
        </div>
      )}

      <div className="d-flex gap-2 mb-4">
        <button className="btn btn-primary flex-fill" disabled={saving} onClick={() => void save(warnings !== null)}>
          {saving ? 'Guardando…' : warnings !== null && warnings.length > 0 ? 'Guardar de todos modos' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}
