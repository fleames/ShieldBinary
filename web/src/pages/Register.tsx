import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Alert, Button, Card, Input } from '../design-system';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { register, user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
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
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sb-auth-wrap">
      <h1 className="page-title">Create operator account</h1>
      <p className="page-subtitle">Initialize your secure workspace and start protecting binaries.</p>

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
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <label
            htmlFor="confirmPassword"
            style={{ display: 'grid', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}
          >
            Confirm password
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <Button type="submit" disabled={submitting} size="lg">
            {submitting ? 'Creating account...' : 'Create account'}
          </Button>
        </form>
      </Card>

      <p style={{ marginTop: '1.5rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        Already have an account?{' '}
        <Link to="/login" style={{ color: 'var(--accent)' }}>
          Sign in
        </Link>
      </p>
    </div>
  );
}
