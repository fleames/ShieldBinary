import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Alert, Button, Card, Input } from '../design-system';

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate('/dashboard', { replace: true });
  }, [user, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sb-auth-wrap">
      <h1 className="page-title">Welcome back</h1>
      <p className="page-subtitle">Sign in to your GhostBinary workspace.</p>

      {error && (
        <Alert tone="danger" style={{ marginBottom: '1.25rem' }}>{error}</Alert>
      )}

      <Card>
        <form onSubmit={handleSubmit} className="sb-stack">
          <label style={{ display: 'grid', gap: '0.4rem', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
            Email
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
            />
          </label>

          <label style={{ display: 'grid', gap: '0.4rem', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
            Password
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </label>

          <Button type="submit" disabled={submitting} size="lg" style={{ marginTop: '0.25rem' }}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>

      <p style={{ marginTop: '1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
        Don't have an account?{' '}
        <Link to="/register" style={{ color: 'var(--blue)', fontWeight: 500 }}>
          Create a free account
        </Link>
      </p>
    </div>
  );
}
