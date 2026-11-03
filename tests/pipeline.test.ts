import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGovernors } from '../pipeline/governors';
import { stateHeadingsAfterRaceSummary } from '../pipeline/races';

describe('governors list parser (labeled fixture: real Wikipedia rows)', () => {
  const gov = parseGovernors(readFileSync('tests/fixtures/governors-excerpt.wikitext', 'utf8'));
  it('reads state, name and party from the table', () => {
    const by = Object.fromEntries(gov.map((g) => [g.state, g]));
    expect(by['AL']).toMatchObject({ name: 'Kay Ivey', party: 'R' });
    expect(by['MN']?.party).toBe('D'); // Democratic–Farmer–Labor
  });
  it('handles a row whose name is a plain link rather than a template (Louisiana)', () => {
    expect(gov.find((g) => g.state === 'LA')?.name).toBe('Jeff Landry');
  });
});

describe('race list derivation (labeled fixture: real headings)', () => {
  const text = readFileSync('tests/fixtures/race-headings.wikitext', 'utf8');
  it('only takes state headings after "Race summary" and marks specials', () => {
    const wt = text.split('=====GOV=====')[1]!;
    const specs = stateHeadingsAfterRaceSummary(wt);
    expect(specs.find((s) => s.state === 'FL')?.special).toBe(true);
    expect(specs.find((s) => s.state === 'OH')?.special).toBe(true);
    expect(specs.find((s) => s.state === 'AL')?.special).toBe(false);
  });
  it('ignores headings before the race summary', () => {
    expect(stateHeadingsAfterRaceSummary('== Alabama ==\n== Race summary ==\n== Georgia ==\n').map((s) => s.state)).toEqual(['GA']);
  });
});
