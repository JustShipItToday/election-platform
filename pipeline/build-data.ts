/**
 * Builds public/data/dataset.json from free, attributable sources:
 *  - VoteHub Polling API (polls)            https://api.votehub.com/polls  (CC BY 4.0 per their listing)
 *  - congress-legislators (Senate roster)   public domain
 *  - Wikipedia race infoboxes (nominees)    CC BY-SA 4.0
 *  - data/curated/governor-holdovers.json   curated, see file for provenance
 * Never invents data: anything it cannot source is left out and reported in meta.warnings.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatasetSchema, type Candidate, type Dataset, type Party, type Poll, type Race, type SourceRef } from '../src/data/schema';
import { STATES, SENATE_STATES, GOVERNOR_STATES, SENATE_SPECIAL } from '../src/data/states';
import { parseInfobox, normalizeParty, linkTarget, slug, matchName, type Infobox } from './infobox';
import { FORECAST_CLOSES_AT_MS, RESULTS_VISIBLE_AT_MS } from '../src/domain/lifecycle';

const UA = 'ElectiaPlatform/0.1 (educational election forecasting site; https://github.com/JustShipItToday/election-platform)';
const NOW = new Date().toISOString();
const warnings: string[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getText(url: string, tries = 7): Promise<string> {
  let lastErr = '';
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.ok) return await res.text();
      lastErr = `HTTP ${res.status}`;
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Math.max(2000, (Number.isFinite(ra) ? ra : 0) * 1000) * (i + 1));
    } catch (e) {
      lastErr = String(e);
      await sleep(2000 * (i + 1));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastErr}`);
}

async function getJson<T>(url: string): Promise<T> {
  return JSON.parse(await getText(url)) as T;
}

// ---------- Senate roster ----------
interface Legislator {
  id: { bioguide: string };
  name: { official_full?: string; first: string; last: string };
  terms: { type: string; state: string; class?: number; party: string; end: string }[];
}

function senatePartyBucket(party: string): Party {
  if (party === 'Democrat') return 'D';
  if (party === 'Republican') return 'R';
  return 'O';
}

async function loadSenate() {
  const url = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
  const all = await getJson<Legislator[]>(url);
  const senators = all.filter((l) => l.terms[l.terms.length - 1]?.type === 'sen');
  if (senators.length !== 100) throw new Error(`Expected 100 senators, got ${senators.length}`);
  return { senators, source: { name: 'unitedstates/congress-legislators', url, retrievedAt: NOW, license: 'Public domain (CC0)' } satisfies SourceRef };
}

// ---------- VoteHub ----------
interface VhPoll {
  id: string;
  poll_type: string;
  sample_size: number | null;
  population: string | null;
  url: string;
  created_at: string;
  start_date: string;
  end_date: string;
  pollster: string;
  answers: { choice: string; pct: number }[];
  sponsors: string[];
  internal: boolean;
  partisan: string | null;
  subject: string | null;
}

async function loadVoteHub(type: 'us-senator' | 'governor'): Promise<VhPoll[]> {
  const url = `https://api.votehub.com/polls?poll_type=${type}&limit=2000`;
  return getJson<VhPoll[]>(url);
}

// ---------- Wikipedia ----------
async function wikitext(title: string): Promise<{ title: string; text: string } | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(title)}`;
  const cacheDir = process.env.WIKI_CACHE_DIR;
  const cacheFile = cacheDir ? `${cacheDir}/${createHash('sha1').update(url).digest('hex')}.json` : null;
  let body: string;
  if (cacheFile && existsSync(cacheFile)) {
    body = readFileSync(cacheFile, 'utf8');
  } else {
    await sleep(1300);
    body = await getText(url);
    if (cacheFile) {
      mkdirSync(cacheDir!, { recursive: true });
      writeFileSync(cacheFile, body);
    }
  }
  const j = JSON.parse(body) as { query: { pages: { title: string; missing?: boolean; revisions?: { slots: { main: { content: string } } }[] }[] } };
  const page = j.query.pages[0];
  if (!page || page.missing || !page.revisions) return null;
  return { title: page.title, text: page.revisions[0]!.slots.main.content };
}

function pageUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

function numberOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return s.replace(/[^0-9.]/g, '') !== '' && Number.isFinite(n) ? n : null;
}

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

function reportedFrom(box: Infobox, cands: Candidate[]) {
  const results = [];
  for (let i = 1; i <= 8; i++) {
    const raw = box.get(`nominee${i}`) ?? box.get(`candidate${i}`);
    if (!raw) continue;
    const name = linkTarget(raw).display;
    const c = cands.find((x) => x.name === name);
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
  const { senators, source: legSource } = await loadSenate();
  const seatUp = (s: Legislator) => {
    const t = s.terms[s.terms.length - 1]!;
    return t.class === 2 || (SENATE_SPECIAL.includes(t.state) && t.class === 3);
  };
  const upSenators = senators.filter(seatUp);
  if (upSenators.length !== SENATE_STATES.length + SENATE_SPECIAL.length - 0 && upSenators.length !== 35) {
    throw new Error(`Expected 35 Senate seats up, found ${upSenators.length}`);
  }
  const holdSen = { D: 0, R: 0, O: 0 };
  for (const s of senators) {
    if (!seatUp(s)) holdSen[senatePartyBucket(s.terms[s.terms.length - 1]!.party)] += 1;
  }

  const races: Race[] = [];
  const wikiSources = new Map<string, SourceRef>();

  const build = async (chamber: 'senate' | 'governor', state: string, special: boolean) => {
    const stateName = STATES[state]!;
    const id = `${chamber}-${state}`;
    const titles =
      chamber === 'senate'
        ? special
          ? [`2026 United States Senate special election in ${stateName}`, `2026 United States Senate election in ${stateName}`]
          : [`2026 United States Senate election in ${stateName}`]
        : [`2026 ${stateName} gubernatorial election`];
    let page: { title: string; text: string } | null = null;
    for (const t of titles) {
      page = await wikitext(t);
      if (page) break;
    }
    let box: Infobox | null = null;
    if (page) box = parseInfobox(page.text);
    else warnings.push(`${id}: Wikipedia page not found (${titles.join(' | ')})`);

    const candidates = box ? candidatesFrom(box, id) : [];
    const sen = chamber === 'senate' ? upSenators.find((s) => s.terms[s.terms.length - 1]!.state === state) : undefined;
    const senTerm = sen?.terms[sen.terms.length - 1];
    const infoboxBefore = box?.get('before_party');
    const seatPartyBefore: Party | null = senTerm
      ? senatePartyBucket(senTerm.party)
      : infoboxBefore
        ? normalizeParty(infoboxBefore)
        : null;
    const incumbentName = sen
      ? (sen.name.official_full ?? `${sen.name.first} ${sen.name.last}`)
      : box?.get('before_election')
        ? linkTarget(box.get('before_election')!).display || null
        : null;
    const url = page ? pageUrl(page.title) : 'https://en.wikipedia.org/';
    const source: SourceRef = { name: 'Wikipedia (race infobox)', url, retrievedAt: NOW, license: 'CC BY-SA 4.0' };
    if (page) wikiSources.set(url, source);
    if (box && candidates.length === 0) warnings.push(`${id}: no named nominees in the source infobox yet`);

    races.push({
      id,
      chamber,
      state,
      stateName,
      label: `${stateName} ${chamber === 'senate' ? 'Senate' : 'Governor'}${special ? ' (special)' : ''}`,
      special,
      seatPartyBefore,
      incumbentName,
      candidates,
      candidatesStatus: candidates.length >= 2 ? 'nominees' : 'unavailable',
      reported: box ? reportedFrom(box, candidates) : { afterParty: null, afterName: null, results: [], retrievedAt: NOW },
      source,
    });
  };

  for (const st of upSenators.map((s) => s.terms[s.terms.length - 1]!.state).sort()) {
    await build('senate', st, SENATE_SPECIAL.includes(st));
    process.stdout.write(`senate ${st} `);
  }
  console.log();
  for (const st of GOVERNOR_STATES) {
    await build('governor', st, false);
    process.stdout.write(`gov ${st} `);
  }
  console.log();

  // ---------- Polls ----------
  const [senPolls, govPolls] = await Promise.all([loadVoteHub('us-senator'), loadVoteHub('governor')]);
  const polls: Poll[] = [];
  const seen = new Set<string>();
  const generic = /undecided|other|not sure|don'?t know|none|refused|neither|unsure|someone else|third|wouldn'?t vote|would not vote|skip|no opinion/i;
  let droppedNoMatch = 0;
  for (const [type, list] of [['senate', senPolls], ['governor', govPolls]] as const) {
    for (const p of list) {
      const m = /^2026 (.+)$/.exec(p.subject ?? '');
      if (!m) continue;
      const stateEntry = Object.entries(STATES).find(([, n]) => n === m[1]);
      if (!stateEntry) continue;
      const race = races.find((r) => r.id === `${type}-${stateEntry[0]}`);
      if (!race || race.candidatesStatus !== 'nominees') continue;
      if (seen.has(p.id)) continue;
      const results: { candidateId: string; pct: number }[] = [];
      for (const a of p.answers) {
        const c = race.candidates.find((x) => matchName(x.name, a.choice));
        if (c) results.push({ candidateId: c.id, pct: a.pct });
      }
      if (results.length < 2) {
        if (!p.answers.every((a) => generic.test(a.choice))) droppedNoMatch += 1;
        continue;
      }
      seen.add(p.id);
      polls.push({
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
    }
  }
  if (droppedNoMatch > 0) {
    warnings.push(`${droppedNoMatch} VoteHub polls were not matched to two named nominees (for example primary polls) and are not shown.`);
  }

  // ---------- Governor holdovers (curated) ----------
  const govFile = JSON.parse(readFileSync('data/curated/governor-holdovers.json', 'utf8')) as {
    asOf: string;
    note: string;
    holdovers: Record<string, { name: string; party: 'D' | 'R' | 'O' }>;
  };
  const govHold = { D: 0, R: 0, O: 0 };
  for (const g of Object.values(govFile.holdovers)) govHold[g.party] += 1;
  const govUp = new Set<string>(GOVERNOR_STATES);
  const expectedHold = Object.keys(STATES).filter((s) => !govUp.has(s));
  if (Object.keys(govFile.holdovers).sort().join() !== expectedHold.sort().join()) {
    throw new Error('Governor holdover file does not cover exactly the states without a 2026 governor race');
  }

  const voteHubSource: SourceRef = {
    name: 'VoteHub Polling API',
    url: 'https://api.votehub.com/polls',
    retrievedAt: NOW,
    license: 'CC BY 4.0 (credit VoteHub and cite each poll\'s original source)',
  };
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
          note: 'Seats not on the ballot in 2026. "Other" are independents (Angus King, Bernie Sanders), who caucus with Democrats.',
          source: legSource,
        },
        governor: {
          ...govHold,
          note: govFile.note,
          source: { name: 'Curated list of sitting governors', url: 'https://github.com/JustShipItToday/election-platform/blob/main/data/curated/governor-holdovers.json', retrievedAt: govFile.asOf },
        },
      },
      sources: [voteHubSource, legSource, ...wikiSources.values()].slice(0, 3),
      counts: { races: races.length, polls: polls.length, racesWithNominees: races.filter((r) => r.candidatesStatus === 'nominees').length },
      warnings,
    },
    races,
    polls,
  };
  const parsed = DatasetSchema.parse(dataset);
  mkdirSync('public/data', { recursive: true });
  writeFileSync('public/data/dataset.json', JSON.stringify(parsed));
  if (!existsSync('public/data/calls.json')) {
    writeFileSync('public/data/calls.json', JSON.stringify({ updatedAt: NOW, calls: [] }));
  }
  console.log(`\nraces=${races.length} withNominees=${dataset.meta.counts.racesWithNominees} polls=${polls.length}`);
  console.log(`senate holdover`, holdSen, `governor holdover`, govHold);
  for (const w of warnings) console.log('WARN', w);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
