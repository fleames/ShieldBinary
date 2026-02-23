import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Alert, Button, Card, Input } from '../design-system';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [user, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sb-auth-wrap">
      <h1 className="page-title">Welcome back</h1>
      <p className="page-subtitle">Sign in to enter the protection control nexus.</p>

      {error && (
        <Alert tone="danger" style={{ marginBottom: '1.25rem' }}>{error}</Alert>
      )}

      <Card>
        <form onSubmit={handleSubmit} className="sb-stack">
          <label
            htmlFor="email"
            style={{ display: 'grid', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}
          >
            Email
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label
            htmlFor="password"
            style={{ display: 'grid', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}
          >
            Password
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <Button type="submit" disabled={submitting} size="lg">
            {submitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </Card>

      <p style={{ marginTop: '1.5rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        Don't have an account?{' '}
        <Link to="/register" style={{ color: 'var(--accent)' }}>
          Sign up
        </Link>
      </p>
    </div>
  );
}
