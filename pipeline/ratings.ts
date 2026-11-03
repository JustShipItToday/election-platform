import { plain } from './ballot';

export interface ParsedRating {
  source: string;
  rating: string;
  asOf: string;
  url: string | null;
}

const LEVEL: Record<string, string> = { Tossup: 'Toss-up', 'Toss-up': 'Toss-up', Toss: 'Toss-up' };

/** {{USRaceRating|Lean|D|flip}} -> "Lean D (flip)"; {{USRaceRating|Tossup}} -> "Toss-up". */
export function ratingText(tpl: string): string {
  const parts = tpl.replace(/^\{\{\s*USRaceRating\s*\|?/i, '').replace(/\}\}\s*$/, '').split('|').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return '';
  const flip = parts.includes('flip');
  const core = parts.filter((x) => x !== 'flip').map((x) => LEVEL[x] ?? x);
  return `${core.join(' ')}${flip ? ' (flip)' : ''}`;
}

/** Parse the first "Predictions" table of a race (or district) section. */
export function parsePredictions(wt: string): ParsedRating[] {
  const start = wt.search(/^={2,5}\s*Predictions\s*={2,5}\s*$/m);
  if (start < 0) return [];
  const after = wt.slice(start);
  const tStart = after.indexOf('{|');
  const tEnd = after.indexOf('\n|}', tStart);
  if (tStart < 0 || tEnd < 0) return [];
  const table = after.slice(tStart, tEnd);
  const out: ParsedRating[] = [];
  for (const row of table.split(/\n\|-[^\n]*\n/).slice(1)) {
    const cells = ('\n' + row).split(/\n\|(?!\})/).slice(1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const tpl = /\{\{\s*USRaceRating[^}]*\}\}/i.exec(cells[1]!)?.[0];
    const url = /\burl\s*=\s*(https?:\/\/[^\s|}]+)/i.exec(cells[0]!)?.[1] ?? null;
    const source = plain(cells[0]!.replace(/^[^|]*\|(?=\s*['\[])/, '')).replace(/^align\s*=\s*"?left"?\s*\|?\s*/i, '').trim();
    const asOf = plain(cells[2]!);
    if (!tpl || !source) continue;
    out.push({ source, rating: ratingText(tpl), asOf, url });
  }
  return out;
}
