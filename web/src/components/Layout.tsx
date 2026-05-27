import { Outlet, Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Badge, Button } from '../design-system';
import { loadUserSettings } from '../lib/userSettings';

type LayoutProps = { children?: React.ReactNode; hideUser?: boolean };

export default function Layout({ children, hideUser }: LayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';
  const showUser = !hideUser && !isAuthPage && user;
  const handleLogout = () => {
    const settings = loadUserSettings();
    if (settings.confirmBeforeLogout && !window.confirm('Log out of your account now?')) return;
    logout();
  };

  return (
    <div className="app-shell">
      <header className="sb-header">
        <div className="sb-header__inner">
          <div className="sb-header__left">
            <Link to="/" className="sb-brand">
              Ghost<span className="sb-brand__glow">Binary</span>
            </Link>
            {showUser && (
              <NavLink to="/dashboard" className={({ isActive }) => `sb-nav-link${isActive ? ' active' : ''}`}>
                Protect
              </NavLink>
            )}
            {showUser && (
              <NavLink to="/scan" className={({ isActive }) => `sb-nav-link${isActive ? ' active' : ''}`}>
                Scan
              </NavLink>
            )}
            {showUser && (
              <NavLink to="/tiers" className={({ isActive }) => `sb-nav-link${isActive ? ' active' : ''}`}>
                Tiers
              </NavLink>
            )}
            {showUser && (
              <NavLink to="/settings" className={({ isActive }) => `sb-nav-link${isActive ? ' active' : ''}`}>
                Settings
              </NavLink>
            )}
            <a href="/api/v1/docs" target="_blank" rel="noopener noreferrer" className="sb-nav-link">
              API Docs
            </a>
            <Badge tone="accent">beta</Badge>
          </div>
          {showUser && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
              <Badge tone="neutral">{user.email}</Badge>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                Log out
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="app-main">
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
