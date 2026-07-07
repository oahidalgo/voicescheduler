import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { addDays, weekdayOf, zonedNow } from '@voicescheduler/core';
import { DayView } from './calendar/DayView';
import { WeekView } from './calendar/WeekView';
import { AppointmentDetailModal, NewAppointmentModal } from './calendar/modals';
import { LoginScreen } from './auth/LoginScreen';
import { PatientsScreen } from './patients/PatientsScreen';
import { VoiceSheet } from './voice/VoiceSheet';
import { useAgenda } from './hooks/useAgenda';
import { supabase } from './lib/supabase';
import type { UiAppointment } from './data/sample';

type ViewMode = 'day' | 'week';
type Screen = 'agenda' | 'patients' | 'settings';

const dateFmt = new Intl.DateTimeFormat('es-GT', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function formatDate(dateISO: string): string {
  const label = dateFmt.format(new Date(`${dateISO}T00:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!authReady) return null;
  if (supabase && !session) return <LoginScreen />;
  return <AgendaApp live={supabase !== null} email={session?.user.email ?? null} />;
}

function AgendaApp({ live, email }: { live: boolean; email: string | null }) {
  const [view, setView] = useState<ViewMode>('day'); // RN-165: defaultCalendarView
  const [screen, setScreen] = useState<Screen>('agenda');
  const [selectedDate, setSelectedDate] = useState(() => zonedNow('America/Guatemala').date);
  const agenda = useAgenda(live, selectedDate);
  const [newAt, setNewAt] = useState<number | null>(null);
  const [detail, setDetail] = useState<UiAppointment | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const today = zonedNow(agenda.config.timezone).date;
  const monday = addDays(selectedDate, 1 - weekdayOf(selectedDate));

  const dayAppts = agenda.appointments.filter(a => a.date === selectedDate && a.status !== 'cancelled');
  const unpaid = dayAppts.filter(a => !a.paid).length;
  const homeVisits = dayAppts.filter(a => a.mode === 'home_visit').length;

  const badge = !live
    ? { label: 'datos de ejemplo', className: 'text-bg-light border' }
    : agenda.loading
      ? { label: 'sincronizando…', className: 'text-bg-light border' }
      : agenda.error
        ? { label: agenda.error, className: 'text-bg-danger' }
        : { label: 'Supabase conectado', className: 'text-bg-success' };

  return (
    <div className="vs-shell">
      <header className="d-flex align-items-center justify-content-between px-3 pt-3 pb-2">
        <div>
          <div className="d-flex align-items-center gap-1">
            {screen === 'agenda' && view === 'day' && (
              <button
                className="btn btn-sm btn-link text-body p-0 me-1"
                aria-label="Día anterior"
                onClick={() => setSelectedDate(addDays(selectedDate, -1))}
              >
                <i className="bi bi-chevron-left" />
              </button>
            )}
            <h1 className="h5 mb-0 fw-semibold">
              {screen === 'settings'
                ? 'Ajustes'
                : screen === 'patients'
                  ? 'Pacientes'
                  : view === 'day'
                    ? selectedDate === today
                      ? `Hoy · ${formatDate(selectedDate)}`
                      : formatDate(selectedDate)
                    : 'Semana'}
            </h1>
            {screen === 'agenda' && view === 'day' && (
              <button
                className="btn btn-sm btn-link text-body p-0 ms-1"
                aria-label="Día siguiente"
                onClick={() => setSelectedDate(addDays(selectedDate, 1))}
              >
                <i className="bi bi-chevron-right" />
              </button>
            )}
          </div>
          {screen === 'agenda' && view === 'day' && (
            <small className="text-secondary">
              {dayAppts.length} citas
              {homeVisits > 0 && ` · ${homeVisits} domicilio${homeVisits > 1 ? 's' : ''}`}
              {unpaid > 0 && ` · ${unpaid} sin pagar`}
            </small>
          )}
          <div>
            <span className={`badge rounded-pill ${badge.className}`} style={{ fontSize: 10 }}>
              {badge.label}
            </span>
          </div>
        </div>
        {screen === 'agenda' && (
          <div className="btn-group" role="group" aria-label="Modo de vista">
            <button
              className={`btn btn-sm ${view === 'day' ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setView('day')}
            >
              Día
            </button>
            <button
              className={`btn btn-sm ${view === 'week' ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setView('week')}
            >
              Semana
            </button>
          </div>
        )}
      </header>

      <main className="vs-main">
        {screen === 'patients' ? (
          <PatientsScreen live={live} />
        ) : screen === 'settings' ? (
          <div className="p-2">
            <div className="card border-0 shadow-sm mb-3">
              <div className="card-body">
                <p className="mb-1 small text-secondary">Sesión</p>
                <p className="mb-3">{email ?? 'modo ejemplo (sin sesión)'}</p>
                {live && (
                  <button className="btn btn-outline-danger btn-sm" onClick={() => supabase?.auth.signOut()}>
                    <i className="bi bi-box-arrow-right me-1" />
                    Cerrar sesión
                  </button>
                )}
              </div>
            </div>
            <p className="small text-secondary px-1">
              Zona horaria del negocio: {agenda.config.timezone}. La edición de horarios y notificaciones llega en la
              fase de configuración.
            </p>
          </div>
        ) : view === 'day' ? (
          <DayView
            date={selectedDate}
            appointments={agenda.appointments}
            exceptions={agenda.exceptions}
            config={agenda.config}
            onTapEmpty={live ? setNewAt : undefined}
            onTapAppointment={live ? setDetail : undefined}
          />
        ) : (
          <WeekView
            monday={monday}
            today={today}
            appointments={agenda.appointments}
            exceptions={agenda.exceptions}
            config={agenda.config}
            onSelectDay={date => {
              setSelectedDate(date);
              setView('day');
            }}
          />
        )}
        {screen === 'agenda' && (
          <div className="vs-legend">
            <span>
              <span className="swatch" style={{ background: 'var(--vs-clinic-border)' }} />
              clínica
            </span>
            <span>
              <span className="swatch" style={{ background: 'var(--vs-home-border)' }} />
              domicilio
            </span>
            <span>
              <i className="bi bi-wallet2 me-1" style={{ color: 'var(--vs-unpaid)' }} />
              pago pendiente
            </span>
          </div>
        )}
      </main>

      <button className="vs-fab" aria-label="Abrir asistente de voz" title="Asistente de voz" onClick={() => setVoiceOpen(true)}>
        <i className="bi bi-mic" />
      </button>

      <nav className="vs-bottomnav" aria-label="Navegación principal">
        <button className={screen === 'agenda' ? 'active' : ''} onClick={() => setScreen('agenda')}>
          <i className="bi bi-calendar3" />
          Agenda
        </button>
        <button className={screen === 'patients' ? 'active' : ''} onClick={() => setScreen('patients')}>
          <i className="bi bi-people" />
          Pacientes
        </button>
        <button className={screen === 'settings' ? 'active' : ''} onClick={() => setScreen('settings')}>
          <i className="bi bi-gear" />
          Ajustes
        </button>
      </nav>

      {newAt !== null && (
        <NewAppointmentModal
          date={selectedDate}
          defaultStart={newAt}
          config={agenda.config}
          appointments={agenda.appointments}
          exceptions={agenda.exceptions}
          onClose={() => setNewAt(null)}
          onCreated={() => {
            setNewAt(null);
            agenda.reload();
          }}
        />
      )}
      {voiceOpen && (
        <VoiceSheet
          live={live}
          config={agenda.config}
          exceptions={agenda.exceptions}
          onClose={() => setVoiceOpen(false)}
          onExecuted={agenda.reload}
        />
      )}
      {detail && (
        <AppointmentDetailModal
          appt={detail}
          config={agenda.config}
          appointments={agenda.appointments}
          exceptions={agenda.exceptions}
          onClose={() => setDetail(null)}
          onChanged={() => {
            setDetail(null);
            agenda.reload();
          }}
        />
      )}
    </div>
  );
}
