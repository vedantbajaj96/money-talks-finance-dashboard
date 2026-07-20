import React, { useState, useEffect } from 'react';

type Mode = 'login' | 'setup';

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode]       = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [busy, setBusy]       = useState(false);

  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(d => { if (d.needs_setup) setMode('setup'); })
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const url = mode === 'setup' ? '/api/auth/setup' : '/api/auth/login';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) { onSuccess(); return; }
      const d = await res.json();
      setError(d.detail || (mode === 'setup' ? 'Setup failed' : 'Invalid username or password'));
    } catch {
      setError('Could not reach server');
    }
    setBusy(false);
  }

  const isSetup = mode === 'setup';

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-mark">
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
              <path d="M3 18 L8 6 L11 13 L14 9 L19 16"
                stroke="#052015" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="login-brand-name">MoneyTalks</span>
        </div>

        <h2 className="login-title">{isSetup ? 'Create first account' : 'Welcome back'}</h2>
        <p className="login-sub">{isSetup ? 'Set up the admin account to get started' : 'Sign in to your account'}</p>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={submit} className="login-form">
          <div className="login-field">
            <label>Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              autoComplete="username" autoFocus required />
          </div>
          <div className="login-field">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              autoComplete={isSetup ? 'new-password' : 'current-password'} required />
          </div>
          <button type="submit" className="login-submit" disabled={busy}>
            {busy ? (isSetup ? 'Creating…' : 'Signing in…') : (isSetup ? 'Create account' : 'Sign in')}
          </button>
        </form>
      </div>
    </div>
  );
}
