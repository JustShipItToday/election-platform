import { describe, expect, it } from 'vitest';
import {
  FORECAST_CLOSES_AT_MS,
  RESULTS_VISIBLE_AT_MS,
  canWrite,
  countdown,
  phaseAt,
} from '../src/domain/lifecycle';
import { DEFAULT_POLL_SETTINGS, evaluatePolls, selectPolls, type PollSettings } from '../src/domain/polling';
import { RESURFACE_AFTER, createQueue, current, decide, defer, deferredIds, revisit } from '../src/domain/deferral';
import { computeMakeup, type Pick } from '../src/domain/makeup';
import { resolveScope } from '../src/domain/scope';
import type { Candidate, Dataset, Poll, Race } from '../src/data/schema';

// ---- Test fixtures. These are synthetic and exist only inside tests. ----
const cands: Candidate[] = [
  { id: 'a', name: 'Alex Fixture', party: 'D', partyLabel: 'Democratic', wikipediaTitle: null },
  { id: 'b', name: 'Blair Fixture', party: 'R', partyLabel: 'Republican', wikipediaTitle: null },
];
function poll(id: string, end: string, a: number, b: number, extra: Partial<Poll> = {}): Poll {
  return {
    id,
    raceId: 'senate-ZZ',
    pollster: 'Fixture Polling',
    startDate: end,
    endDate: end,
    releasedDate: end,
    sampleSize: 800,
    population: 'lv',
    url: 'https://example.test/' + id,
    internal: false,
    partisan: null,
    sponsors: [],
    results: [
      { candidateId: 'a', pct: a },
      { candidateId: 'b', pct: b },
    ],
    answers: [],
    ...extra,
  };
}
const NOW = Date.parse('2026-11-03T12:00:00Z');

describe('lifecycle', () => {
  it('uses the exact instants from the product spec', () => {
    expect(new Date(FORECAST_CLOSES_AT_MS).toISOString()).toBe('2026-11-04T09:57:00.000Z');
    expect(new Date(RESULTS_VISIBLE_AT_MS).toISOString()).toBe('2026-11-04T14:00:00.000Z');
  });
  it('1:57 AM Pacific and 4:57 AM Eastern are the same instant', () => {
    const fmt = (tz: string) =>
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(FORECAST_CLOSES_AT_MS);
    expect(fmt('America/Los_Angeles')).toBe('1:57 AM');
    expect(fmt('America/New_York')).toBe('4:57 AM');
  });
  it('results begin at 9:00 AM Eastern', () => {
    const t = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }).format(RESULTS_VISIBLE_AT_MS);
    expect(t).toBe('9:00 AM');
  });
  it('moves through open, closed, results at the boundaries', () => {
    expect(phaseAt(FORECAST_CLOSES_AT_MS - 1)).toBe('open');
    expect(phaseAt(FORECAST_CLOSES_AT_MS)).toBe('closed');
    expect(phaseAt(RESULTS_VISIBLE_AT_MS - 1)).toBe('closed');
    expect(phaseAt(RESULTS_VISIBLE_AT_MS)).toBe('results');
    expect(canWrite(FORECAST_CLOSES_AT_MS - 1)).toBe(true);
    expect(canWrite(FORECAST_CLOSES_AT_MS)).toBe(false);
  });
  it('formats countdowns', () => {
    expect(countdown(1000, 2000)).toBeNull();
    expect(countdown(3_723_000, 0)).toBe('1h 2m');
    expect(countdown(42_000, 0)).toBe('42s');
  });
});

