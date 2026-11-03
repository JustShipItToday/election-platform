import { describe, expect, it } from 'vitest';
import { parsePredictions, ratingText } from '../pipeline/ratings';

// Labeled fixture: trimmed real rows from Wikipedia "2026 Georgia gubernatorial election" (captured 2026-11-03, CC BY-SA 4.0).
const fixture = `===Predictions===
{| class="wikitable" style=text-align:center
!Source
!Ranking
!As of
|-
|align=left|''[[The Cook Political Report]]''<ref>{{cite web |title=2026 CPR Governor Race ratings |url=https://www.cookpolitical.com/ratings/governor-race-ratings |website=[[The Cook Political Report]] |access-date=November 2, 2026}}</ref>
|{{USRaceRating|Tossup}}
|October 29, 2026
|-
|align=left|[[Decision Desk HQ]]<ref name="DDHQ">{{cite web |title=2026 Governor Forecast |url=https://votes.decisiondeskhq.com/forecast/2026/governor |website=[[Decision Desk HQ]]}}</ref>
|{{USRaceRating|Lean|D|flip}}
|November 2, 2026
|}
`;

describe('ratings parser (labeled fixture)', () => {
  const rows = parsePredictions(fixture);
  it('reads source, rating and date', () => {
    expect(rows.map((r) => [r.source, r.rating, r.asOf])).toEqual([
      ['The Cook Political Report', 'Toss-up', 'October 29, 2026'],
      ['Decision Desk HQ', 'Lean D (flip)', 'November 2, 2026'],
    ]);
  });
  it('keeps the rating organization link from the citation', () => {
    expect(rows[0]!.url).toBe('https://www.cookpolitical.com/ratings/governor-race-ratings');
  });
  it('formats rating templates', () => {
    expect(ratingText('{{USRaceRating|Solid|R}}')).toBe('Solid R');
    expect(ratingText('{{USRaceRating|Tossup}}')).toBe('Toss-up');
  });
  it('returns nothing when there is no Predictions section', () => {
    expect(parsePredictions('== Results ==\n')).toEqual([]);
  });
});
