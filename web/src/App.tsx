import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Scan from './pages/Scan';
import Tiers from './pages/Tiers';
import Settings from './pages/Settings';
import { Panel } from './design-system';
import { applySettingsToBody, loadUserSettings } from './lib/userSettings';

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
    applySettingsToBody(loadUserSettings());
  }, []);

  return (
    <AuthProvider>
      <Routes>
        {/* Public landing page */}
        <Route path="/" element={<Layout hideUser />}>
          <Route index element={<Landing />} />
        </Route>

        {/* Auth pages */}
        <Route path="/login" element={<Layout hideUser><Login /></Layout>} />
        <Route path="/register" element={<Layout hideUser><Register /></Layout>} />

        {/* Authenticated app */}
        <Route path="/dashboard" element={<Layout />}>
          <Route
            index
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
        </Route>
        <Route
          path="/scan"
          element={
            <Layout>
              <RequireAuth>
                <Scan />
              </RequireAuth>
            </Layout>
          }
        />
        <Route
          path="/tiers"
          element={
            <Layout>
              <RequireAuth>
                <Tiers />
              </RequireAuth>
            </Layout>
          }
        />
        <Route
          path="/settings"
          element={
            <Layout>
              <RequireAuth>
                <Settings />
              </RequireAuth>
            </Layout>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