describe('polling methods', () => {
  const polls = [
    poll('p1', '2026-10-01', 40, 50),
    poll('p2', '2026-10-20', 48, 44),
    poll('p3', '2026-10-28', 47, 45),
    poll('p4', '2026-09-01', 30, 60, { internal: true }),
  ];
  const mk = (method: PollSettings['method'], more: Partial<PollSettings> = {}): PollSettings => ({
    ...DEFAULT_POLL_SETTINGS,
    method,
    ...more,
  });
  it('latest uses only the newest poll and accounts for the rest', () => {
    const sel = selectPolls(polls, mk({ kind: 'latest' }), NOW);
    expect(sel.included.map((p) => p.id)).toEqual(['p3']);
    expect(sel.excluded).toHaveLength(3);
  });
  it('latest N averages exactly N polls', () => {
    const out = evaluatePolls(polls, cands, mk({ kind: 'latestN', n: 3 }), NOW);
    expect(out.selection.included.map((p) => p.id)).toEqual(['p3', 'p2', 'p1']);
    const a = out.averages.find((x) => x.candidateId === 'a')!;
    expect(a.pct).toBeCloseTo((47 + 48 + 40) / 3, 6);
  });
  it('window keeps only polls that ended inside the window', () => {
    const sel = selectPolls(polls, mk({ kind: 'window', days: 14 }), NOW);
    expect(sel.included.map((p) => p.id)).toEqual(['p3', 'p2']);
  });
  it('can exclude internal polls', () => {
    const sel = selectPolls(polls, mk({ kind: 'all' }, { excludeInternal: true }), NOW);
    expect(sel.included.map((p) => p.id)).not.toContain('p4');
    expect(sel.excluded.find((e) => e.poll.id === 'p4')?.reason).toMatch(/internal/i);
  });
  it('reports no-polls instead of inventing a number', () => {
    const out = evaluatePolls([], cands, DEFAULT_POLL_SETTINGS, NOW);
    expect(out.status).toBe('no-polls');
    expect(out.averages).toEqual([]);
    expect(out.margin).toBeNull();
  });
  it('reports a tie when the lead is within the tie band', () => {
    const tied = [poll('t1', '2026-10-28', 46, 46)];
    expect(evaluatePolls(tied, cands, DEFAULT_POLL_SETTINGS, NOW).status).toBe('tie');
    const close = [poll('t2', '2026-10-28', 47, 46)];
    expect(evaluatePolls(close, cands, DEFAULT_POLL_SETTINGS, NOW).status).toBe('leader');
    expect(evaluatePolls(close, cands, { ...DEFAULT_POLL_SETTINGS, tieBand: 1 }, NOW).status).toBe('tie');
  });
  it('picks the leading party', () => {
    const out = evaluatePolls([poll('x', '2026-10-28', 40, 52)], cands, DEFAULT_POLL_SETTINGS, NOW);
    expect(out.leaderParty).toBe('R');
    expect(out.margin).toBe(12);
  });
  it('is deterministic regardless of input order', () => {
    const a = evaluatePolls(polls, cands, DEFAULT_POLL_SETTINGS, NOW);
    const b = evaluatePolls([...polls].reverse(), cands, DEFAULT_POLL_SETTINGS, NOW);
    expect(b.averages).toEqual(a.averages);
  });
});

describe('deferral queue', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `r${i}`);
  it('presents items in order', () => {
    const q = createQueue(ids);
    expect(current(q)).toBe('r0');
  });
  it('brings a deferred item back after 20 other items', () => {
    let q = createQueue(ids);
    q = defer(q, 'r0');
    const seen: string[] = [];
    for (let i = 0; i < RESURFACE_AFTER; i++) {
      const id = current(q)!;
      seen.push(id);
      q = decide(q, id);
    }
    expect(seen).not.toContain('r0');
    expect(current(q)).toBe('r0');
  });
  it('does not resurface early', () => {
    let q = createQueue(ids);
    q = defer(q, 'r0');
    for (let i = 0; i < RESURFACE_AFTER - 1; i++) q = decide(q, current(q)!);
    expect(current(q)).not.toBe('r0');
  });
  it('circles back sooner when few items remain', () => {
    let q = createQueue(['a', 'b', 'c']);
    q = defer(q, 'a');
    q = decide(q, 'b');
    q = decide(q, 'c');
    expect(current(q)).toBe('a');
  });
  it('lists deferred items and lets the user revisit one on purpose', () => {
    let q = createQueue(ids);
    q = defer(q, 'r0');
    q = defer(q, 'r1');
    expect(deferredIds(q)).toEqual(['r0', 'r1']);
    q = revisit(q, 'r1');
    expect(current(q)).toBe('r1');
  });
  it('returns null once everything is decided', () => {
    let q = createQueue(['a']);
    q = decide(q, 'a');
    expect(current(q)).toBeNull();
  });
  it('skips items already done when building the queue', () => {
    const q = createQueue(['a', 'b'], ['a']);
    expect(current(q)).toBe('b');
  });
});

