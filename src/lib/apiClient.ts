import { Capacitor } from '@capacitor/core';

/**
 * ZYNTHEOR Cloud & Mobile API Client
 * Supports:
 * 1) Same-origin Web Preview / Browser deployments (default empty base '')
 * 2) Build-time `VITE_API_URL` cloud origin
 * 3) Runtime user-configured Server Base URL persisted in localStorage (`zyntheor_api_base_url`)
 *    for native Android Capacitor WebView builds connecting to remote Express + WebSocket backends.
 */

const API_BASE_STORAGE_KEY = 'zyntheor_api_base_url';
export const API_BASE_CHANGED_EVENT = 'zyntheor:api-base-changed';

function normalizeBaseUrl(raw?: string | null): string {
  if (!raw) return '';
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(trimmed)) {
    return '';
  }
  return trimmed;
}

export const ENV_API_BASE_URL = normalizeBaseUrl(
  (import.meta as any).env ? (import.meta as any).env.VITE_API_URL || '' : ''
);

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    try {
      const stored = normalizeBaseUrl(window.localStorage.getItem(API_BASE_STORAGE_KEY));
      if (stored) return stored;
    } catch {
      /* ignore storage errors */
    }
  }
  return ENV_API_BASE_URL;
}

export function setApiBaseUrl(url: string): { ok: boolean; normalized: string; error?: string } {
  const trimmed = url.trim();
  if (!trimmed) {
    try {
      window.localStorage.removeItem(API_BASE_STORAGE_KEY);
      window.dispatchEvent(new CustomEvent(API_BASE_CHANGED_EVENT, { detail: { baseUrl: ENV_API_BASE_URL } }));
    } catch {
      /* ignore */
    }
    return { ok: true, normalized: ENV_API_BASE_URL };
  }
  const normalized = normalizeBaseUrl(trimmed);
  if (!normalized) {
    return {
      ok: false,
      normalized: '',
      error: 'Enter a valid http:// or https:// Express backend origin (e.g. https://api.zyntheor.ai or http://10.0.2.2:3000).',
    };
  }
  try {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
    window.dispatchEvent(new CustomEvent(API_BASE_CHANGED_EVENT, { detail: { baseUrl: normalized } }));
  } catch {
    /* ignore */
  }
  return { ok: true, normalized };
}

export function isNativeAndroidApp(): boolean {
  try {
    return Boolean(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android');
  } catch {
    return false;
  }
}

export function isNativeCapacitorApp(): boolean {
  try {
    return Boolean(Capacitor.isNativePlatform());
  } catch {
    return false;
  }
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function resolveWebSocketUrl(wsPath: string = '/ws/runtime'): string | null {
  if (typeof window === 'undefined') return null;
  const normalizedPath = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
  const apiBase = getApiBaseUrl();
  try {
    if (apiBase) {
      const parsed = new URL(apiBase, window.location.href);
      const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${parsed.host}${normalizedPath}`;
    }
  } catch {
    // Fallback to current window origin
  }
  if (!window.location?.host) return null;
  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProto}//${window.location.host}${normalizedPath}`;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init);
}

let fetchRewriteInstalled = false;

/**
 * Installs a transparent fetch wrapper so relative `/api/*` calls inside any module
 * resolve cleanly against `getApiBaseUrl()` when packaged in Capacitor Android or
 * connected to an external Express runtime host. Same-origin web mode is untouched.
 */
export function installApiBaseFetchRewrite(): void {
  if (fetchRewriteInstalled || typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return;
  }

  const nativeFetch = window.fetch.bind(window);
  const wrappedFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const base = getApiBaseUrl();
    if (base) {
      if (typeof input === 'string' && input.startsWith('/api/')) {
        return nativeFetch(`${base}${input}`, init);
      }
      if (input instanceof URL && input.pathname.startsWith('/api/') && input.origin === window.location.origin) {
        return nativeFetch(`${base}${input.pathname}${input.search}`, init);
      }
      if (typeof Request !== 'undefined' && input instanceof Request) {
        try {
          const parsed = new URL(input.url);
          if (parsed.pathname.startsWith('/api/') && parsed.origin === window.location.origin) {
            const rewrittenRequest = new Request(`${base}${parsed.pathname}${parsed.search}`, input);
            return nativeFetch(rewrittenRequest, init);
          }
        } catch {
          // Fall back to original request if URL parsing fails
        }
      }
    }
    return nativeFetch(input, init);
  }) as typeof window.fetch;

  try {
    const ownDesc = Object.getOwnPropertyDescriptor(window, 'fetch');
    const canRedefine = !ownDesc || ownDesc.configurable || ownDesc.writable === true;
    if (!canRedefine) {
      fetchRewriteInstalled = true;
      return;
    }
    if (ownDesc && !ownDesc.configurable && ownDesc.writable === true) {
      // Non-configurable but writable data property
      (window as unknown as { fetch: typeof window.fetch }).fetch = wrappedFetch;
    } else {
      Object.defineProperty(window, 'fetch', {
        value: wrappedFetch,
        configurable: true,
        writable: true,
        enumerable: ownDesc ? ownDesc.enumerable : true,
      });
    }
    fetchRewriteInstalled = true;
  } catch (err) {
    fetchRewriteInstalled = true;
    console.warn('[apiClient] Unable to install window.fetch API-base wrapper:', err);
  }
}
