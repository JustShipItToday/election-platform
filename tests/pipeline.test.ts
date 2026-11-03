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

import { districtBoxes } from '../pipeline/house';
import { linkTarget, normalizeParty } from '../pipeline/infobox';

describe('House district parsing (labeled fixture: real Maine sections)', () => {
  const text = readFileSync('tests/fixtures/maine-house-excerpt.wikitext', 'utf8');
  const boxes = districtBoxes(text, 2);
  const nominees = (d: string) => {
    const b = boxes.get(d)!;
    return [1, 2].map((i) => `${linkTarget(b.get(`nominee${i}`) ?? '').display}:${normalizeParty(b.get(`party${i}`) ?? '')}`);
  };
  it('ties each infobox to the district heading above it', () => {
    expect([...boxes.keys()].sort()).toEqual(['1', '2']);
  });
  it('reads nominees and parties for each district', () => {
    expect(nominees('1')).toEqual(['Chellie Pingree:D', 'Ronald Russell:R']);
    expect(nominees('2')).toEqual(['Matthew Dunlap:D', 'Paul LePage:R']);
  });
  it('maps a lone infobox to the at-large seat when the state has one district', () => {
    const one = '{{Infobox election\n| election_date = November 3, 2026\n| nominee1 = [[A B]]\n| party1 = Republican Party (United States)\n}}';
    expect([...districtBoxes(one, 1).keys()]).toEqual(['AL']);
  });
  it('ignores primary infoboxes dated on another day', () => {
    const wt = '==District 1==\n{{Infobox election\n| election_date = June 9, 2026\n| nominee1 = [[X Y]]\n}}';
    expect(districtBoxes(wt, 2).size).toBe(0);
  });
});
