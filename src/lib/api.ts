const API_BASE = '/api/v1';

export class ApiError extends Error {
  public statusCode: number;
  public code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('creemy_token');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    // If token expired, attempt auto-refresh once
    if (response.status === 401 && !endpoint.includes('/auth/refresh') && !endpoint.includes('/auth/login')) {
      try {
        const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const refreshJson = await refreshRes.json();
        if (refreshJson.success && refreshJson.data?.accessToken) {
          localStorage.setItem('creemy_token', refreshJson.data.accessToken);
          headers['Authorization'] = `Bearer ${refreshJson.data.accessToken}`;
          const retryRes = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
          const retryJson = await retryRes.json();
          if (retryRes.ok) return retryJson.data ?? retryJson;
        }
      } catch {
        // Refresh failed, clear session
        localStorage.removeItem('creemy_token');
      }
    }

    throw new ApiError(json.error || 'حدث خطأ في معالجة الطلب', response.status, json.code);
  }

  return json.data !== undefined ? json.data : json;
}

export const api = {
  get: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: 'GET' }),
  post: <T>(endpoint: string, body?: unknown) =>
    apiRequest<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(endpoint: string, body?: unknown) =>
    apiRequest<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(endpoint: string) => apiRequest<T>(endpoint, { method: 'DELETE' }),
};
