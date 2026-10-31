import { describe, expect, it } from 'vitest';
import { timelineSteps } from './status';

const at = '2026-10-31T10:00:00.000Z';

describe('timelineSteps', () => {
  it('shows the full forward path with reached steps done and the latest current', () => {
    const steps = timelineSteps('SHIPPED', [
      { status: 'CONFIRMED', at, note: null },
      { status: 'PACKED', at, note: null },
      { status: 'SHIPPED', at, note: 'Left Bengaluru hub' },
    ]);
    expect(steps.map((s) => [s.key, s.state])).toEqual([
      ['CONFIRMED', 'done'],
      ['PACKED', 'done'],
      ['SHIPPED', 'current'],
      ['OUT_FOR_DELIVERY', 'upcoming'],
      ['DELIVERED', 'upcoming'],
    ]);
    expect(steps[2]!.detail).toContain('Left Bengaluru hub');
  });

  it('marks delivered as done, not in progress', () => {
    const all = ['CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
    const steps = timelineSteps(
      'DELIVERED',
      all.map((status) => ({ status, at, note: null })),
    );
    expect(steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('stops the path at a cancellation', () => {
    const steps = timelineSteps('CANCELLED', [
      { status: 'CONFIRMED', at, note: null },
      { status: 'CANCELLED', at, note: 'Ordered by mistake' },
    ]);
    expect(steps.map((s) => [s.key, s.state])).toEqual([
      ['CONFIRMED', 'done'],
      ['CANCELLED', 'stopped'],
    ]);
  });
});
