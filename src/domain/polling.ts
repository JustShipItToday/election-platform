import type { Candidate, Party, Poll } from '../data/schema';

export type PollMethod =
  | { kind: 'latest' }
  | { kind: 'latestN'; n: number }
  | { kind: 'window'; days: number }
  | { kind: 'all' };

export interface PollSettings {
  method: PollMethod;
  /** Leave out polls the source flags as internal/partisan. */
  excludeInternal: boolean;
  /** A lead smaller than or equal to this many points is treated as a tie. */
  tieBand: number;
}

export const DEFAULT_POLL_SETTINGS: PollSettings = {
  method: { kind: 'latestN', n: 3 },
  excludeInternal: false,
  tieBand: 0,
};

export function describeMethod(s: PollSettings): string {
  const m = s.method;
  const base =
    m.kind === 'latest'
      ? 'Latest poll only'
      : m.kind === 'latestN'
        ? `Average of the latest ${m.n} polls`
        : m.kind === 'window'
          ? `Average of polls ending in the last ${m.days} days`
          : 'Average of all available polls';
  const extras: string[] = [];
  if (s.excludeInternal) extras.push('internal/partisan polls excluded');
  if (s.tieBand > 0) extras.push(`leads of ${s.tieBand} pt or less count as ties`);
  return extras.length ? `${base} (${extras.join('; ')})` : base;
}

export interface PollSelection {
  included: Poll[];
  excluded: { poll: Poll; reason: string }[];
}

const DAY_MS = 86_400_000;

function endMs(p: Poll): number {
  const t = Date.parse(p.endDate + 'T12:00:00Z');
  return Number.isFinite(t) ? t : 0;
}

/** Newest first by field end date, then by release date, then id (stable). */
export function sortPolls(polls: readonly Poll[]): Poll[] {
  return [...polls].sort(
    (a, b) =>
      endMs(b) - endMs(a) ||
      b.releasedDate.localeCompare(a.releasedDate) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Decide which polls are used. Every poll is accounted for in either `included`
 * or `excluded` (with a reason), so the UI can show the methodology in full.
 */
export function selectPolls(polls: readonly Poll[], settings: PollSettings, nowMs: number): PollSelection {
  const excluded: { poll: Poll; reason: string }[] = [];
  let pool: Poll[] = [];
  for (const p of sortPolls(polls)) {
    if (settings.excludeInternal && (p.internal || p.partisan)) {
      excluded.push({ poll: p, reason: 'Flagged internal or partisan by the source' });
    } else {
      pool.push(p);
    }
  }
  const m = settings.method;
  let included: Poll[];
  if (m.kind === 'latest') {
    included = pool.slice(0, 1);
    for (const p of pool.slice(1)) excluded.push({ poll: p, reason: 'Older than the latest poll' });
  } else if (m.kind === 'latestN') {
    const n = Math.max(1, Math.floor(m.n));
    included = pool.slice(0, n);
    for (const p of pool.slice(n)) excluded.push({ poll: p, reason: `Not among the latest ${n}` });
  } else if (m.kind === 'window') {
    const cutoff = nowMs - m.days * DAY_MS;
    included = [];
    for (const p of pool) {
      if (endMs(p) >= cutoff) included.push(p);
      else excluded.push({ poll: p, reason: `Ended more than ${m.days} days ago` });
    }
  } else {
    included = pool;
  }
  pool = [];
  return { included, excluded };
}

export interface CandidateAverage {
  candidateId: string;
  /** Mean over the included polls in which this candidate appeared. */
  pct: number;
  pollsCounted: number;
}

export interface PollOutcome {
  status: 'leader' | 'tie' | 'no-polls' | 'insufficient';
  selection: PollSelection;
  averages: CandidateAverage[];
  leaderId: string | null;
  leaderParty: Party | null;
  margin: number | null;
}

/**
 * Deterministic polling arithmetic. Never invents a number: with no usable polls
 * the status is "no-polls", and with fewer than two named candidates "insufficient".
 */
export function evaluatePolls(
  polls: readonly Poll[],
  candidates: readonly Candidate[],
  settings: PollSettings,
  nowMs: number,
): PollOutcome {
  const selection = selectPolls(polls, settings, nowMs);
  if (selection.included.length === 0) {
    return { status: 'no-polls', selection, averages: [], leaderId: null, leaderParty: null, margin: null };
  }
  const sums = new Map<string, { sum: number; n: number }>();
  for (const p of selection.included) {
    for (const r of p.results) {
      const cur = sums.get(r.candidateId) ?? { sum: 0, n: 0 };
      cur.sum += r.pct;
      cur.n += 1;
      sums.set(r.candidateId, cur);
    }
  }
  const averages: CandidateAverage[] = [...sums.entries()]
    .map(([candidateId, v]) => ({ candidateId, pct: v.sum / v.n, pollsCounted: v.n }))
    .sort((a, b) => b.pct - a.pct || a.candidateId.localeCompare(b.candidateId));
  if (averages.length < 2) {
    return { status: 'insufficient', selection, averages, leaderId: null, leaderParty: null, margin: null };
  }
  const first = averages[0]!;
  const second = averages[1]!;
  const margin = round1(first.pct - second.pct);
  if (margin <= settings.tieBand) {
    return { status: 'tie', selection, averages, leaderId: null, leaderParty: null, margin };
  }
  const leader = candidates.find((c) => c.id === first.candidateId) ?? null;
  return {
    status: 'leader',
    selection,
    averages,
    leaderId: first.candidateId,
    leaderParty: leader ? leader.party : null,
    margin,
  };
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
