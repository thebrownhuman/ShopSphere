import type { ApiError } from '@shopsphere/types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'ss_seller_token';

export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
  /** Field → message map from `{field, message}[]` details (KYC/listing issues). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.body.details)) {
      for (const d of this.body.details as {
        field?: string;
        path?: string[];
        message?: string;
      }[]) {
        const key = d.field ?? d.path?.join('.');
        if (key && d.message && !out[key]) out[key] = d.message;
      }
    }
    return out;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: token lives for this page only */
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({
      code: 'HTTP_ERROR',
      message: `Request failed (${res.status})`,
    }))) as ApiError;
    if (res.status === 401) setToken(null);
    throw new ApiCallError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** "1,299.50" → 129950. Null when not a valid rupee amount. */
export function rupeesToPaise(v: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(v.trim().replace(/,/g, ''));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

export function paiseToRupees(p: number): string {
  return p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2);
}

export async function fileToBase64(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
