import { describe, expect, it } from 'vitest';
import { findStates, parseMethod, parseRequest } from '../src/assistant/grammar';
import { callTool, TOOLS, type ToolEnv } from '../src/tools';
import { DEFAULT_POLL_SETTINGS } from '../src/domain/polling';
import type { Candidate, Dataset, Poll, Race } from '../src/data/schema';

// ---- Labeled fixtures (synthetic, test-only) ----
const cands = (id: string): Candidate[] => [
  { id: `${id}:a`, name: 'Alex Fixture', party: 'D', partyLabel: 'Democratic', wikipediaTitle: null },
  { id: `${id}:b`, name: 'Blair Fixture', party: 'R', partyLabel: 'Republican', wikipediaTitle: null },
];
const mkRace = (chamber: Race['chamber'], state: string, name: string, district: string | null = null): Race => {
  const id = chamber === 'house' ? `house-${state}-${district}` : `${chamber}-${state}`;
  return { id, chamber, state, stateName: name, label: `${name} ${chamber}`, special: false, district, seatPartyBefore: 'R', incumbentName: null, candidates: cands(id), candidatesStatus: 'nominees',
    reported: { afterParty: null, afterName: null, results: [], retrievedAt: 'x' }, source: { name: 'fixture', url: 'https://example.test', retrievedAt: 'x' } };
};
const poll = (raceId: string, end: string, a: number, b: number): Poll => ({ id: `${raceId}-${end}`, raceId, pollster: 'Fixture', startDate: end, endDate: end, releasedDate: end, sampleSize: 500, population: 'lv', url: null, internal: false, partisan: null, sponsors: [], results: [{ candidateId: `${raceId}:a`, pct: a }, { candidateId: `${raceId}:b`, pct: b }], answers: [] });
const src = { name: 'fixture', url: 'https://example.test', retrievedAt: 'x' };
const NOW = Date.parse('2026-11-03T12:00:00Z');
const data: Dataset = {
  meta: { generatedAt: 'x', election: { date: '', forecastClosesAt: '', resultsVisibleAt: '' }, holdovers: { senate: { D: 0, R: 0, O: 0, note: '', source: src }, house: { D: 0, R: 0, O: 0, note: '', source: src }, governor: { D: 0, R: 0, O: 0, note: '', source: src } }, sources: [], counts: { races: 3, polls: 4, racesWithNominees: 3 }, warnings: [] },
  races: [mkRace('senate', 'GA', 'Georgia'), mkRace('governor', 'GA', 'Georgia'), mkRace('senate', 'MI', 'Michigan'), mkRace('house', 'PA', 'Pennsylvania', '7')],
  polls: [poll('senate-GA', '2026-10-30', 50, 44), poll('senate-GA', '2026-08-10', 45, 47), poll('senate-MI', '2026-10-01', 46, 46), poll('governor-GA', '2026-10-20', 48, 49)],
  ballot: [],
};
const env = (): ToolEnv => ({ data, research: null, calls: { updatedAt: '', calls: [] }, nowMs: NOW, settings: DEFAULT_POLL_SETTINGS, scope: { include: [], exclude: [] }, picks: { forecast: {}, endorse: {}, ballotForecast: {}, ballotEndorse: {} } });

