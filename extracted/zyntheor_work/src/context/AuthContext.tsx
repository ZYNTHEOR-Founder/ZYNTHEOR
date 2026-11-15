/**
 * ZYNTHEOR Auth Context — server-verified sessions only.
 * Role is derived from verified token claims, not client-editable elevation.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { apiUrl } from '../lib/apiClient';

export type AuthRole = 'User' | 'Developer' | 'Administrator';

export interface AuthSession {
  userId: string;
  email: string;
  tenantId: string;
  authenticatedAt: string;
  sovereignRole?: string;
  authMode?: 'google' | 'development';
  exp?: number;
}

export interface AuthErrorInfo {
  code: string;
  message: string;
}

interface AuthContextValue {
  role: AuthRole;
  /** Convenience: does not elevate privileges server-side without a new login. */
  setRole: (role: AuthRole) => void;
  session: AuthSession;
  token: string | null;
  isAuthenticated: boolean;
  authReady: boolean;
  devAccessEnabled: boolean;
  authError: AuthErrorInfo | null;
  clearAuthError: () => void;
  login: (role?: AuthRole, opts?: { userId?: string; tenantId?: string }) => Promise<boolean>;
  loginWithGoogle: () => Promise<boolean>;
  logout: () => void;
  authHeaders: () => Record<string, string>;
}

const TOKEN_KEY = 'zyntheor_session_token';
const SESSION_KEY = 'zyntheor_session_meta';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function loadStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function loadStoredMeta(): { email: string; authMode?: 'google' | 'development' } {
  if (typeof window === 'undefined') return { email: '' };
  try {
    const rawMeta = localStorage.getItem(SESSION_KEY);
    if (!rawMeta) return { email: '' };
    const parsed = JSON.parse(rawMeta);
    const email = typeof parsed?.session?.email === 'string' ? parsed.session.email : '';
    const authMode = parsed?.session?.authMode === 'development' || parsed?.session?.authMode === 'google'
      ? parsed.session.authMode
      : undefined;
    return { email, authMode };
  } catch {
    return { email: '' };
  }
}

