import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { authApi } from '@/services/auth';
import type { AuthUser, ChangePasswordInput, RegisterInput } from '@/services/auth';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login(email: string, password: string): Promise<AuthUser>;
  register(input: RegisterInput): Promise<AuthUser>;
  logout(): Promise<void>;
  changePassword(input: ChangePasswordInput): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
let sessionCheckInFlight: Promise<AuthUser> | null = null;

function getCurrentUser() {
  if (!sessionCheckInFlight) {
    sessionCheckInFlight = authApi.me().finally(() => {
      sessionCheckInFlight = null;
    });
  }
  return sessionCheckInFlight;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    getCurrentUser()
      .then((currentUser) => {
        if (current) setUser(currentUser);
      })
      .catch(() => {
        if (current) setUser(null);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const nextUser = await authApi.login(email, password);
    setUser(nextUser);
    return nextUser;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const nextUser = await authApi.register(input);
    setUser(nextUser);
    return nextUser;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const changePassword = useCallback(async (input: ChangePasswordInput) => {
    await authApi.changePassword(input);
    // The backend keeps this browser signed in and revokes all other sessions.
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, changePassword }),
    [user, loading, login, register, logout, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return value;
}
