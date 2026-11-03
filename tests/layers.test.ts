import { describe, expect, it } from 'vitest';
import { judgeCall } from '../src/domain/evidence';
import { offsetFromDateHeader } from '../src/domain/clock';
import { LIMITS, createMemoryStore, saveMap, type SavedMap } from '../src/storage';
import { FORECAST_CLOSES_AT_MS } from '../src/domain/lifecycle';
import { DEFAULT_POLL_SETTINGS } from '../src/domain/polling';
import { parseInfobox, matchName, normalizeParty, linkTarget } from '../pipeline/infobox';
import type { CallRecord, Race } from '../src/data/schema';

const race: Race = {
  id: 'senate-ZZ', chamber: 'senate', state: 'ZZ', stateName: 'Zed', label: 'Zed Senate', special: false,
  seatPartyBefore: 'R', incumbentName: null,
  candidates: [
    { id: 'senate-ZZ:a', name: 'A', party: 'D', partyLabel: 'Democratic', wikipediaTitle: null },
    { id: 'senate-ZZ:b', name: 'B', party: 'R', partyLabel: 'Republican', wikipediaTitle: null },
  ],
  candidatesStatus: 'nominees',
  reported: { afterParty: null, afterName: null, results: [], retrievedAt: 'x' },
  source: { name: 'fixture', url: 'https://example.test', retrievedAt: 'x' },
};
const ev = (kind: 'official' | 'news' | 'other', publisher: string) => ({ kind, publisher, url: 'https://example.test/' + publisher, retrievedAt: 'x' });
const call = (evidence: CallRecord['evidence'], winner = 'senate-ZZ:a'): CallRecord => ({ raceId: race.id, winnerCandidateId: winner, calledAt: 'x', evidence });

describe('evidence gate for calling a race', () => {
  it('no call means not called', () => expect(judgeCall(undefined, race).called).toBe(false));
  it('one news source is not enough', () => expect(judgeCall(call([ev('news', 'Outlet One')]), race).called).toBe(false));
  it('two stories from the same publisher are not independent', () =>
    expect(judgeCall(call([ev('news', 'Outlet One'), ev('news', 'outlet one')]), race).called).toBe(false));
  it('two different publishers are enough', () =>
    expect(judgeCall(call([ev('news', 'Outlet One'), ev('news', 'Outlet Two')]), race).called).toBe(true));
  it('one official source is enough', () => expect(judgeCall(call([ev('official', 'State Elections Office')]), race).called).toBe(true));
  it('"other" evidence never counts', () => expect(judgeCall(call([ev('other', 'a'), ev('other', 'b'), ev('other', 'c')]), race).called).toBe(false));
  it('rejects a winner who is not in the race', () =>
    expect(judgeCall(call([ev('official', 'X')], 'someone-else'), race).called).toBe(false));
});

describe('clock', () => {
  it('derives an offset from the Date header', () => {
    const server = 'Tue, 03 Nov 2026 12:00:00 GMT';
    const t = Date.parse(server);
    const off = offsetFromDateHeader(server, t - 2000, t - 1000)!; // local clock 2s behind server
    expect(Math.round(off / 1000)).toBe(2);
  });
  it('returns null for a missing or invalid header', () => {
    expect(offsetFromDateHeader(null, 0, 1)).toBeNull();
    expect(offsetFromDateHeader('nonsense', 0, 1)).toBeNull();
  });
});

function map(kind: 'prediction' | 'forecast', id: string): SavedMap {
  const z = { D: 0, R: 0, O: 0 };
  const agg = { holdover: z, called: z, total: z, uncalled: 0 };
  return {
    id, kind, name: id, notes: '', createdAt: 'x', dataAsOf: 'x', scopeText: '', scope: { include: [], exclude: [] },
    pollSettings: DEFAULT_POLL_SETTINGS, methodText: '', picks: [], seats: [], aggregate: { senate: agg, governor: agg },
  };
}
describe('saved map limits and lifecycle gate', () => {
  const open = FORECAST_CLOSES_AT_MS - 60_000;
  it('limits are the product values', () => expect(LIMITS).toEqual({ prediction: 1500, forecast: 70 }));
  it('refuses the 71st forecast map but still allows prediction maps', async () => {
    const s = createMemoryStore();
    for (let i = 0; i < LIMITS.forecast; i++) expect((await saveMap(s, map('forecast', 'f' + i), open)).ok).toBe(true);
    const r = await saveMap(s, map('forecast', 'extra'), open);
    expect(r.ok).toBe(false);
    expect((await saveMap(s, map('prediction', 'p1'), open)).ok).toBe(true);
  });
  it('refuses the 1,501st prediction map', async () => {
    const s = createMemoryStore();
    for (let i = 0; i < LIMITS.prediction; i++) await s.put(map('prediction', 'p' + i));
    expect((await saveMap(s, map('prediction', 'over'), open)).ok).toBe(false);
  });
  it('refuses all saves after the cutoff but keeps old maps readable', async () => {
    const s = createMemoryStore();
    await saveMap(s, map('forecast', 'old'), open);
    const r = await saveMap(s, map('forecast', 'late'), FORECAST_CLOSES_AT_MS);
    expect(r.ok).toBe(false);
    expect((await s.list()).map((m) => m.id)).toEqual(['old']);
  });
});

describe('infobox parsing (labeled fixture: trimmed real Wikipedia wikitext)', () => {
  const wt = `{{Infobox election
| election_name = 2026 United States Senate election in Ohio
| nominee1 = [[Jon Husted]]
| party1 = Republican Party (United States)
| popular_vote1 = 
| nominee2 = [[Mike Rogers (Michigan politician)|Mike Rogers]]{{efn|note with | pipe}}
| party2 = Democratic Party of Georgia
| before_election = [[Jon Husted]]{{efn|Appointed.<ref>x | y</ref>}}
| before_party = Republican Party (United States)
}}
Body text.`;
  const box = parseInfobox(wt);
  it('reads nominees and strips notes and links', () => {
    expect(linkTarget(box.get('nominee1')!).display).toBe('Jon Husted');
    expect(linkTarget(box.get('nominee2')!)).toEqual({ target: 'Mike Rogers (Michigan politician)', display: 'Mike Rogers' });
    expect(box.get('before_election')).toContain('Jon Husted');
    expect(box.get('before_election')).not.toContain('Appointed');
  });
  it('skips empty fields', () => expect(box.has('popular_vote1')).toBe(false));
  it('normalizes party labels', () => {
    expect(normalizeParty(box.get('party1')!)).toBe('R');
    expect(normalizeParty(box.get('party2')!)).toBe('D');
    expect(normalizeParty('Democratic–Farmer–Labor Party')).toBe('D');
    expect(normalizeParty('Independent')).toBe('O');
  });
  it('matches names by last name and first initial', () => {
    expect(matchName('Mike Rogers', 'Michael Rogers')).toBe(true);
    expect(matchName('Jon Husted', 'Jon Husted Jr.')).toBe(true);
    expect(matchName('Jon Husted', 'Sherrod Brown')).toBe(false);
    expect(matchName('Bill Cassidy', 'Cassidy, B.')).toBe(false);
  });
});
