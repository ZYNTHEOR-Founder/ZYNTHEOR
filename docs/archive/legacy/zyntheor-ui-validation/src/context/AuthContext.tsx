/**
 * ZYNTHEOR Auth Context — server-verified sessions only.
 * Role is derived from verified token claims, not client-editable elevation.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';

export type AuthRole = 'User' | 'Developer' | 'Administrator';

export interface AuthSession {
  userId: string;
  email: string;
  tenantId: string;
  authenticatedAt: string;
  sovereignRole?: string;
  authMode?: string;
  exp?: number;
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
  authError: string | null;
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

export function getStoredAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window === 'undefined') return headers;
  try {
    const tok = localStorage.getItem(TOKEN_KEY);
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
    const rawMeta = localStorage.getItem(SESSION_KEY);
    if (rawMeta) {
      const parsed = JSON.parse(rawMeta);
      const tid = parsed?.session?.tenantId;
      if (typeof tid === 'string' && tid) headers['x-zyntheor-tenant'] = tid;
    }
  } catch {
    /* ignore storage errors */
  }
  return headers;
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
  const [authError, setAuthError] = useState<string | null>(null);

  const clearAuthError = useCallback(() => setAuthError(null), []);

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

  const logout = useCallback(() => {
    const currentTok = loadStoredToken();
    if (currentTok) {
      void fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${currentTok}` }
      }).catch(() => {});
    }
    void signOut(auth).catch(() => {});
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

  const login = useCallback(
    async (requestedRole: AuthRole = 'User', opts?: { userId?: string; tenantId?: string }) => {
      setAuthError(null);
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: requestedRole,
            userId: opts?.userId,
            tenantId: opts?.tenantId
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success || !data.token) {
          setAuthError(data?.error || data?.code || `Sign in failed (HTTP ${res.status})`);
          logout();
          return false;
        }
        const sess: AuthSession = {
          userId: data.session.userId,
          email: data.session.email || '',
          tenantId: data.session.tenantId,
          authenticatedAt: data.session.authenticatedAt,
          sovereignRole: data.session.sovereignRole,
          authMode: data.session.authMode || 'development',
          exp: data.expiresAt
        };
        applySession(data.token, sess, data.session.role as AuthRole);
        return true;
      } catch (err: any) {
        setAuthError(err?.message || 'Network error during authentication');
        logout();
        return false;
      }
    },
    [applySession, logout]
  );

  const loginWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      const res = await fetch('/api/auth/firebase-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        }
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.token) {
        setAuthError(data?.error || `Firebase session failed (HTTP ${res.status})`);
        return false;
      }
      const sess: AuthSession = {
        userId: data.session.userId,
        email: data.session.email || cred.user.email || '',
        tenantId: data.session.tenantId,
        authenticatedAt: data.session.authenticatedAt,
        sovereignRole: data.session.sovereignRole,
        authMode: data.session.authMode || 'firebase',
        exp: data.expiresAt
      };
      applySession(data.token, sess, data.session.role as AuthRole);
      return true;
    } catch (err: any) {
      const code = String(err?.code || '');
      const msg =
        code === 'auth/popup-blocked'
          ? 'Google sign-in popup was blocked by your browser. Allow popups or open the app in a new tab.'
          : code === 'auth/popup-closed-by-user'
          ? 'Google sign-in window was closed before completing authentication.'
          : code === 'auth/unauthorized-domain'
          ? `Domain ${typeof window !== 'undefined' ? window.location.hostname : ''} is not authorized for Firebase OAuth popup.`
          : err?.code || err?.message || 'Google sign-in failed';
      setAuthError(msg);
      return false;
    }
  }, [applySession]);

  // Bootstrap: detect auth mode and validate stored token if present
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const modeRes = await fetch('/api/auth/mode');
        if (modeRes.ok) {
          const modeData = await modeRes.json();
          if (!cancelled) {
            setDevAccessEnabled(Boolean(modeData?.devAccessEnabled));
          }
        }
      } catch {
        /* ignore mode probe failure */
      }

      const existing = loadStoredToken();
      if (existing) {
        try {
          const res = await fetch('/api/auth/session', {
            headers: { Authorization: `Bearer ${existing}` }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.session && !cancelled) {
              let storedEmail = '';
              let storedAuthMode: string | undefined = undefined;
              try {
                const rawMeta = localStorage.getItem(SESSION_KEY);
                if (rawMeta) {
                  const parsed = JSON.parse(rawMeta);
                  storedEmail = parsed?.session?.email || '';
                  storedAuthMode = parsed?.session?.authMode;
                }
              } catch {
                /* ignore */
              }
              const sess: AuthSession = {
                userId: data.session.userId,
                email: data.session.email || storedEmail,
                tenantId: data.session.tenantId,
                authenticatedAt: new Date((data.session.iat || 0) * 1000).toISOString(),
                sovereignRole: data.session.sovereignRole,
                authMode: data.session.authMode || storedAuthMode,
                exp: data.session.exp
              };
              applySession(existing, sess, data.session.role as AuthRole);
              setAuthReady(true);
              return;
            }
          }
        } catch {
          /* fall through to signed-out state */
        }
      }
      // Never bootstrap a privileged identity automatically.
      if (!cancelled) {
        setToken(null);
        setRoleState('User');
        setSession({
          userId: 'anonymous',
          email: '',
          tenantId: '',
          authenticatedAt: ''
        });
        setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  /** UI role switcher: re-login to obtain a token with the requested role (server-issued). */
  const setRole = useCallback(
    (next: AuthRole) => {
      void login(next, { userId: session.userId !== 'anonymous' ? session.userId : undefined, tenantId: session.tenantId || undefined });
    },
    [login, session.tenantId, session.userId]
  );

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    if (session.tenantId) h['x-zyntheor-tenant'] = session.tenantId;
    return h;
  }, [token, session.tenantId]);

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
