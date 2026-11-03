import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CallsFileSchema, DatasetSchema } from '../src/data/schema';
import { judgeBallotCall, judgeCall } from '../src/domain/evidence';

const dataset = DatasetSchema.parse(JSON.parse(readFileSync('public/data/dataset.json', 'utf8')));
const calls = CallsFileSchema.parse(JSON.parse(readFileSync('public/data/calls.json', 'utf8')));

describe('generated dataset', () => {
  it('has statewide ballot measures with source wording', () => {
    expect(dataset.ballot.length).toBeGreaterThan(50);
    for (const q of dataset.ballot) { expect(q.yesMeans.length, q.id).toBeGreaterThan(10); expect(q.source.url).toMatch(/^https:/); }
    expect(new Set(dataset.ballot.map((q) => q.id)).size).toBe(dataset.ballot.length);
  });
  it('has 35 Senate, 435 House and 36 Governor races', () => {
    expect(dataset.races.filter((r) => r.chamber === 'senate')).toHaveLength(35);
    expect(dataset.races.filter((r) => r.chamber === 'house')).toHaveLength(435);
    expect(dataset.races.filter((r) => r.chamber === 'governor')).toHaveLength(36);
  });
  it('every House seat has a unique district and a label', () => {
    const house = dataset.races.filter((r) => r.chamber === 'house');
    expect(new Set(house.map((r) => `${r.state}-${r.district}`)).size).toBe(435);
    for (const r of house) expect(r.label.length).toBeGreaterThan(3);
  });
  it('holdovers plus seats up equal the full chamber', () => {
    const h = dataset.meta.holdovers;
    expect(h.senate.D + h.senate.R + h.senate.O + 35).toBe(100);
    expect(h.governor.D + h.governor.R + h.governor.O + 36).toBe(50);
    expect(h.house.D + h.house.R + h.house.O).toBe(0);
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
  it('district geometry covers exactly the House seats in the data', () => {
    const topo = JSON.parse(readFileSync('public/data/districts.json', 'utf8')) as { objects: { districts: { geometries: { properties: { id: string } }[] } } };
    const ids = new Set(topo.objects.districts.geometries.map((g) => g.properties.id));
    const house = dataset.races.filter((r) => r.chamber === 'house');
    expect(ids.size).toBe(435);
    for (const r of house) expect(ids.has(r.id), r.id).toBe(true);
  });
  it('race ids are unique', () => {
    expect(new Set(dataset.races.map((r) => r.id)).size).toBe(dataset.races.length);
  });
});

describe('calls.json (hand-edited on election night)', () => {
  const races = new Map(dataset.races.map((r) => [r.id, r]));
  const ballots = new Map(dataset.ballot.map((b) => [b.id, b]));
  it('only refers to real races, measures and candidates, once each', () => {
    const seen = new Set<string>();
    for (const c of calls.calls) {
      expect(races.has(c.raceId) || ballots.has(c.raceId), `unknown race or measure ${c.raceId}`).toBe(true);
      expect(seen.has(c.raceId), `duplicate call for ${c.raceId}`).toBe(false);
      seen.add(c.raceId);
      const race = races.get(c.raceId);
      if (race) expect(race.candidates.some((x) => x.id === c.winnerCandidateId), `winner not in race ${c.raceId}`).toBe(true);
    }
  });
  it('every listed call meets the evidence rule', () => {
    for (const c of calls.calls) {
      const race = races.get(c.raceId);
      const v = race ? judgeCall(c, race) : judgeBallotCall(c, ballots.get(c.raceId)!);
      expect(v.called, `${c.raceId} lacks enough evidence`).toBe(true);
    }
  });
});
