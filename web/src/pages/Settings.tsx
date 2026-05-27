import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Alert, Badge, Button, Card, Checkbox, Select } from '../design-system';
import {
  DEFAULT_USER_SETTINGS,
  applySettingsToBody,
  loadUserSettings,
  saveUserSettings,
  type UserSettings,
} from '../lib/userSettings';

export default function Settings() {
  const { user, token, logout } = useAuth();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasToken = useMemo(() => !!token, [token]);

  useEffect(() => {
    const current = loadUserSettings();
    setSettings(current);
    applySettingsToBody(current);
  }, []);

  const saveSettings = () => {
    saveUserSettings(settings);
    applySettingsToBody(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };

  const resetSettings = () => {
    setSettings(DEFAULT_USER_SETTINGS);
    saveUserSettings(DEFAULT_USER_SETTINGS);
    applySettingsToBody(DEFAULT_USER_SETTINGS);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };

  const copyUserId = async () => {
    if (!user?.id) return;
    try {
      await navigator.clipboard.writeText(user.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const handleLogout = () => {
    if (settings.confirmBeforeLogout && !window.confirm('Log out of your account now?')) return;
    logout();
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1 className="page-title">Profile & Settings</h1>
      <p className="page-subtitle">
        Manage account details and local interface preferences.
      </p>

      {saved && <Alert tone="success" style={{ marginBottom: '1rem' }}>Settings saved.</Alert>}

      <div className="sb-stack">
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.8rem', marginBottom: '0.8rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Profile</h2>
            <Badge tone={hasToken ? 'success' : 'warning'}>{hasToken ? 'Authenticated' : 'No active session'}</Badge>
          </div>
          <div className="sb-stack" style={{ gap: '0.55rem' }}>
            <div><strong>Email:</strong> {user?.email ?? 'unknown'}</div>
            <div><strong>User ID:</strong> {user?.id ?? 'unknown'}</div>
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm" onClick={copyUserId} disabled={!user?.id}>
              {copied ? 'Copied' : 'Copy user ID'}
            </Button>
            <Button variant="danger" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </Card>

        <Card>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Interface Preferences</h2>
          <div className="sb-stack">
            <label style={{ display: 'grid', gap: '0.35rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Default protection tier
              <Select
                value={settings.defaultTier}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    defaultTier: e.target.value as UserSettings['defaultTier'],
                  }))
                }
              >
                <option value="minimal">Minimal</option>
                <option value="basic">Basic</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </Select>
            </label>

            <label style={{ display: 'grid', gap: '0.35rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Default preset profile
              <Select
                value={settings.defaultPreset}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    defaultPreset: e.target.value as UserSettings['defaultPreset'],
                  }))
                }
              >
                <option value="compatibility">Compatibility</option>
                <option value="balanced">Balanced</option>
                <option value="polymorphic">Polymorphic</option>
              </Select>
            </label>

            <label style={{ display: 'grid', gap: '0.35rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Dashboard job poll interval
              <Select
                value={String(settings.jobPollIntervalMs)}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    jobPollIntervalMs: Number(e.target.value) as UserSettings['jobPollIntervalMs'],
                  }))
                }
              >
                <option value="1000">Fast (1.0s)</option>
                <option value="1500">Default (1.5s)</option>
                <option value="2500">Balanced (2.5s)</option>
                <option value="4000">Low traffic (4.0s)</option>
              </Select>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Checkbox
                checked={settings.forceReducedMotion}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, forceReducedMotion: e.target.checked }))
                }
              />
              <span>Force reduced motion (disable animated effects)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Checkbox
                checked={settings.compactDensity}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, compactDensity: e.target.checked }))
                }
              />
              <span>Compact density (tighter spacing)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Checkbox
                checked={settings.confirmBeforeLogout}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, confirmBeforeLogout: e.target.checked }))
                }
              />
              <span>Ask confirmation before log out</span>
            </label>
          </div>

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={saveSettings}>Save settings</Button>
            <Button variant="ghost" onClick={resetSettings}>Reset defaults</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

