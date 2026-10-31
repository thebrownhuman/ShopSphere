import type { ApiError } from '@shopsphere/types';

/** Thin fetch client. Replaced by the OpenAPI-generated client in a later milestone. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.message ?? `Request failed (${status})`);
  }

  get code(): string | undefined {
    return this.body?.code;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(res.status, body);
  }
  return (await res.json()) as T;
}

export function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string | null;
}

/**
 * Credentialed request: sends cookies, the double-submit CSRF header, and the bearer token.
 * Throws ApiRequestError with the backend's `{code, message, details}`.
 */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const csrf = readCookie('ss_csrf');
  if (csrf) headers['x-csrf-token'] = csrf;
  if (opts.accessToken) headers.authorization = `Bearer ${opts.accessToken}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'include',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
