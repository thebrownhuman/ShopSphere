/**
 * Privacy / DPDP Act 2023 contract (M7.3). All routes need a signed-in shopper.
 *
 *   GET    /me/privacy          → PrivacyOverview (latest export + pending deletion)
 *   POST   /me/export           → 202 PrivacyExport (async job; emailed when READY)
 *   GET    /me/export           → PrivacyExport | 404 NO_EXPORT (READY carries a short-lived downloadUrl)
 *   POST   /me/delete-account   → 202 PrivacyDeletion (needs re-auth in the last 10 min: 403 REAUTH_REQUIRED)
 *   DELETE /me/delete-account   → 204 (cancels during the grace period)
 *   POST   /privacy/internal/sweep (x-internal-token) → runs pending exports and due deletions
 *
 * Errors: EXPORT_IN_PROGRESS (409), EXPORT_RATE_LIMITED (429, one per 24 h),
 * DELETION_PENDING (409), OPEN_ORDERS (409), SELLER_ACCOUNT (409).
 */
export type PrivacyExportStatus = 'PENDING' | 'READY' | 'FAILED' | 'EXPIRED';

export interface PrivacyExport {
  id: string;
  status: PrivacyExportStatus;
  requestedAt: string;
  completedAt: string | null;
  /** Download link valid until expiresAt. */
  expiresAt: string | null;
  downloadUrl: string | null;
}

export interface PrivacyDeletion {
  id: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  requestedAt: string;
  /** End of the grace period; the account is anonymised then. */
  scheduledFor: string;
}

export interface PrivacyOverview {
  export: PrivacyExport | null;
  deletion: PrivacyDeletion | null;
  graceDays: number;
}

/** Files inside the export archive. */
export const PRIVACY_EXPORT_FILES = [
  'README.txt',
  'profile.json',
  'addresses.json',
  'orders.json',
  'returns.json',
  'reviews.json',
  'questions_answers.json',
  'support_tickets.json',
  'wishlist_cart.json',
  'sessions.json',
  'store_balance.json',
] as const;