describe('request parser', () => {
  const act = (s: string) => parseRequest(s, data, NOW);
  it('finds states by name and by capitalized abbreviation, without false positives', () => {
    expect(findStates('Just focus on Georgia')).toEqual(['GA']);
    expect(findStates('only PA, MI and WI')).toEqual(['PA', 'MI', 'WI']);
    expect(findStates('West Virginia only')).toEqual(['WV']);
    expect(findStates('what is in the news or ok')).toEqual([]);
  });
  it('reads polling methods', () => {
    expect(parseMethod('average the latest three polls')).toEqual({ kind: 'latestN', n: 3 });
    expect(parseMethod('use only the latest poll')).toEqual({ kind: 'latest' });
    expect(parseMethod('polls from the last three weeks')).toEqual({ kind: 'window', days: 21 });
    expect(parseMethod('all polls')).toEqual({ kind: 'all' });
  });
  it('sets the polling method conversationally', () => {
    expect(act('Use only the latest poll.')).toMatchObject({ type: 'set-method', patch: { method: { kind: 'latest' } } });
    expect(act('Average the latest three polls.')).toMatchObject({ type: 'set-method', patch: { method: { kind: 'latestN', n: 3 } } });
    expect(act('Only use polls from the last three weeks.')).toMatchObject({ type: 'set-method', patch: { method: { kind: 'window', days: 21 } } });
    expect(act('Exclude internal polls')).toMatchObject({ type: 'set-method', patch: { excludeInternal: true } });
  });
  it('answers "what happens if" as a comparison, not a change', () => {
    expect(act('What happens if I use the latest three instead?')).toEqual({ type: 'what-if', method: { kind: 'latestN', n: 3 } });
  });
  it('compiles scope requests into structured clauses', () => {
    expect(act('Just focus on Georgia.')).toEqual({ type: 'set-scope', scope: { include: [{ states: ['GA'] }], exclude: [] } });
    const a = act('All Senate races, but only competitive House races in PA and MI.');
    expect(a).toMatchObject({ type: 'set-scope' });
    if (a.type === 'set-scope') {
      expect(a.scope.include[0]).toEqual({ chambers: ['senate'] });
      expect(a.scope.include[1]).toEqual({ chambers: ['house'], states: ['PA', 'MI'], closeWithin: 5 });
    }
  });
  it('maps factual questions to tools', () => {
    expect(act('Show me the Georgia Senate polls since September 1')).toMatchObject({ type: 'tool', name: 'get_polling', input: { raceId: 'senate-GA', since: '2026-09-01' } });
    expect(act('Which Senate races received new polling in the last seven days?')).toMatchObject({ type: 'tool', name: 'get_recent_race_changes', input: { days: 7, chamber: 'senate' } });
    expect(act('Show analyst ratings for Georgia')).toMatchObject({ type: 'tool', name: 'get_ratings' });
    expect(act('Which of my calls have not been revisited recently?')).toMatchObject({ type: 'tool', name: 'get_user_predictions', input: { mode: 'forecast', staleFirst: true } });
    expect(act('Compare Georgia polling now with August')).toMatchObject({ type: 'multi', note: 'Now compared with 2026-08-01' });
  });
  it('handles the user making their own call and deferring', () => {
    expect(act("Okay, I'm calling this Republican.")).toEqual({ type: 'call-current', party: 'R' });
    expect(act('Come back later')).toEqual({ type: 'defer-current' });
    expect(act('Go with whatever the polling says')).toEqual({ type: 'apply-polling' });
  });
  it('says what it cannot do instead of guessing', () => {
    expect(act('What was the 2024 presidential result in these districts?')).toMatchObject({ type: 'unsupported' });
    expect(act('asdf qwerty')).toMatchObject({ type: 'unsupported' });
  });
});

describe('tools', () => {
  it('has a validated, named tool for every contract and rejects bad input', () => {
    expect(Object.keys(TOOLS).length).toBeGreaterThanOrEqual(20);
    const r = callTool(env(), 'get_polling', { raceId: 'x' });
    expect(r.display.title).toMatch(/could not be understood/i);
  });
  it('computes averages deterministically and labels the category', () => {
    const r = callTool(env(), 'get_poll_average', { raceId: 'senate-GA' });
    expect(r.category).toBe('computed');
    expect(r.display.lines.join(' ')).toMatch(/Alex Fixture 47\.5%/);
  });
  it('can recompute an average as of a past date', () => {
    const r = callTool(env(), 'get_poll_average', { raceId: 'senate-GA', asOf: '2026-08-31' });
    expect(r.display.lines.join(' ')).toMatch(/Blair Fixture 47%/);
  });
  it('never claims polling it does not have', () => {
    const r = callTool(env(), 'get_ballot_question_polling', { id: 'anything' });
    expect(r.display.lines[0]).toMatch(/No polling/);
  });
  it('proposes polling-rule calls without saving them', () => {
    const r = callTool(env(), 'apply_polling_rule', {});
    expect(r.proposal?.picks.map((p) => p.raceId).sort()).toEqual(['governor-GA', 'senate-GA'].sort());
  });
  it('refuses to save a call without explicit user confirmation', () => {
    const r = callTool(env(), 'save_user_prediction', { raceId: 'senate-GA', candidateId: 'senate-GA:a', party: 'D' });
    expect(r.display.title).toMatch(/could not be understood/i);
  });
  it('has no tool that ranks, scores or recommends candidates', () => {
    for (const name of Object.keys(TOOLS)) expect(name).not.toMatch(/rank|score|recommend|best|endorse_for|advise/i);
  });
});
