import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildQuery, newsUrl, parseGdelt, parseSeenDate } from '../src/news/gdelt';
import type { Race } from '../src/data/schema';

const race = (chamber: Race['chamber'], names: string[]): Race => ({
  id: 'x', chamber, state: 'GA', stateName: 'Georgia', label: 'Georgia', special: false, district: null, seatPartyBefore: null, incumbentName: null,
  candidates: names.map((n, i) => ({ id: `x:${i}`, name: n, party: 'D', partyLabel: 'Democratic', wikipediaTitle: null })),
  candidatesStatus: 'nominees', reported: { afterParty: null, afterName: null, results: [], retrievedAt: 'x' }, source: { name: 's', url: 'https://example.test', retrievedAt: 'x' },
});

describe('news (labeled fixture: real GDELT response)', () => {
  const sample = JSON.parse(readFileSync('tests/fixtures/gdelt-sample.json', 'utf8'));
  const items = parseGdelt(sample);
  it('parses real articles into headline, publisher, date and link only', () => {
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.url).toMatch(/^https?:\/\//);
      expect(it.publisher.length).toBeGreaterThan(2);
      expect(Number.isNaN(Date.parse(it.seenAt))).toBe(false);
      expect(it.title).not.toMatch(/\s{2,}/);
    }
    expect(Object.keys(items[0]!).sort()).toEqual(['publisher', 'seenAt', 'title', 'url']);
  });
  it('converts GDELT dates', () => expect(parseSeenDate('20261103T111500Z')).toBe('2026-11-03T11:15:00Z'));
  it('ignores malformed replies instead of throwing', () => {
    expect(parseGdelt({})).toEqual([]);
    expect(parseGdelt('Please limit requests to one every 5 seconds')).toEqual([]);
    expect(parseGdelt({ articles: [{ url: 'javascript:alert(1)', title: 'x', seendate: '20261103T111500Z', domain: 'd.com' }] })).toEqual([]);
  });
  it('builds a query from the candidates, with House context', () => {
    expect(buildQuery(race('senate', ['Jon Ossoff', 'Mike Collins']))).toBe('("Jon Ossoff" OR "Mike Collins") sourcelang:english');
    expect(buildQuery(race('house', ['A Person', 'B Person']))).toContain('"Congress"');
    expect(newsUrl('"x"')).toContain('mode=artlist');
  });
});
