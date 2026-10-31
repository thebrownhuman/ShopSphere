import { nextDailyRun } from './fulfilment.jobs';

describe('nextDailyRun', () => {
  it('schedules the next IST wall-clock hour', () => {
    // 2026-10-31 01:00 IST = 2026-10-30T19:30Z → 02:00 IST same day = 20:30Z.
    expect(nextDailyRun(new Date('2026-10-30T19:30:00Z'), 2).toISOString()).toBe(
      '2026-10-30T20:30:00.000Z',
    );
    // Exactly at 02:00 IST → tomorrow.
    expect(nextDailyRun(new Date('2026-10-30T20:30:00Z'), 2).toISOString()).toBe(
      '2026-10-31T20:30:00.000Z',
    );
    // 23:00 IST → 06:00 IST next day.
    expect(nextDailyRun(new Date('2026-10-31T17:30:00Z'), 6).toISOString()).toBe(
      '2026-11-01T00:30:00.000Z',
    );
  });
});
