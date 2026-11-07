// Thin fetch wrapper for the SalonOS Express API.
// - Access token lives in memory only; the refresh token is an httpOnly cookie set by the API.
// - On a 401 the client refreshes once and retries the request.
// - API errors ({ error: { code, message } }) are thrown as Error(message) so existing UI
//   error handling (err.message) keeps working unchanged.

const resolveApiBaseUrl = (): string => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.startsWith('http')) return envUrl;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'meerub.isywarecloud.com') {
      return 'https://api.meerub.isywarecloud.com/api/v1';
    }
  }
  return envUrl || '/api/v1';
};

export const API_BASE_URL: string = resolveApiBaseUrl();

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  body?: unknown;
  query?: Query;
  /** Money/stock writes: sends an Idempotency-Key so a retried request is never applied twice. */
  idempotencyKey?: string;
  /** Internal: prevents refresh loops. */
  skipRefresh?: boolean;
}

const TOKEN_STORAGE_KEY = 'salonos_access_token';

let accessToken: string | null = (() => {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
})();
let refreshInFlight: Promise<boolean> | null = null;
let onSessionExpired: (() => void) | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
};

export const getAccessToken = () => accessToken;

/** Called when the refresh token is no longer valid (user must log in again). */
export const setSessionExpiredHandler = (handler: (() => void) | null) => {
  onSessionExpired = handler;
};

export const newIdempotencyKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const buildUrl = (path: string, query?: Query) => {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `${API_BASE_URL}${path}${qs ? `?${qs}` : ''}`;
};

/** Exchanges the refresh cookie for a new access token. Returns the raw session payload or null. */
export const refreshSession = async (): Promise<any | null> => {
  const res = await fetch(`${API_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!res.ok) return null;
  const json = await res.json();
  setAccessToken(json.data?.token ?? null);
  return json.data ?? null;
};

const tryRefresh = async (): Promise<boolean> => {
  if (!refreshInFlight) {
    refreshInFlight = refreshSession()
      .then((s) => !!s)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
};

export async function apiRequest<T = any>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (API_BASE_URL.includes('ngrok')) headers['ngrok-skip-browser-warning'] = 'true';
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the SalonOS server. Please check your connection and that the API is running.');
  }

  if (res.status === 401 && !opts.skipRefresh && !path.startsWith('/auth/')) {
    if (await tryRefresh()) return apiRequest<T>(method, path, { ...opts, skipRefresh: true });
    setAccessToken(null);
    onSessionExpired?.();
  }

  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error;
    throw new ApiError(res.status, err?.code || 'HTTP_ERROR', err?.message || `Request failed (${res.status})`, err?.details);
  }
  if (res.status !== 204 && json === null) {
    throw new ApiError(res.status, 'INVALID_RESPONSE', 'Invalid JSON response from server. Please verify your API URL.');
  }
  return (json?.data ?? json) as T;
}

export const api = {
  get:    <T = any>(path: string, query?: Query) => apiRequest<T>('GET', path, { query }),
  post:   <T = any>(path: string, body?: unknown, idempotencyKey?: string) => apiRequest<T>('POST', path, { body: body ?? {}, idempotencyKey }),
  put:    <T = any>(path: string, body?: unknown) => apiRequest<T>('PUT', path, { body: body ?? {} }),
  patch:  <T = any>(path: string, body?: unknown) => apiRequest<T>('PATCH', path, { body: body ?? {} }),
  delete: <T = any>(path: string) => apiRequest<T>('DELETE', path),
};

/** GET that resolves to null on 404 (for `getX(id): Promise<X | null>` contract methods). */
export async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    return await api.get<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
