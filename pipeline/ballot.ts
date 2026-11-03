import type { BallotQuestion, SourceRef } from '../src/data/schema';
import { USPS_BY_NAME } from '../src/data/states';
import { slug } from './infobox';
import { HOUR, MIN, wikitext } from './wiki';

/** Strip refs, templates, comments and wiki links down to plain text. */
export function plain(raw: string): string {
  let s = raw.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  for (let i = 0; i < 4; i++) s = s.replace(/\{\{(?:nbsp|nobr)[^}]*\}\}/gi, ' ').replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/'''?/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

function cellValue(cell: string): string {
  // "style=... | text" keeps only the text after the attribute pipe.
  const m = /^[^|\[{]*\|\s*([\s\S]*)$/.exec(cell);
  return (m && /=/.test(cell.split('|')[0] ?? '') ? m[1]! : cell).trim();
}

const num = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && /\d/.test(s) ? n : null;
};

/** Parse the per-state measure tables of Wikipedia's "2026 United States ballot measures". */
export function parseBallotMeasures(wt: string, retrievedAt: string, pageUrl: string): BallotQuestion[] {
  const out: BallotQuestion[] = [];
  const heads = [...wt.matchAll(/^={2,4}\s*([^=\n]+?)\s*={2,4}\s*$/gm)].map((m) => ({ pos: m.index ?? 0, name: m[1]!.trim() }));
  for (let h = 0; h < heads.length; h++) {
    const stateName = heads[h]!.name;
    const state = USPS_BY_NAME[stateName];
    if (!state) continue;
    // References can contain newlines and pipes that would split cells, so drop them first.
    const section = wt
      .slice(heads[h]!.pos, heads[h + 1]?.pos ?? wt.length)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<ref[^>]*\/>/gi, '')
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
    const rows = section.split(/\n\|-[^\n]*\n/);
    for (const row of rows) {
      const cells = ('\n' + row).split(/\n\|(?!\}|-)/).slice(1).map((c) => c.trim());
      if (cells.length < 5) continue;
      const origin = plain(cellValue(cells[0]!));
      const status = plain(cellValue(cells[1]!));
      const measureCell = cellValue(cells[2]!);
      const link = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/.exec(measureCell);
      const title = plain(measureCell);
      const yesMeans = plain(cellValue(cells[3]!));
      const date = plain(cellValue(cells[4]!));
      if (!title || !yesMeans || !/^Nov\s*3$/i.test(date)) continue;
      const resCells = cells.slice(5).map(cellValue);
      const yesRaw = resCells[0] ?? '';
      const noRaw = resCells[1] ?? '';
      const parts = (raw: string) => {
        const pieces = raw.replace(/'''/g, '').split(/<br\s*\/?>/i).map((x) => x.trim());
        return { votes: num(pieces.find((x) => !x.includes('%'))), pct: num(pieces.find((x) => x.includes('%'))) };
      };
      const y = /awaiting/i.test(yesRaw) ? { votes: null, pct: null } : parts(yesRaw);
      const n = /awaiting/i.test(yesRaw) ? { votes: null, pct: null } : parts(noRaw);
      const target = link?.[1]?.trim() ?? null;
      const measureName = target && /^\d{4} /.test(target) ? target.replace(/^\d{4}\s+/, '') : null;
      const source: SourceRef = { name: 'Wikipedia: 2026 United States ballot measures', url: pageUrl, retrievedAt, license: 'CC BY-SA 4.0' };
      out.push({
        id: `ballot-${state}-${slug(measureName ?? title).slice(0, 60)}`,
        state,
        stateName,
        title,
        measureName,
        origin,
        yesMeans,
        status: status || 'Unknown',
        wikipediaTitle: target,
        reported: { yesPct: y.pct, noPct: n.pct, yesVotes: y.votes, noVotes: n.votes },
        source,
      });
    }
  }
  return out;
}

export async function buildBallot(now: string, warnings: string[]): Promise<BallotQuestion[]> {
  const page = await wikitext('2026 United States ballot measures', 12 * MIN);
  if (!page) {
    warnings.push('Ballot measures: could not read the Wikipedia page.');
    return [];
  }
  const items = parseBallotMeasures(page.text, now, page.url);
  const ids = new Set<string>();
  for (const q of items) {
    if (ids.has(q.id)) q.id = `${q.id}-${ids.size}`;
    ids.add(q.id);
  }
  void HOUR;
  return items;
}
