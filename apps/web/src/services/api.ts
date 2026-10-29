import { env } from '@/config/env';

export interface ApiErrorDetail {
  field: string;
  message: string;
}

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: ApiErrorDetail[];
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: ApiErrorDetail[];

  constructor(status: number, payload?: ErrorPayload) {
    super(status === 404 && payload?.error?.code === 'NOT_FOUND'
      ? '当前服务未提供此接口，请核对请求路径和 API 是否已发布。'
      : payload?.error?.message ?? '请求失败，请稍后重试');
    this.name = 'ApiError';
    this.code = payload?.error?.code ?? 'REQUEST_FAILED';
    this.status = status;
    this.details = payload?.error?.details ?? [];
  }
}

const authPathsWithoutRefresh = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
]);

let refreshInFlight: Promise<boolean> | null = null;

function apiUrl(path: string) {
  const base = env.apiBaseUrl.replace(/\/$/, '');
  return `${base}${path}`;
}

async function parseError(response: Response): Promise<ApiError> {
  let payload: ErrorPayload | undefined;
  try {
    payload = (await response.json()) as ErrorPayload;
  } catch {
    payload = undefined;
  }
  return new ApiError(response.status, payload);
}

async function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        let response = await fetch(apiUrl('/api/v1/auth/refresh'), {
          method: 'POST',
          credentials: 'include',
        });

        // Concurrent clients may hit the backend's brief token-rotation grace window.
        if (response.status === 409) {
          await new Promise((resolve) => window.setTimeout(resolve, 180));
          response = await fetch(apiUrl('/api/v1/auth/refresh'), {
            method: 'POST',
            credentials: 'include',
          });
        }
        return response.ok;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  canRefresh = true,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, {
      error: { code: 'NETWORK_ERROR', message: '网络连接失败，请检查网络后重试' },
    });
  }

  if (
    response.status === 401 &&
    canRefresh &&
    !authPathsWithoutRefresh.has(path) &&
    (await refreshSession())
  ) {
    return apiRequest<T>(path, init, false);
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
