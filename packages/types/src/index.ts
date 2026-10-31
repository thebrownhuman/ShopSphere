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

// ───────── Identity (M1) ─────────

export interface AuthUser {
  id: string;
  name: string | null;
  /** Normalised lowercased email, or null. */
  email: string | null;
  /** E.164, e.g. +919876543210, or null. */
  phone: string | null;
  hasPassword: boolean;
  totpEnabled: boolean;
  googleLinked: boolean;
}

/** Every sign-in step answers with one of these. */
export type AuthResponse =
  | { status: 'authenticated'; accessToken: string; expiresIn: number; user: AuthUser }
  | { status: 'signup_required'; signupToken: string }
  | { status: 'mfa_required'; mfaToken: string };

export interface IdentifyResponse {
  type: 'email' | 'phone';
  exists: boolean;
  hasPassword: boolean;
}

export interface OtpRequestResponse {
  resendAfterSeconds: number;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  persistent: boolean;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export type AddressType = 'home' | 'work' | 'other';

export interface Address {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  type: AddressType;
  isDefault: boolean;
}

export type AddressInput = Omit<Address, 'id' | 'isDefault'> & { isDefault?: boolean };

export interface PincodeInfo {
  pincode: string;
  city: string;
  state: string;
  serviceable: boolean;
}

// ───────── Catalog, search, home (M2) ─────────

export * from './catalog';

// ───────── Cart and wishlist (M3) ─────────

export * from './cart';

// ───────── Checkout and orders (M4) ─────────

export * from './checkout';
export * from './order';
