import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import Scan from './pages/Scan';
import Tiers from './pages/Tiers';
import Settings from './pages/Settings';
import { Panel } from './design-system';

const SETTINGS_KEY = 'shieldbinary_user_settings_v1';

function applyStoredUiSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const reduce = !!parsed.forceReducedMotion;
    const compact = !!parsed.compactDensity;
    document.body.classList.toggle('sb-reduced-motion-force', reduce);
    document.body.classList.toggle('sb-density-compact', compact);
  } catch {
    document.body.classList.remove('sb-reduced-motion-force');
    document.body.classList.remove('sb-density-compact');
  }
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ maxWidth: 520, margin: '3rem auto' }}>
        <Panel>Synchronizing secure session...</Panel>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function App() {
  useEffect(() => {
    applyStoredUiSettings();
  }, []);

  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Layout hideUser><Login /></Layout>} />
        <Route path="/register" element={<Layout hideUser><Register /></Layout>} />
        <Route path="/" element={<Layout />}>
          <Route
            index
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route
            path="scan"
            element={
              <RequireAuth>
                <Scan />
              </RequireAuth>
            }
          />
          <Route
            path="tiers"
            element={
              <RequireAuth>
                <Tiers />
              </RequireAuth>
            }
          />
          <Route
            path="settings"
            element={
              <RequireAuth>
                <Settings />
              </RequireAuth>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
