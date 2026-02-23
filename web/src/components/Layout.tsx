import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type LayoutProps = { children?: React.ReactNode; hideUser?: boolean };

export default function Layout({ children, hideUser }: LayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';
  const showUser = !hideUser && !isAuthPage && user;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          padding: '1rem 2rem',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link to="/" style={{ textDecoration: 'none' }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontSize: '1.25rem',
                color: 'var(--accent)',
              }}
            >
              ShieldBinary
            </span>
          </Link>
          {showUser && (
            <Link
              to="/"
              style={{
                fontSize: '0.875rem',
                color: location.pathname === '/' ? 'var(--accent)' : 'var(--text-muted)',
                textDecoration: 'none',
              }}
            >
              Protect
            </Link>
          )}
          {showUser && (
            <Link
              to="/scan"
              style={{
                fontSize: '0.875rem',
                color: location.pathname === '/scan' ? 'var(--accent)' : 'var(--text-muted)',
                textDecoration: 'none',
              }}
            >
              Scan
            </Link>
          )}
          {showUser && (
            <Link
              to="/tiers"
              style={{
                fontSize: '0.875rem',
                color: location.pathname === '/tiers' ? 'var(--accent)' : 'var(--text-muted)',
                textDecoration: 'none',
              }}
            >
              Tiers
            </Link>
          )}
          <a
            href="/api/v1/docs"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-muted)',
              textDecoration: 'none',
            }}
          >
            API Docs
          </a>
          <span
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              padding: '0.15rem 0.4rem',
              background: 'var(--bg-muted)',
              borderRadius: '4px',
            }}
          >
            beta
          </span>
        </div>
        {showUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{user.email}</span>
            <button
              onClick={logout}
              style={{
                padding: '0.35rem 0.75rem',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-muted)',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Log out
            </button>
          </div>
        )}
      </header>
      <main style={{ flex: 1, padding: '2rem' }}>
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
