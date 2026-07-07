import { useEffect, useState } from 'react';
import { createPatient, fetchPatients, softDeletePatient, updatePatient } from '../lib/api';
import type { Patient, PatientFields } from '../lib/api';
import { ModalShell } from '../calendar/modals';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function PatientsScreen({ live }: { live: boolean }) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Patient | 'new' | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!live) return;
    let alive = true;
    setLoading(true);
    fetchPatients()
      .then(p => {
        if (alive) {
          setPatients(p);
          setError(null);
        }
      })
      .catch(e => {
        if (alive) setError(e instanceof Error ? e.message : 'Error cargando pacientes');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [live, tick]);

  if (!live) {
    return <p className="text-secondary small p-3">La gestión de pacientes requiere conexión a Supabase.</p>;
  }

  const filtered = patients.filter(p => norm(p.name).includes(norm(query)));

  return (
    <div className="pt-2">
      <div className="d-flex gap-2 mb-3">
        <input
          className="form-control"
          placeholder="Buscar paciente"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Buscar paciente"
        />
        <button className="btn btn-primary" aria-label="Nuevo paciente" onClick={() => setEditing('new')}>
          <i className="bi bi-person-plus" />
        </button>
      </div>

      {loading && <p className="text-secondary small">Cargando…</p>}
      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      <div className="list-group">
        {filtered.map(p => (
          <button
            key={p.id}
            className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
            onClick={() => setEditing(p)}
          >
            <span>
              {p.name}
              {p.phone && <small className="text-secondary d-block">{p.phone}</small>}
            </span>
            <i className="bi bi-chevron-right text-secondary" aria-hidden="true" />
          </button>
        ))}
      </div>
      {!loading && filtered.length === 0 && (
        <p className="text-secondary small p-2">
          {query ? 'Sin resultados para esa búsqueda.' : 'Aún no hay pacientes. También se crean solos al agendar (RN-092).'}
        </p>
      )}

      {editing && (
        <PatientEditor
          patient={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setTick(t => t + 1);
          }}
        />
      )}
    </div>
  );
}

function PatientEditor({
  patient,
  onClose,
  onSaved,
}: {
  patient: Patient | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(patient?.name ?? '');
  const [phone, setPhone] = useState(patient?.phone ?? '');
  const [email, setEmail] = useState(patient?.email ?? '');
  const [address, setAddress] = useState(patient?.address ?? '');
  const [notes, setNotes] = useState(patient?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
      setBusy(false);
    }
  };

  const save = () => {
    if (!name.trim()) {
      setError('El nombre es obligatorio (es el único dato requerido)');
      return;
    }
    const fields: PatientFields = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
    };
    void run(() => (patient ? updatePatient(patient.id, fields) : createPatient(fields)));
  };

  return (
    <ModalShell title={patient ? patient.name : 'Nuevo paciente'} onClose={onClose}>
      <div className="mb-2">
        <label className="form-label small text-secondary" htmlFor="p-name">
          Nombre *
        </label>
        <input id="p-name" className="form-control" value={name} onChange={e => setName(e.target.value)} autoFocus />
      </div>
      <div className="row g-2 mb-2">
        <div className="col-6">
          <label className="form-label small text-secondary" htmlFor="p-phone">
            Teléfono
          </label>
          <input id="p-phone" className="form-control" value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        <div className="col-6">
          <label className="form-label small text-secondary" htmlFor="p-email">
            Email
          </label>
          <input
            id="p-email"
            type="email"
            className="form-control"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>
      </div>
      <div className="mb-2">
        <label className="form-label small text-secondary" htmlFor="p-address">
          Dirección
        </label>
        <input id="p-address" className="form-control" value={address} onChange={e => setAddress(e.target.value)} />
      </div>
      <div className="mb-3">
        <label className="form-label small text-secondary" htmlFor="p-notes">
          Notas
        </label>
        <textarea id="p-notes" className="form-control" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
      </div>

      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      {!confirmDelete ? (
        <div className="d-flex gap-2">
          <button className="btn btn-primary flex-fill" disabled={busy} onClick={save}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
          <button className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          {patient && (
            <button
              className="btn btn-outline-danger"
              disabled={busy}
              aria-label="Eliminar paciente"
              onClick={() => setConfirmDelete(true)}
            >
              <i className="bi bi-trash" />
            </button>
          )}
        </div>
      ) : (
        <div>
          <p className="form-text mb-2">
            El paciente se ocultará de búsquedas y autocompletado; su historial de citas se conserva para métricas.
          </p>
          <div className="d-flex gap-2">
            <button
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={() => void run(() => softDeletePatient(patient!.id))}
            >
              Confirmar eliminación
            </button>
            <button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => setConfirmDelete(false)}>
              Volver
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