const race = (id: string, chamber: 'senate' | 'governor', state: string): Race => ({
  id,
  chamber,
  state,
  stateName: state,
  label: `${state} ${chamber}`,
  special: false,
  seatPartyBefore: 'R',
  incumbentName: null,
  candidates: cands,
  candidatesStatus: 'nominees',
  reported: { afterParty: null, afterName: null, results: [], retrievedAt: '2026-11-03T00:00:00Z' },
  source: { name: 'fixture', url: 'https://example.test', retrievedAt: '2026-11-03T00:00:00Z' },
});
const src = { name: 'fixture', url: 'https://example.test', retrievedAt: '2026-11-03T00:00:00Z' };
const data: Dataset = {
  meta: {
    generatedAt: '2026-11-03T00:00:00Z',
    election: { date: '2026-11-03', forecastClosesAt: '', resultsVisibleAt: '' },
    holdovers: {
      senate: { D: 40, R: 20, O: 2, note: '', source: src },
      governor: { D: 6, R: 8, O: 0, note: '', source: src },
    },
    sources: [],
    counts: { races: 3, polls: 0, racesWithNominees: 3 },
    warnings: [],
  },
  races: [race('senate-AA', 'senate', 'AA'), race('senate-BB', 'senate', 'BB'), race('governor-AA', 'governor', 'AA')],
  polls: [],
};

describe('makeup aggregation', () => {
  const pick = (raceId: string, party: 'D' | 'R' | 'O'): Pick => ({
    raceId,
    candidateId: party === 'D' ? 'a' : party === 'R' ? 'b' : null,
    party,
    origin: 'user',
    madeAt: '2026-11-03T00:00:00Z',
  });
  it('adds called seats to holdovers and leaves uncalled seats unassigned', () => {
    const scope = new Set(['senate-AA', 'senate-BB']);
    const picks = new Map([['senate-AA', pick('senate-AA', 'D')]]);
    const m = computeMakeup('senate', data, scope, picks);
    expect(m.called).toEqual({ D: 1, R: 0, O: 0 });
    expect(m.uncalled).toBe(1);
    expect(m.total).toEqual({ D: 41, R: 20, O: 2 });
    expect(m.complete).toBe(false);
  });
  it('ignores races outside the scope', () => {
    const picks = new Map([['senate-BB', pick('senate-BB', 'R')]]);
    const m = computeMakeup('senate', data, new Set(['senate-AA']), picks);
    expect(m.called.R).toBe(0);
    expect(m.inScope).toBe(1);
  });
  it('marks complete only when every race in the chamber is in scope and called', () => {
    const scope = new Set(['senate-AA', 'senate-BB']);
    const picks = new Map([
      ['senate-AA', pick('senate-AA', 'D')],
      ['senate-BB', pick('senate-BB', 'R')],
    ]);
    expect(computeMakeup('senate', data, scope, picks).complete).toBe(true);
  });
  it('keeps chambers separate', () => {
    const picks = new Map([['governor-AA', pick('governor-AA', 'R')]]);
    expect(computeMakeup('senate', data, new Set(['senate-AA']), picks).called.R).toBe(0);
    expect(computeMakeup('governor', data, new Set(['governor-AA']), picks).total).toEqual({ D: 6, R: 9, O: 0 });
  });
});

describe('scope', () => {
  it('empty include means everything', () => {
    expect(resolveScope({ include: [], exclude: [] }, data, DEFAULT_POLL_SETTINGS, NOW)).toHaveLength(3);
  });
  it('combines chambers and states with union semantics', () => {
    const s = { include: [{ chambers: ['senate' as const] }, { states: ['AA'], chambers: ['governor' as const] }], exclude: [] };
    expect(resolveScope(s, data, DEFAULT_POLL_SETTINGS, NOW).map((r) => r.id).sort()).toEqual(['governor-AA', 'senate-AA', 'senate-BB']);
  });
  it('removes excluded races', () => {
    const s = { include: [], exclude: [{ states: ['BB'] }] };
    expect(resolveScope(s, data, DEFAULT_POLL_SETTINGS, NOW).map((r) => r.id)).not.toContain('senate-BB');
  });
  it('hasPolling uses the active polling settings', () => {
    const withPoll: Dataset = { ...data, polls: [poll('z', '2026-10-30', 45, 44, { raceId: 'senate-AA' })] };
    const s = { include: [{ hasPolling: true }], exclude: [] };
    expect(resolveScope(s, withPoll, DEFAULT_POLL_SETTINGS, NOW).map((r) => r.id)).toEqual(['senate-AA']);
    const close = { include: [{ closeWithin: 0.5 }], exclude: [] };
    expect(resolveScope(close, withPoll, DEFAULT_POLL_SETTINGS, NOW)).toHaveLength(0);
  });
});
