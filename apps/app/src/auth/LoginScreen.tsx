import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) setError('Correo o contraseña incorrectos');
    setBusy(false);
  };

  return (
    <div className="vs-shell justify-content-center">
      <div className="px-4">
        <div className="text-center mb-4">
          <div className="display-6 text-primary mb-2">
            <i className="bi bi-mic" aria-hidden="true" />
          </div>
          <h1 className="h4 fw-semibold mb-1">VoiceScheduler</h1>
          <p className="text-secondary small mb-0">Tu agenda, por voz y por pantalla</p>
        </div>
        <form onSubmit={submit} className="card border-0 shadow-sm">
          <div className="card-body p-4">
            <div className="mb-3">
              <label htmlFor="email" className="form-label small text-secondary">
                Correo
              </label>
              <input
                id="email"
                type="email"
                className="form-control"
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="mb-3">
              <label htmlFor="password" className="form-label small text-secondary">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                className="form-control"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <div className="alert alert-danger py-2 small">{error}</div>}
            <button type="submit" className="btn btn-primary w-100" disabled={busy}>
              {busy ? 'Entrando…' : 'Entrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
