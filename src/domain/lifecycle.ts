/**
 * Single source of truth for the product lifecycle.
 * Closes: 2026-11-04 1:57 AM PST (= 4:57 AM EST = 09:57 UTC).
 * Results: 2026-11-04 9:00 AM EST (= 14:00 UTC).
 */
export const FORECAST_CLOSES_AT_MS = Date.UTC(2026, 10, 4, 9, 57, 0);
export const RESULTS_VISIBLE_AT_MS = Date.UTC(2026, 10, 4, 14, 0, 0);
export const ELECTION_DATE_LABEL = 'November 3, 2026';

export type Phase = 'open' | 'closed' | 'results';

export function phaseAt(nowMs: number): Phase {
  if (nowMs < FORECAST_CLOSES_AT_MS) return 'open';
  if (nowMs < RESULTS_VISIBLE_AT_MS) return 'closed';
  return 'results';
}

export function canWrite(nowMs: number): boolean {
  return phaseAt(nowMs) === 'open';
}

/** Human countdown such as "3h 12m" or "42s". Returns null once the target has passed. */
export function countdown(targetMs: number, nowMs: number): string | null {
  const diff = targetMs - nowMs;
  if (diff <= 0) return null;
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Format an instant in an explicit IANA zone (or the viewer's zone when omitted). */
export function formatInstant(ms: number, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  };
  if (timeZone) opts.timeZone = timeZone;
  return new Intl.DateTimeFormat('en-US', opts).format(new Date(ms));
}
