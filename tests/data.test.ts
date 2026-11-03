import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CallsFileSchema, DatasetSchema } from '../src/data/schema';
import { judgeCall } from '../src/domain/evidence';

const dataset = DatasetSchema.parse(JSON.parse(readFileSync('public/data/dataset.json', 'utf8')));
const calls = CallsFileSchema.parse(JSON.parse(readFileSync('public/data/calls.json', 'utf8')));

describe('generated dataset', () => {
  it('has 35 Senate and 36 Governor races', () => {
    expect(dataset.races.filter((r) => r.chamber === 'senate')).toHaveLength(35);
    expect(dataset.races.filter((r) => r.chamber === 'governor')).toHaveLength(36);
  });
  it('holdovers plus seats up equal the full chamber', () => {
    const h = dataset.meta.holdovers;
    expect(h.senate.D + h.senate.R + h.senate.O + 35).toBe(100);
    expect(h.governor.D + h.governor.R + h.governor.O + 36).toBe(50);
  });
  it('every poll belongs to a real race and only names that race\'s nominees', () => {
    const races = new Map(dataset.races.map((r) => [r.id, r]));
    for (const p of dataset.polls) {
      const race = races.get(p.raceId);
      expect(race, p.id).toBeDefined();
      expect(p.results.length).toBeGreaterThanOrEqual(2);
      for (const res of p.results) expect(race!.candidates.some((c) => c.id === res.candidateId), p.id).toBe(true);
    }
  });
  it('race ids are unique', () => {
    expect(new Set(dataset.races.map((r) => r.id)).size).toBe(dataset.races.length);
  });
});

describe('calls.json (hand-edited on election night)', () => {
  it('only refers to real races and real candidates, once each', () => {
    const races = new Map(dataset.races.map((r) => [r.id, r]));
    const seen = new Set<string>();
    for (const c of calls.calls) {
      const race = races.get(c.raceId);
      expect(race, `unknown race ${c.raceId}`).toBeDefined();
      expect(seen.has(c.raceId), `duplicate call for ${c.raceId}`).toBe(false);
      seen.add(c.raceId);
      expect(race!.candidates.some((x) => x.id === c.winnerCandidateId), `winner not in race ${c.raceId}`).toBe(true);
    }
  });
  it('every listed call meets the evidence rule', () => {
    const races = new Map(dataset.races.map((r) => [r.id, r]));
    for (const c of calls.calls) {
      expect(judgeCall(c, races.get(c.raceId)!).called, `${c.raceId} lacks enough evidence`).toBe(true);
    }
  });
});
