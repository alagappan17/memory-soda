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
  changePassword as apiChangePassword,
  getMe,
  AUTH_TOKEN_KEY,
} from '@/lib/api';

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Set at login while the account still uses the shipped default; cleared once changed. */
  usingDefaultPassword: boolean;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
}

// Survives reloads so the nag does not vanish on refresh; only login/change touch it.
const DEFAULT_PW_KEY = 'ms_using_default_password';

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingDefaultPassword, setUsingDefaultPassword] = useState(
    () => localStorage.getItem(DEFAULT_PW_KEY) === '1',
  );

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
    const { token, user, usingDefaultPassword } = await apiLogin(
      username,
      password,
    );
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(DEFAULT_PW_KEY, usingDefaultPassword ? '1' : '0');
    setUsingDefaultPassword(usingDefaultPassword);
    setUser({ userId: user.id, username: user.username });
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await apiChangePassword(currentPassword, newPassword);
      localStorage.setItem(DEFAULT_PW_KEY, '0');
      setUsingDefaultPassword(false);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // Best-effort; clear local state regardless.
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(DEFAULT_PW_KEY);
    setUsingDefaultPassword(false);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        usingDefaultPassword,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