export function getStoredAuthHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window === 'undefined') return h;
  try {
    const tok = localStorage.getItem(TOKEN_KEY);
    if (tok) h['Authorization'] = `Bearer ${tok}`;
    const rawMeta = localStorage.getItem(SESSION_KEY);
    if (rawMeta) {
      const parsed = JSON.parse(rawMeta);
      const tenantId = parsed?.session?.tenantId;
      if (tenantId) h['x-zyntheor-tenant'] = tenantId;
    }
  } catch {
    /* storage optional */
  }
  return h;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => loadStoredToken());
  const [role, setRoleState] = useState<AuthRole>('User');
  const [session, setSession] = useState<AuthSession>({
    userId: 'anonymous',
    email: '',
    tenantId: '',
    authenticatedAt: ''
  });
  const [authReady, setAuthReady] = useState(false);
  const [devAccessEnabled, setDevAccessEnabled] = useState(false);
  const [authError, setAuthError] = useState<AuthErrorInfo | null>(null);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const applySession = useCallback((tok: string, sess: AuthSession, uiRole: AuthRole) => {
    setToken(tok);
    setSession(sess);
    setRoleState(uiRole);
    setAuthError(null);
    try {
      localStorage.setItem(TOKEN_KEY, tok);
      localStorage.setItem(SESSION_KEY, JSON.stringify({ session: sess, role: uiRole }));
    } catch {
      /* storage optional */
    }
  }, []);

  const clearLocalSession = useCallback(() => {
    setToken(null);
    setRoleState('User');
    setSession({
      userId: 'anonymous',
      email: '',
      tenantId: '',
      authenticatedAt: ''
    });
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const logout = useCallback(() => {
    const currentToken = loadStoredToken();
    clearLocalSession();
    setAuthError(null);
    if (currentToken) {
      void fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`
        }
      }).catch(() => {
        /* best-effort server revocation */
      });
    }
    void signOut(auth).catch(() => {
      /* best-effort Firebase sign-out */
    });
  }, [clearLocalSession]);

  const login = useCallback(
    async (requestedRole: AuthRole = 'User', opts?: { userId?: string; tenantId?: string }) => {
      setAuthError(null);
      try {
        const res = await fetch(apiUrl('/api/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: requestedRole,
            userId: opts?.userId,
            tenantId: opts?.tenantId
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success || !data.token) {
          clearLocalSession();
          setAuthError({
            code: data?.code || `http/${res.status}`,
            message: data?.error || `Development login rejected (HTTP ${res.status}).`
          });
          return false;
        }
        const sess: AuthSession = {
          userId: data.session.userId,
          email: '',
          tenantId: data.session.tenantId,
          authenticatedAt: data.session.authenticatedAt,
          sovereignRole: data.session.sovereignRole,
          authMode: 'development',
          exp: data.expiresAt
        };
        applySession(data.token, sess, data.session.role as AuthRole);
        return true;
      } catch (err: any) {
        clearLocalSession();
        setAuthError({
          code: 'auth/network-error',
          message: err?.message || 'Unable to reach development authentication endpoint.'
        });
        return false;
      }
    },
    [applySession, clearLocalSession]
  );

  // Sync Firebase Auth email if Firebase user is loaded asynchronously after page reload
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser?.email) {
        setSession((prev) => {
          if (prev.userId === fbUser.uid && prev.email !== fbUser.email) {
            return { ...prev, email: fbUser.email || prev.email };
          }
          return prev;
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Bootstrap: discover auth mode (dev vs prod) and validate any stored token against server
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const modeRes = await fetch(apiUrl('/api/auth/mode'));
        if (modeRes.ok) {
          const modeData = await modeRes.json();
          if (!cancelled) {
            setDevAccessEnabled(Boolean(modeData?.devAccessEnabled));
          }
        }
      } catch {
        if (!cancelled) setDevAccessEnabled(false);
      }

      const existing = loadStoredToken();
      if (existing) {
        try {
          const res = await fetch(apiUrl('/api/auth/session'), {
            headers: { Authorization: `Bearer ${existing}` }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.session && !cancelled) {
              const storedMeta = loadStoredMeta();
              const resolvedAuthMode: 'google' | 'development' =
                storedMeta.authMode || (auth.currentUser ? 'google' : 'development');
              const preservedEmail =
                auth.currentUser?.email ||
                storedMeta.email ||
                '';
              const sess: AuthSession = {
                userId: data.session.userId,
                email: preservedEmail,
                tenantId: data.session.tenantId,
                authenticatedAt: new Date((data.session.iat || 0) * 1000).toISOString(),
                sovereignRole: data.session.sovereignRole,
                authMode: resolvedAuthMode,
                exp: data.session.exp
              };
              applySession(existing, sess, data.session.role as AuthRole);
              setAuthReady(true);
              return;
            }
          }
          // Server rejected the stored token (expired, revoked, or invalid signature) — fail closed
          if (!cancelled) {
            clearLocalSession();
          }
        } catch {
          if (!cancelled) {
            clearLocalSession();
          }
        }
      }
      // Never mint a privileged session automatically. Require an explicit identity-provider sign-in.
      if (!cancelled) setAuthReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession, clearLocalSession]);

  /** UI role switcher: re-login to obtain a token with the requested role (only when devAccessEnabled). */
  const setRole = useCallback(
    (next: AuthRole) => {
      if (!devAccessEnabled) return;
      void login(next, { userId: session.userId !== 'anonymous' ? session.userId : undefined, tenantId: session.tenantId || undefined });
    },
    [devAccessEnabled, login, session.tenantId, session.userId]
  );

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    if (session.tenantId) h['x-zyntheor-tenant'] = session.tenantId;
    return h;
  }, [token, session.tenantId]);

  const loginWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      const res = await fetch(apiUrl('/api/auth/firebase-session'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.token) {
        const errInfo: AuthErrorInfo = {
          code: data?.code || `http/${res.status}`,
          message: data?.error || `Backend Firebase session exchange failed (HTTP ${res.status}).`
        };
        console.error('[ZYNTHEOR Auth] Backend session exchange failed:', errInfo);
        setAuthError(errInfo);
        return false;
      }
      const sess: AuthSession = {
        userId: data.session.userId,
        email: data.session.email || cred.user.email || '',
        tenantId: data.session.tenantId,
        authenticatedAt: data.session.authenticatedAt,
        sovereignRole: data.session.sovereignRole,
        authMode: 'google',
        exp: data.expiresAt
      };
      applySession(data.token, sess, data.session.role as AuthRole);
      return true;
    } catch (err: any) {
      const code = typeof err?.code === 'string' ? err.code : 'auth/unknown';
      const message =
        typeof err?.message === 'string'
          ? err.message
          : 'Google sign-in failed unexpectedly.';
      console.error('[ZYNTHEOR Auth] Firebase Google sign-in error:', { code, message, err });
      setAuthError({ code, message });
      return false;
    }
  }, [applySession]);

  const value = useMemo(
    () => ({
      role,
      setRole,
      session,
      token,
      isAuthenticated: Boolean(token),
      authReady,
      devAccessEnabled,
      authError,
      clearAuthError,
      login,
      loginWithGoogle,
      logout,
      authHeaders
    }),
    [role, setRole, session, token, authReady, devAccessEnabled, authError, clearAuthError, login, loginWithGoogle, logout, authHeaders]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};
