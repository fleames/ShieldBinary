import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Alert, Button, Card, Input } from '../design-system';

export default function Register() {
  const [email, setEmail]                   = useState('');
  const [password, setPassword]             = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError]                   = useState<string | null>(null);
  const [submitting, setSubmitting]         = useState(false);
  const { register, user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate('/dashboard', { replace: true });
  }, [user, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      await register(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sb-auth-wrap">
      <h1 className="page-title">Create an account</h1>
      <p className="page-subtitle">Start protecting binaries in seconds. No credit card needed.</p>

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
              placeholder="Min. 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>

          <label style={{ display: 'grid', gap: '0.4rem', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
            Confirm password
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>

          <Button type="submit" disabled={submitting} size="lg" style={{ marginTop: '0.25rem' }}>
            {submitting ? 'Creating account…' : 'Create free account'}
          </Button>
        </form>
      </Card>

      <p style={{ marginTop: '1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
        Already have an account?{' '}
        <Link to="/login" style={{ color: 'var(--blue)', fontWeight: 500 }}>
          Sign in
        </Link>
      </p>
    </div>
  );
}
