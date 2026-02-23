import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';

const API = '/api/v1';
const TOKEN_KEY = 'shieldbinary_token';

type User = { id: string; email: string } | null;

type AuthContextType = {
  user: User;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);

  const authFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return apiFetch(url, { ...init, headers });
    },
    [token]
  );

  const fetchMe = useCallback(async () => {
    const res = await authFetch(`${API}/auth/me`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/60f530a7-18e0-420c-9616-89f6ce8bf38b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'baseline',hypothesisId:'H5',location:'web/src/contexts/AuthContext.tsx:40',message:'fetchMe completed',data:{status:res.status,ok:res.ok,hadToken:!!token},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (res.ok) {
      const d = await res.json();
      setUser(d.user ?? null);
      return true;
    }
    setUser(null);
    if (token) {
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
    }
    return false;
  }, [authFetch, token]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await fetchMe();
      } catch {
        if (mounted) setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [fetchMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiFetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const msg = res.status === 401
          ? 'Invalid email or password'
          : (await res.json().catch(() => ({}))).error || 'Login failed';
        throw new Error(msg);
      }
      const d = await res.json();
      const t = d.token ?? d.access_token;
      if (!t || typeof t !== 'string') throw new Error('No token in response');
      localStorage.setItem(TOKEN_KEY, t);
      setToken(t);
      setUser(d.user ?? null);
    },
    []
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const res = await apiFetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const msg = res.status === 409
          ? (d.error || 'Email already registered')
          : (d.error || 'Registration failed');
        throw new Error(msg);
      }
      const d = await res.json();
      const t = d.token ?? d.access_token;
      if (!t || typeof t !== 'string') throw new Error('No token in response');
      localStorage.setItem(TOKEN_KEY, t);
      setToken(t);
      setUser(d.user ?? null);
    },
    []
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, token, loading, login, register, logout, authFetch }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
