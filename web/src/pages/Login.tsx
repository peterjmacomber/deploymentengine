import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../stores/authStore';
import { ApiError } from '../api/client';

const DEMO = [
  ['admin@deployment.local', 'Admin'],
  ['manager@deployment.local', 'Manager'],
  ['agent@deployment.local', 'Agent'],
  ['viewer@deployment.local', 'Read-only'],
];

export function Login() {
  const login = useAuth((s) => s.login);
  const status = useAuth((s) => s.status);
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@deployment.local');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (status === 'authed') navigate('/');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--sidebar)' }}>
      <div className="card" style={{ width: 380 }}>
        <div className="row" style={{ gap: 10, marginBottom: 16 }}>
          <span className="public-header dot" style={{ margin: 0 }}>◆</span>
          <div>
            <h1 style={{ margin: 0, fontSize: 20 }}>Deployment Engine</h1>
            <div className="muted small">FortisPay equipment deployment</div>
          </div>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error && <div className="field err">{error}</div>}
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="divider" />
        <div className="small muted">Demo accounts (password <span className="mono">password123</span>):</div>
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          {DEMO.map(([em, label]) => (
            <button key={em} className="btn sm" onClick={() => { setEmail(em); setPassword('password123'); }}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
