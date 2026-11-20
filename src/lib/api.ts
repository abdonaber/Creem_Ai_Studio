import { IPaginationMeta } from '../types';

const API_BASE = '/api/v1';

// Security: Access token lives strictly in JS memory (never localStorage)
let memoryAccessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  memoryAccessToken = token;
}

export function getAccessToken(): string | null {
  return memoryAccessToken;
}

export function clearAccessToken(): void {
  memoryAccessToken = null;
}

export class ApiError extends Error {
  public statusCode: number;
  public code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'include',
      });
      if (!refreshRes.ok) {
        clearAccessToken();
        return null;
      }
      const refreshJson = await refreshRes.json().catch(() => ({}));
      const newToken = refreshJson?.data?.accessToken;
      if (refreshJson.success && newToken) {
        setAccessToken(newToken);
        return newToken as string;
      }
      clearAccessToken();
      return null;
    } catch {
      clearAccessToken();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function rawRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(options.headers as Record<string, string>),
  };

  if (memoryAccessToken) {
    headers['Authorization'] = `Bearer ${memoryAccessToken}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    // Attempt single-flight refresh once on 401
    if (
      response.status === 401 &&
      !endpoint.includes('/auth/refresh') &&
      !endpoint.includes('/auth/login') &&
      !endpoint.includes('/auth/register')
    ) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        const retryRes = await fetch(`${API_BASE}${endpoint}`, {
          ...options,
          headers,
          credentials: 'include',
        });
        const retryJson = await retryRes.json().catch(() => ({}));
        if (retryRes.ok) {
          return retryJson;
        }
        throw new ApiError(
          retryJson.error || 'حدث خطأ في معالجة الطلب',
          retryRes.status,
          retryJson.code
        );
      }
    }

    throw new ApiError(
      json.error || 'حدث خطأ في معالجة الطلب',
      response.status,
      json.code
    );
  }

  return json;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const json = await rawRequest(endpoint, options);
  return json.data !== undefined ? json.data : json;
}

export async function apiRequestPaginated<T>(
  endpoint: string
): Promise<{ data: T[]; pagination: IPaginationMeta }> {
  const json = await rawRequest(endpoint, { method: 'GET' });
  return {
    data: (json.data || []) as T[],
    pagination: json.pagination || { total: 0, page: 1, totalPages: 1, limit: 20 },
  };
}

export const api = {
  get: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: 'GET' }),
  getPaginated: <T>(endpoint: string) => apiRequestPaginated<T>(endpoint),
  post: <T>(endpoint: string, body?: unknown) =>
    apiRequest<T>(endpoint, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T>(endpoint: string, body?: unknown) =>
    apiRequest<T>(endpoint, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: 'DELETE' }),
};
