/** Shared DTOs. Replaced by an OpenAPI-generated client once the spec exists (M0.5). */

/** Global API error body: every non-2xx response uses this shape. */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type HealthStatus = 'ok' | 'degraded';

export interface HealthResponse {
  status: HealthStatus;
  /** ISO 8601 UTC. */
  time: string;
  checks: Record<string, 'up' | 'down'>;
}

/** Money is always integer paise. Never use floats for amounts. */
export type Paise = number;
