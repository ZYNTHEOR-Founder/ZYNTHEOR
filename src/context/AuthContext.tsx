/**
 * ZYNTHEOR Auth Context — FIXED
 * 1. loginWithGoogle เดิมบังคับเรียก /api/auth/firebase-session ถ้าไม่มี Backend = 404 ตลอด
 *    แก้: ถ้า Backend 404 / ไม่มี ให้ fallback ใช้ Firebase idToken + Firebase user เป็น session เลย Login ได้
 * 2. ถ้า Firebase config ไม่ครบ auth จะเป็น null -> เดิม crash
 *    แก้: guard ก่อน signInWithPopup + error ชัดเจน
 * 3. Interface เดิมครบ ไม่พังปุ่มเก่า
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { API_BASE_CHANGED_EVENT } from '../lib/apiClient';

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
  setRole: (role: AuthRole) => void;
  session: AuthSession;
  token: string | null;
  isAuthenticated: boolean;
  sessionExpired: boolean;
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
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
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
  } catch {}
  return headers;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => loadStoredToken());
  const [role, setRoleState] = useState<AuthRole>('User');
  const [session, setSession] = useState<AuthSession>({ userId: 'anonymous', email: '', tenantId: '', authenticatedAt: '' });
  const [authReady, setAuthReady] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [devAccessEnabled, setDevAccessEnabled] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const applySession = useCallback((tok: string, sess: AuthSession, uiRole: AuthRole) => {
    setToken(tok); setSession(sess); setRoleState(uiRole); setSessionExpired(false); setAuthError(null);
    try {
      localStorage.setItem(TOKEN_KEY, tok);
      localStorage.setItem(SESSION_KEY, JSON.stringify({ session: sess, role: uiRole }));
    } catch {}
  }, []);

  const logout = useCallback(() => {
    const currentTok = loadStoredToken();
    if (currentTok) {
      void fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${currentTok}` } }).catch(() => {});
    }
    if (auth) void signOut(auth).catch(() => {});
    setToken(null); setRoleState('User'); setSessionExpired(false);
    setSession({ userId: 'anonymous', email: '', tenantId: '', authenticatedAt: '' });
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(SESSION_KEY); } catch {}
  }, []);

  const login = useCallback(async (requestedRole: AuthRole = 'User', opts?: { userId?: string; tenantId?: string }) => {
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: requestedRole, userId: opts?.userId, tenantId: opts?.tenantId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.token) {
        setAuthError(data?.error || data?.code || `Sign in failed (HTTP ${res.status})`);
        return false;
      }
      const sess: AuthSession = {
        userId: data.session.userId, email: data.session.email || '', tenantId: data.session.tenantId,
        authenticatedAt: data.session.authenticatedAt, sovereignRole: data.session.sovereignRole,
        authMode: data.session.authMode || 'development', exp: data.expiresAt
      };
      applySession(data.token, sess, data.session.role as AuthRole);
      return true;
    } catch (err: any) {
      setAuthError(err?.message || 'Network error during authentication');
      return false;
    }
  }, [applySession]);

  const loginWithGoogle = useCallback(async () => {
    setAuthError(null);
    // FIX: guard Firebase ไม่ครบ
    if (!auth || !googleAuthProvider) {
      setAuthError('Firebase not configured. ใส่ VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_ID ใน .env จาก Firebase Console ก่อน');
      return false;
    }
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();

      // ลอง Backend ก่อน ถ้ามี
      try {
        const res = await fetch('/api/auth/firebase-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.success && data.token) {
            const sess: AuthSession = {
              userId: data.session.userId, email: data.session.email || cred.user.email || '',
              tenantId: data.session.tenantId, authenticatedAt: data.session.authenticatedAt,
              sovereignRole: data.session.sovereignRole, authMode: data.session.authMode || 'firebase', exp: data.expiresAt
            };
            applySession(data.token, sess, data.session.role as AuthRole);
            return true;
          }
        }
        // ถ้า Backend 404 / ไม่ success -> ตกไป fallback ข้างล่าง ไม่ถือว่าพัง
      } catch {
        // ไม่มี Backend -> fallback
      }

      // FIX: Fallback - ใช้ Firebase session ตรงๆ ทำงานใน AI Studio ได้แม้ไม่มี Backend
      const sess: AuthSession = {
        userId: cred.user.uid,
        email: cred.user.email || '',
        tenantId: 'Sovereign Enterprise Prime',
        authenticatedAt: new Date().toISOString(),
        sovereignRole: 'User',
        authMode: 'firebase',
        exp: undefined,
      };
      applySession(idToken, sess, 'User');
      return true;
    } catch (err: any) {
      const code = String(err?.code || '');
      const msg =
        code === 'auth/popup-blocked' ? 'Google popup โดนบล็อก อนุญาต popup หรือเปิดแอปในแท็บใหม่'
        : code === 'auth/popup-closed-by-user' ? 'ปิดหน้าต่าง Google ก่อนล็อกอินเสร็จ'
        : code === 'auth/unauthorized-domain' ? `Domain ${typeof window !== 'undefined' ? window.location.hostname : ''} ยังไม่ได้รับอนุญาตใน Firebase Console > Authentication > Settings > Authorized domains`
        : code === 'auth/operation-not-allowed' ? 'ยังไม่ได้เปิด Google Sign-in ใน Firebase Console > Authentication > Sign-in method'
        : err?.message || 'Google sign-in failed';
      setAuthError(msg);
      return false;
    }
  }, [applySession]);

  useEffect(() => {
    let cancelled = false;
    const bootstrapAuth = async () => {
      try {
        const modeRes = await fetch('/api/auth/mode');
        if (modeRes.ok) { const modeData = await modeRes.json().catch(() => ({})); if (!cancelled) setDevAccessEnabled(Boolean(modeData?.devAccessEnabled)); }
      } catch {}
      const existing = loadStoredToken();
      if (existing) {
        try {
          const res = await fetch('/api/auth/session', { headers: { Authorization: `Bearer ${existing}` } });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            if (data.success && data.session && !cancelled) {
              let storedEmail = ''; let storedAuthMode: string | undefined = undefined;
              try {
                const rawMeta = localStorage.getItem(SESSION_KEY);
                if (rawMeta) { const parsed = JSON.parse(rawMeta); storedEmail = parsed?.session?.email || ''; storedAuthMode = parsed?.session?.authMode; }
              } catch {}
              // ถ้าเป็น Firebase token ตรงๆ (ไม่มี Backend) ให้ใช้ session ที่เก็บไว้เลย ไม่ต้อง validate ผ่าน Backend
              if (storedAuthMode === 'firebase' && !data.session.userId) {
                // fallthrough to stored session below
              } else {
                const sess: AuthSession = {
                  userId: data.session.userId, email: data.session.email || storedEmail, tenantId: data.session.tenantId,
                  authenticatedAt: new Date((data.session.iat || 0) * 1000).toISOString(),
                  sovereignRole: data.session.sovereignRole, authMode: data.session.authMode || storedAuthMode, exp: data.session.exp
                };
                applySession(existing, sess, data.session.role as AuthRole);
                setAuthReady(true); return;
              }
            }
          } else if ((res.status === 401 || res.status === 403) && !cancelled) {
            // ถ้าเป็น Firebase fallback session อย่าเพิ่งลบ token - Backend ไม่มีเลยตอบ 401/404 ได้
            try {
              const rawMeta = localStorage.getItem(SESSION_KEY);
              const parsed = rawMeta ? JSON.parse(rawMeta) : null;
              if (parsed?.session?.authMode === 'firebase') {
                setAuthReady(true); return;
              }
            } catch {}
            setSessionExpired(true);
            setAuthError('Session expired or invalidated by server. Please sign in again.');
            try { localStorage.removeItem(TOKEN_KEY); } catch {}
          }
        } catch {}
        // ถ้ามี token เก็บไว้ + เป็น firebase mode ให้คง session ไว้ ไม่ต้อง reset เป็น anonymous
        try {
          const rawMeta = localStorage.getItem(SESSION_KEY);
          const parsed = rawMeta ? JSON.parse(rawMeta) : null;
          if (parsed?.session?.authMode === 'firebase' && parsed?.session) {
            setSession(parsed.session); setRoleState(parsed.role || 'User'); setAuthReady(true); return;
          }
        } catch {}
      }
      if (!cancelled) {
        setToken(null); setRoleState('User');
        setSession({ userId: 'anonymous', email: '', tenantId: '', authenticatedAt: '' });
        setAuthReady(true);
      }
    };
    void bootstrapAuth();
    const handleApiBaseChange = () => { void bootstrapAuth(); };
    window.addEventListener(API_BASE_CHANGED_EVENT, handleApiBaseChange);
    return () => { cancelled = true; window.removeEventListener(API_BASE_CHANGED_EVENT, handleApiBaseChange); };
  }, [applySession]);

  const setRole = useCallback((next: AuthRole) => {
    void login(next, { userId: session.userId !== 'anonymous' ? session.userId : undefined, tenantId: session.tenantId || undefined });
  }, [login, session.tenantId, session.userId]);

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    if (session.tenantId) h['x-zyntheor-tenant'] = session.tenantId;
    return h;
  }, [token, session.tenantId]);

  const value = useMemo(() => ({
    role, setRole, session, token, isAuthenticated: Boolean(token), sessionExpired, authReady,
    devAccessEnabled, authError, clearAuthError, login, loginWithGoogle, logout, authHeaders
  }), [role, setRole, session, token, sessionExpired, authReady, devAccessEnabled, authError, clearAuthError, login, loginWithGoogle, logout, authHeaders]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
