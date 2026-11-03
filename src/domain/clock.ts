/**
 * Authoritative time for a static site.
 * We never trust the visitor's clock on its own: we read the HTTP `Date` header
 * from our own host (GitHub Pages' CDN) and keep an offset from the local clock.
 * If that fails we fall back to the local clock and say so (`trusted === false`).
 */
export interface ClockState {
  offsetMs: number;
  trusted: boolean;
  syncedAt: number | null;
}

const state: ClockState = { offsetMs: 0, trusted: false, syncedAt: null };
let simulatedMs: number | null = null;

/** Rehearsal hook, only honored in dev builds (`?simulate=2026-11-04T10:00:00Z`). */
export function initSimulation(): void {
  if (!import.meta.env.DEV) return;
  const q = new URLSearchParams(location.search).get('simulate');
  if (!q) return;
  const t = Date.parse(q);
  if (Number.isFinite(t)) simulatedMs = t;
}

export function isSimulated(): boolean {
  return simulatedMs !== null;
}

export function now(): number {
  if (simulatedMs !== null) return simulatedMs;
  return Date.now() + state.offsetMs;
}

export function clockState(): Readonly<ClockState> {
  return state;
}

/** Pure helper so the offset math is testable. */
export function offsetFromDateHeader(header: string | null, requestStartMs: number, responseEndMs: number): number | null {
  if (!header) return null;
  const server = Date.parse(header);
  if (!Number.isFinite(server)) return null;
  // The Date header has 1 s resolution; assume the response was generated mid-flight.
  const localMid = (requestStartMs + responseEndMs) / 2;
  return server + 500 - localMid;
}

export async function syncClock(url = location.pathname): Promise<void> {
  if (simulatedMs !== null) return;
  try {
    const start = Date.now();
    const res = await fetch(`${url}?t=${start}`, { method: 'HEAD', cache: 'no-store' });
    const end = Date.now();
    const off = offsetFromDateHeader(res.headers.get('date'), start, end);
    if (off !== null) {
      state.offsetMs = off;
      state.trusted = true;
      state.syncedAt = end;
    }
  } catch {
    /* keep the previous offset; trusted stays as it was */
  }
}

export function startClockSync(everyMs = 5 * 60_000): void {
  void syncClock();
  setInterval(() => void syncClock(), everyMs);
}
