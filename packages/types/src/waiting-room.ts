/**
 * Sale-day waiting room (M7.5). Routes: GET /waiting-room/status (signed in, polled by /queue),
 * POST /waiting-room/internal/flag {state: on|off|env} (x-internal-token).
 * POST /checkout answers 429 WAITING_ROOM (Retry-After header) (details: {position, retryAfterSeconds}) while queued.
 */
export interface WaitingRoomStatus {
  enabled: boolean;
  admitted: boolean;
  /** Shoppers ahead of you; 0 once admitted. */
  position: number;
  retryAfterSeconds: number;
}
