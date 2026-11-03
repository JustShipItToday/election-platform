import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ncRaceId, parseNcResults } from '../pipeline/official/nc';

describe('NC election-night parser (labeled fixture: real 2024 precinct rows)', () => {
  const tsv = readFileSync('tests/fixtures/nc-results-excerpt.tsv', 'latin1');
  const c = parseNcResults(tsv).get('US HOUSE OF REPRESENTATIVES DISTRICT 01')!;
  it('sums every precinct row into contest totals', () => {
    const lines = tsv.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).slice(1);
    const expected = lines.reduce((n, l) => n + Number(l.split('\t')[13] ?? 0), 0);
    expect(c.totalVotes).toBe(expected);
    expect(c.choices.reduce((n, x) => n + x.votes, 0)).toBe(expected);
    expect(c.choices[0]!.votes).toBeGreaterThanOrEqual(c.choices[1]!.votes);
  });
  it('counts precincts with votes separately from all precincts', () => {
    expect(c.precinctsTotal).toBeGreaterThan(0);
    expect(c.precinctsCounted).toBeLessThanOrEqual(c.precinctsTotal);
  });
  it('maps contests to our race ids and ignores local contests', () => {
    expect(ncRaceId('US SENATE')).toBe('senate-NC');
    expect(ncRaceId('US HOUSE OF REPRESENTATIVES DISTRICT 01')).toBe('house-NC-1');
    expect(ncRaceId('CITY OF ASHEVILLE CITY COUNCIL')).toBeNull();
  });
  it('fails loudly if the columns change', () => {
    expect(() => parseNcResults('A\tB\n1\t2')).toThrow(/columns/);
  });
});
