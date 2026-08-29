import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import type { SessionUser } from '@memory-soda/types';
import {
  login as apiLogin,
  logout as apiLogout,
  getMe,
  AUTH_TOKEN_KEY,
} from '@/lib/api';

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const hydrate = useCallback(async () => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { user } = await getMe();
      setUser(user);
    } catch {
      // Invalid/expired token. The interceptor cleared it but deliberately did
      // not redirect, RequireAuth does that, keeping the attempted path.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const login = useCallback(async (username: string, password: string) => {
    const { token, user } = await apiLogin(username, password);
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    setUser({ userId: user.id, username: user.username });
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // Best-effort; clear local state regardless.
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
