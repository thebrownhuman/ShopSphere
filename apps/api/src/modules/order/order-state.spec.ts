import {
  canTransition,
  CANCELLABLE,
  ORDER_STATUSES,
  payableStatus,
  TRANSITIONS,
} from './order-state';

describe('order state machine (M4.27)', () => {
  it('allows the happy path and the PRD branches', () => {
    const path = [
      'PENDING_PAYMENT',
      'CONFIRMED',
      'PACKED',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'RETURN_REQUESTED',
      'PICKED_UP',
      'REFUNDED',
    ] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1], path[i])).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'PAYMENT_FAILED')).toBe(true);
    expect(canTransition('PAYMENT_FAILED', 'CONFIRMED')).toBe(true);
    expect(canTransition('PAYMENT_FAILED', 'CANCELLED_NO_STOCK')).toBe(true);
  });

  it('refuses skipping, going back and leaving terminal states', () => {
    expect(canTransition('PENDING_PAYMENT', 'SHIPPED')).toBe(false);
    expect(canTransition('SHIPPED', 'CANCELLED')).toBe(false);
    expect(canTransition('CONFIRMED', 'PENDING_PAYMENT')).toBe(false);
    for (const t of ['CANCELLED', 'CANCELLED_NO_STOCK', 'REFUNDED'] as const) {
      for (const to of ORDER_STATUSES) expect(canTransition(t, to)).toBe(false);
    }
  });

  it('cancel is allowed only before SHIPPED, and only where the machine allows it', () => {
    expect(CANCELLABLE).toEqual(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED']);
    for (const s of CANCELLABLE) expect(TRANSITIONS[s]).toContain('CANCELLED');
  });

  it('maps to what payments understands', () => {
    expect(payableStatus('CANCELLED_NO_STOCK')).toBe('CANCELLED');
    expect(payableStatus('PAYMENT_FAILED')).toBe('PAYMENT_FAILED');
    expect(payableStatus('SHIPPED')).toBe('CONFIRMED');
  });
});
