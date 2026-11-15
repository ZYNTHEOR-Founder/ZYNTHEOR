/**
 * ZYNTHEOR Cloud Frontend API Client
 * Uses `import.meta.env.VITE_API_URL` for cross-origin cloud backend deployments
 * (e.g. Cloud Run, Render, Railway) with zero hardcoded localhost origins.
 */

export const API_BASE_URL = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init);
}
