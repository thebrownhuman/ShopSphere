/** Display helpers for delivery promises. */

const dayFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
});
const shortFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** "Thursday, 29 Oct" from YYYY-MM-DD (parsed as a local date, not UTC). */
export function formatDeliveryDate(isoDate: string, short = false): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return (short ? shortFmt : dayFmt).format(new Date(y!, m! - 1, d!));
}

/** Tile copy from a day offset: "Tomorrow", or "Tue, 3 Nov". */
export function deliveryLabel(days: number, now = new Date()): string {
  if (days <= 1) return 'Tomorrow';
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return shortFmt.format(d);
}

/** "3 hrs 12 mins" until `to`; null once passed. */
export function countdown(to: Date, now = new Date()): string | null {
  const ms = to.getTime() - now.getTime();
  if (ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h
    ? `${h} hr${h === 1 ? '' : 's'} ${m} min${m === 1 ? '' : 's'}`
    : `${m} min${m === 1 ? '' : 's'}`;
}

/** "05:12:09" clock for deal timers. */
export function clock(to: Date, now = new Date()): string {
  const s = Math.max(0, Math.floor((to.getTime() - now.getTime()) / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}
