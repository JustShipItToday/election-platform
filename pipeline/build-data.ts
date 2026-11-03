/**
 * Builds public/data/dataset.json from free, attributable sources. Nothing is hand-curated:
 *  - VoteHub Polling API (polls)                          https://api.votehub.com/polls  (CC BY 4.0 per their listing)
 *  - unitedstates/congress-legislators (sitting members)  public domain
 *  - Wikipedia (race lists, nominees, governors list)     CC BY-SA 4.0
 * Anything the sources do not provide is left out and reported in meta.warnings.
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { DatasetSchema, type Candidate, type Dataset, type Party, type Poll, type Race, type SourceRef } from '../src/data/schema';
import { STATES, USPS_BY_NAME } from '../src/data/states';
import { parseInfobox, normalizeParty, linkTarget, slug, matchName, type Infobox } from './infobox';
import { FORECAST_CLOSES_AT_MS, RESULTS_VISIBLE_AT_MS } from '../src/domain/lifecycle';
import { getJson } from './http';
import { MIN, wikitext } from './wiki';
import { deriveGovernorStates, deriveSenateRaces } from './races';
import { loadGovernors } from './governors';

const NOW = new Date().toISOString();
const warnings: string[] = [];
const RACE_TTL = 12 * MIN;

// ---------- Congress roster ----------
interface Legislator {
  id: { bioguide: string };
  name: { official_full?: string; first: string; last: string };
  terms: { type: string; state: string; class?: number; party: string; end: string; caucus?: string }[];
}

function partyBucket(party: string): Party {
  if (party === 'Democrat') return 'D';
  if (party === 'Republican') return 'R';
  return 'O';
}

const lastTerm = (l: Legislator) => l.terms[l.terms.length - 1]!;
const fullName = (l: Legislator) => l.name.official_full ?? `${l.name.first} ${l.name.last}`;

async function loadRoster() {
  const url = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
  const all = await getJson<Legislator[]>(url);
  const senators = all.filter((l) => lastTerm(l).type === 'sen');
  if (senators.length !== 100) throw new Error(`Expected 100 senators, got ${senators.length}`);
  const source: SourceRef = { name: 'unitedstates/congress-legislators', url, retrievedAt: NOW, license: 'Public domain (CC0)' };
  return { all, senators, source };
}

// ---------- VoteHub ----------
interface VhPoll {
  id: string;
  poll_type: string;
  sample_size: number | null;
  population: string | null;
  url: string | null;
  created_at: string;
  start_date: string;
  end_date: string;
  pollster: string;
  answers: { choice: string; pct: number }[];
  sponsors: string[];
  internal: boolean;
  partisan: string | null;
  subject: string | null;
  seat_name: string | null;
}

const loadVoteHub = (type: string) => getJson<VhPoll[]>(`https://api.votehub.com/polls?poll_type=${type}&limit=2000`);

// ---------- infobox -> race ----------
function candidatesFrom(box: Infobox, raceId: string): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 1; i <= 8; i++) {
    const raw = box.get(`nominee${i}`) ?? box.get(`candidate${i}`);
    if (!raw) continue;
    const name = linkTarget(raw).display;
    if (!name) continue;
    const partyRaw = box.get(`party${i}`) ?? '';
    out.push({
      id: `${raceId}:${slug(name)}`,
      name,
      party: normalizeParty(partyRaw),
      partyLabel: linkTarget(partyRaw).display || 'Unknown',
      wikipediaTitle: linkTarget(raw).target,
    });
  }
  return out;
}

function numberOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const digits = s.replace(/[^0-9.]/g, '');
  const n = Number(digits);
  return digits !== '' && Number.isFinite(n) ? n : null;
}

function reportedFrom(box: Infobox, cands: Candidate[]) {
  const results = [];
  for (let i = 1; i <= 8; i++) {
    const raw = box.get(`nominee${i}`) ?? box.get(`candidate${i}`);
    if (!raw) continue;
    const c = cands.find((x) => x.name === linkTarget(raw).display);
    if (!c) continue;
    const votes = numberOrNull(box.get(`popular_vote${i}`));
    const pct = numberOrNull(box.get(`percentage${i}`));
    if (votes !== null || pct !== null) results.push({ candidateId: c.id, votes, pct });
  }
  const afterParty = box.get('after_party');
  const afterName = box.get('after_election');
  return {
    afterParty: afterParty ? normalizeParty(afterParty) : null,
    afterName: afterName ? linkTarget(afterName).display || null : null,
    results,
    retrievedAt: NOW,
  };
}

async function main() {
  const roster = await loadRoster();
  const senateSpecs = await deriveSenateRaces();
  const govStates = await deriveGovernorStates();
  const gov = await loadGovernors();

  // Guard rails: fail loudly rather than publish a wrong universe of races.
  if (senateSpecs.length !== 35) throw new Error(`Expected 35 Senate races, derived ${senateSpecs.length}`);
  if (govStates.length !== 36) throw new Error(`Expected 36 governor races, derived ${govStates.length}`);

  const races: Race[] = [];
  const seatBioguides = new Set<string>();
  const govNameByState = new Map(gov.governors.map((g) => [g.state, g]));

  const readRace = async (title: string, id: string) => {
    const page = await wikitext(title, RACE_TTL);
    if (!page) return null;
    const box = parseInfobox(page.text);
    const date = box.get('election_date') ?? '';
    if (date && !/November\s+3,\s+2026|2026\|11\|0?3\b/i.test(date)) warnings.push(`${id}: page says election_date "${date}"`);
    return { page, box };
  };

  for (const spec of senateSpecs) {
    const stateName = STATES[spec.state]!;
    const id = `senate-${spec.state}`;
    const titles = spec.special
      ? [`2026 United States Senate special election in ${stateName}`, `2026 United States Senate election in ${stateName}`]
      : [`2026 United States Senate election in ${stateName}`];
    let got: Awaited<ReturnType<typeof readRace>> = null;
    for (const t of titles) {
      got = await readRace(t, id);
      if (got) break;
    }
    if (!got) warnings.push(`${id}: Wikipedia race page not found (${titles.join(' | ')})`);
    const candidates = got ? candidatesFrom(got.box, id) : [];
    const stateSenators = roster.senators.filter((s) => lastTerm(s).state === spec.state);
    const infoName = got?.box.get('before_election') ? linkTarget(got.box.get('before_election')!).display : '';
    let holder = infoName ? stateSenators.find((s) => matchName(fullName(s), infoName)) : undefined;
    if (!holder && !spec.special) holder = stateSenators.find((s) => lastTerm(s).class === 2);
    if (!holder) warnings.push(`${id}: could not match the seat holder in the roster (infobox says "${infoName}")`);
    if (holder) seatBioguides.add(holder.id.bioguide);
    const infoParty = got?.box.get('before_party');
    const seatPartyBefore: Party | null = holder ? partyBucket(lastTerm(holder).party) : infoParty ? normalizeParty(infoParty) : null;
    const source: SourceRef = { name: 'Wikipedia (race infobox)', url: got?.page.url ?? 'https://en.wikipedia.org/', retrievedAt: NOW, license: 'CC BY-SA 4.0' };
    races.push({
      id,
      chamber: 'senate',
      state: spec.state,
      stateName,
      label: `${stateName} Senate${spec.special ? ' (special)' : ''}`,
      special: spec.special,
      seatPartyBefore,
      incumbentName: holder ? fullName(holder) : infoName || null,
      candidates,
      candidatesStatus: candidates.length >= 2 ? 'nominees' : 'unavailable',
      reported: got ? reportedFrom(got.box, candidates) : { afterParty: null, afterName: null, results: [], retrievedAt: NOW },
      source,
    });
    process.stdout.write(`sen:${spec.state} `);
  }
  console.log();

  for (const st of govStates) {
    const stateName = STATES[st]!;
    const id = `governor-${st}`;
    const got = await readRace(`2026 ${stateName} gubernatorial election`, id);
    if (!got) warnings.push(`${id}: Wikipedia race page not found`);
    const candidates = got ? candidatesFrom(got.box, id) : [];
    const listed = govNameByState.get(st);
    const infoName = got?.box.get('before_election') ? linkTarget(got.box.get('before_election')!).display : '';
    const infoParty = got?.box.get('before_party');
    if (listed && infoName && !matchName(listed.name, infoName)) warnings.push(`${id}: governors list says ${listed.name}, race page says ${infoName}`);
    if (listed && infoParty && normalizeParty(infoParty) !== listed.party) warnings.push(`${id}: seat party differs between the governors list and the race page`);
    const source: SourceRef = { name: 'Wikipedia (race infobox)', url: got?.page.url ?? 'https://en.wikipedia.org/', retrievedAt: NOW, license: 'CC BY-SA 4.0' };
    races.push({
      id,
      chamber: 'governor',
      state: st,
      stateName,
      label: `${stateName} Governor`,
      special: false,
      seatPartyBefore: listed?.party ?? (infoParty ? normalizeParty(infoParty) : null),
      incumbentName: listed?.name ?? (infoName || null),
      candidates,
      candidatesStatus: candidates.length >= 2 ? 'nominees' : 'unavailable',
      reported: got ? reportedFrom(got.box, candidates) : { afterParty: null, afterName: null, results: [], retrievedAt: NOW },
      source,
    });
    process.stdout.write(`gov:${st} `);
  }
  console.log();

  // ---------- Holdovers (all derived) ----------
  const holdSen = { D: 0, R: 0, O: 0 };
  const independents: string[] = [];
  for (const s of roster.senators) {
    if (seatBioguides.has(s.id.bioguide)) continue;
    const t = lastTerm(s);
    holdSen[partyBucket(t.party)] += 1;
    if (partyBucket(t.party) === 'O') independents.push(`${fullName(s)} (${t.party}${t.caucus ? `, caucuses with the ${t.caucus}s` : ''})`);
  }
  if (seatBioguides.size !== 35) throw new Error(`Matched ${seatBioguides.size} Senate seat holders, expected 35`);
  const upGov = new Set(govStates);
  const holdGov = { D: 0, R: 0, O: 0 };
  for (const g of gov.governors) if (!upGov.has(g.state)) holdGov[g.party] += 1;

  // ---------- Polls ----------
  const [senPolls, govPolls] = await Promise.all([loadVoteHub('us-senator'), loadVoteHub('governor')]);
  const polls: Poll[] = [];
  const seen = new Set<string>();
  let droppedNoMatch = 0;
  const toPoll = (p: VhPoll, race: Race, results: { candidateId: string; pct: number }[]): Poll => ({
    id: p.id,
    raceId: race.id,
    pollster: p.pollster,
    startDate: p.start_date,
    endDate: p.end_date,
    releasedDate: p.created_at,
    sampleSize: p.sample_size,
    population: p.population,
    url: p.url,
    internal: p.internal,
    partisan: p.partisan,
    sponsors: p.sponsors ?? [],
    results,
    answers: p.answers,
  });
  for (const [type, list] of [['senate', senPolls], ['governor', govPolls]] as const) {
    for (const p of list) {
      const m = /^2026 (.+)$/.exec(p.subject ?? '');
      const st = m ? USPS_BY_NAME[m[1]!] : undefined;
      if (!st || seen.has(p.id)) continue;
      const race = races.find((r) => r.id === `${type}-${st}`);
      if (!race || race.candidatesStatus !== 'nominees') continue;
      const results: { candidateId: string; pct: number }[] = [];
      for (const a of p.answers) {
        const c = race.candidates.find((x) => matchName(x.name, a.choice));
        if (c) results.push({ candidateId: c.id, pct: a.pct });
      }
      if (results.length < 2) { droppedNoMatch += 1; continue; }
      seen.add(p.id);
      polls.push(toPoll(p, race, results));
    }
  }
  if (droppedNoMatch > 0) warnings.push(`${droppedNoMatch} VoteHub polls did not match two named nominees (for example primary polls) and are not shown.`);

  const voteHubSource: SourceRef = { name: 'VoteHub Polling API', url: 'https://api.votehub.com/polls', retrievedAt: NOW, license: "CC BY 4.0 (credit VoteHub and cite each poll's original source)" };
  const wikiSource: SourceRef = { name: 'Wikipedia (race lists, race pages, governors list)', url: 'https://en.wikipedia.org/wiki/2026_United_States_elections', retrievedAt: NOW, license: 'CC BY-SA 4.0' };
  const dataset: Dataset = {
    meta: {
      generatedAt: NOW,
      election: {
        date: '2026-11-03',
        forecastClosesAt: new Date(FORECAST_CLOSES_AT_MS).toISOString(),
        resultsVisibleAt: new Date(RESULTS_VISIBLE_AT_MS).toISOString(),
      },
      holdovers: {
        senate: {
          ...holdSen,
          note: independents.length
            ? `Seats not on the ballot in 2026. Independents among them: ${independents.join('; ')}.`
            : 'Seats not on the ballot in 2026.',
          source: roster.source,
        },
        governor: {
          ...holdGov,
          note: `Governors in the ${50 - govStates.length} states with no governor race in 2026, from Wikipedia's list of current governors.`,
          source: { name: 'Wikipedia: List of current United States governors', url: gov.url, retrievedAt: NOW, license: 'CC BY-SA 4.0' },
        },
      },
      sources: [voteHubSource, roster.source, wikiSource],
      counts: { races: races.length, polls: polls.length, racesWithNominees: races.filter((r) => r.candidatesStatus === 'nominees').length },
      warnings,
    },
    races,
    polls,
  };
  const parsed = DatasetSchema.parse(dataset);
  mkdirSync('public/data', { recursive: true });
  writeFileSync('public/data/dataset.json', JSON.stringify(parsed));
  if (!existsSync('public/data/calls.json')) writeFileSync('public/data/calls.json', JSON.stringify({ updatedAt: NOW, calls: [] }));
  console.log(`races=${races.length} withNominees=${dataset.meta.counts.racesWithNominees} polls=${polls.length}`);
  console.log('senate holdover', holdSen, '| governor holdover', holdGov);
  for (const w of warnings) console.log('WARN', w);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
