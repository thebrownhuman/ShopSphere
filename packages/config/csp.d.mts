export interface CspOptions {
  /** Per-request nonce: enables nonce + 'strict-dynamic' (no 'unsafe-inline' scripts). */
  nonce?: string;
  dev?: boolean;
  /** API base URL; its origin is allowed in connect-src. */
  apiUrl?: string;
  scriptSrc?: string[];
  connectSrc?: string[];
  imgSrc?: string[];
  frameSrc?: string[];
  formAction?: string[];
}
export function createNonce(): string;
export function buildCsp(o: CspOptions): string;
export const BASE_SECURITY_HEADERS: Readonly<Record<string, string>>;
