import { unzipSync } from 'fflate';
import type { Dataset } from '../../src/data/schema';
import { matchName, normalizeParty } from '../infobox';

/**
 * North Carolina State Board of Elections: election-night results by precinct.
 * Format verified against the published 2024 file and the 2026 file (all contests present, zero votes before polls open).
 * These are the state's own unofficial results; they are shown as such and never used to call a race on their own.
 */
export const NC_URL = 'https://s3.amazonaws.com/dl.ncsbe.gov/ENRS/2026_11_03/results_pct_20261103.zip';
export const NC_NAME = 'North Carolina State Board of Elections: election night results (unofficial)';

interface Tally {
  total: number;
  precincts: Map<string, number>; // "county|precinct" -> votes in that contest
  choices: Map<string, { name: string; code: string; votes: number }>;
}

export interface NcContest {
  totalVotes: number;
  precinctsCounted: number;
  precinctsTotal: number;
  choices: { name: string; code: string; votes: number }[];
}

/** Parse the tab-delimited file into per-contest totals. */
export function parseNcResults(tsv: string): Map<string, NcContest> {
  const tallies = new Map<string, Tally>();
  const lines = tsv.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const header = lines[0]?.split('\t') ?? [];
  const col = (n: string) => header.indexOf(n);
  const iCounty = col('County'), iPrec = col('Precinct'), iContest = col('Contest Name'), iChoice = col('Choice'), iParty = col('Choice Party'), iTotal = col('Total Votes');
  if ([iCounty, iPrec, iContest, iChoice, iTotal].some((i) => i < 0)) throw new Error('Unexpected NC results columns');
  for (const line of lines.slice(1)) {
    const p = line.split('\t');
    const contest = p[iContest];
    if (!contest) continue;
    const votes = Number(p[iTotal] ?? 0) || 0;
    let t = tallies.get(contest);
    if (!t) { t = { total: 0, precincts: new Map(), choices: new Map() }; tallies.set(contest, t); }
    t.total += votes;
    const pk = `${p[iCounty]}|${p[iPrec]}`;
    t.precincts.set(pk, (t.precincts.get(pk) ?? 0) + votes);
    const name = (p[iChoice] ?? '').trim();
    const cur = t.choices.get(name) ?? { name, code: (p[iParty] ?? '').trim(), votes: 0 };
    cur.votes += votes;
    t.choices.set(name, cur);
  }
  const out = new Map<string, NcContest>();
  for (const [k, t] of tallies) {
    out.set(k, {
      totalVotes: t.total,
      precinctsTotal: t.precincts.size,
      precinctsCounted: [...t.precincts.values()].filter((v) => v > 0).length,
      choices: [...t.choices.values()].sort((a, b) => b.votes - a.votes),
    });
  }
  return out;
}

/** Contest name -> race id in our dataset, or null if it is not a race we track. */
export function ncRaceId(contest: string): string | null {
  if (contest === 'US SENATE') return 'senate-NC';
  const m = /^US HOUSE OF REPRESENTATIVES DISTRICT (\d+)$/.exec(contest);
  return m ? `house-NC-${Number(m[1])}` : null;
}

export async function fetchNc(): Promise<{ tsv: string; asOf: string | null }> {
  const res = await fetch(NC_URL, { headers: { 'User-Agent': 'ElectiaPlatform/0.1 (educational election site)' } });
  if (!res.ok) throw new Error(`NC results HTTP ${res.status}`);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const first = Object.values(files)[0];
  if (!first) throw new Error('Empty NC results archive');
  return { tsv: new TextDecoder('latin1').decode(first), asOf: res.headers.get('last-modified') ? new Date(res.headers.get('last-modified')!).toISOString() : null };
}

export function ncToOfficial(contests: Map<string, NcContest>, ds: Dataset) {
  const out: Record<string, { totalVotes: number; precinctsCounted: number; precinctsTotal: number; results: { name: string; party: 'D' | 'R' | 'O'; partyCode: string; votes: number; pct: number | null; candidateId: string | null }[] }> = {};
  for (const [name, c] of contests) {
    const id = ncRaceId(name);
    if (!id) continue;
    const race = ds.races.find((r) => r.id === id);
    if (!race) continue;
    out[id] = {
      totalVotes: c.totalVotes,
      precinctsCounted: c.precinctsCounted,
      precinctsTotal: c.precinctsTotal,
      results: c.choices
        .filter((x) => x.votes > 0 || race.candidates.some((cand) => matchName(cand.name, x.name)))
        .map((x) => ({
          name: x.name,
          party: normalizeParty(x.code === 'DEM' ? 'Democratic' : x.code === 'REP' ? 'Republican' : x.code),
          partyCode: x.code,
          votes: x.votes,
          pct: c.totalVotes > 0 ? Math.round((1000 * x.votes) / c.totalVotes) / 10 : null,
          candidateId: race.candidates.find((cand) => matchName(cand.name, x.name))?.id ?? null,
        })),
    };
  }
  return out;
}
