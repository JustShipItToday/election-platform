/**
 * Builds public/data/research.json: analyst ratings, past results and candidate profiles.
 * Everything is read from a cited source; nothing is written by hand. Slow on a cold cache
 * (hundreds of polite requests), fast once pages are cached.
 *   npm run research
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DatasetSchema, ResearchSchema, type CandidateProfile, type HistoryEntry, type Race, type Research } from '../src/data/schema';
import { linkTarget, normalizeParty, parseInfobox } from './infobox';
import { districtParts, stateBlobs } from './house';
import { parsePredictions } from './ratings';
import { DAY, HOUR, wikitext, pageUrl } from './wiki';
import { buildCandidateProfiles } from './profiles';

const NOW = new Date().toISOString();
const warnings: string[] = [];

const titleFromUrl = (url: string) => decodeURIComponent(url.split('/wiki/')[1] ?? '').replace(/_/g, ' ').split('#')[0] ?? '';

const num = (s: string | undefined) => {
  if (!s) return null;
  const d = s.replace(/[^0-9.]/g, '');
  return d && Number.isFinite(Number(d)) ? Number(d) : null;
};

async function history(prevTitle: string | undefined, depth: number): Promise<HistoryEntry[]> {
  const out: HistoryEntry[] = [];
  let title = prevTitle;
  for (let i = 0; i < depth && title; i++) {
    const page = await wikitext(title, 7 * DAY).catch(() => null);
    if (!page) break;
    const box = parseInfobox(page.text);
    const results: HistoryEntry['results'] = [];
    for (let n = 1; n <= 6; n++) {
      const raw = box.get(`nominee${n}`) ?? box.get(`candidate${n}`);
      if (!raw) continue;
      const partyRaw = box.get(`party${n}`) ?? '';
      results.push({
        name: linkTarget(raw).display,
        party: normalizeParty(partyRaw),
        partyLabel: linkTarget(partyRaw).display || 'Unknown',
        votes: num(box.get(`popular_vote${n}`)),
        pct: num(box.get(`percentage${n}`)),
      });
    }
    if (!results.length) break;
    out.push({ title: page.title, url: page.url, results, retrievedAt: NOW });
    const next = box.get('previous_election');
    title = next ? linkTarget(next).target ?? linkTarget(next).display : undefined;
  }
  return out;
}

const pastHouse = new Map<string, Promise<{ title: string; url: string; parts: ReturnType<typeof districtParts> }[]>>();

/** Per-district infoboxes from a past election's state page (and its district sub-pages). */
function pastHousePages(stateName: string, year: number, seats: number) {
  const key = `${year}:${stateName}`;
  if (!pastHouse.has(key)) {
    pastHouse.set(key, stateBlobs(stateName, year).then((blobs) => blobs.map((b) => ({ title: b.title, url: b.url, parts: districtParts(b.text, seats) }))));
  }
  return pastHouse.get(key)!;
}

async function houseHistory(race: Race, seats: number): Promise<HistoryEntry[]> {
  const out: HistoryEntry[] = [];
  for (const year of [2024, 2022]) {
    const pages = await pastHousePages(race.stateName, year, seats);
    for (const pg of pages) {
      const hit = pg.parts.get(race.district ?? '');
      if (!hit) continue;
      const results: HistoryEntry['results'] = [];
      for (let n = 1; n <= 6; n++) {
        const raw = hit.box.get(`nominee${n}`) ?? hit.box.get(`candidate${n}`);
        if (!raw) continue;
        const partyRaw = hit.box.get(`party${n}`) ?? '';
        results.push({ name: linkTarget(raw).display, party: normalizeParty(partyRaw), partyLabel: linkTarget(partyRaw).display || 'Unknown', votes: num(hit.box.get(`popular_vote${n}`)), pct: num(hit.box.get(`percentage${n}`)) });
      }
      if (results.length) {
        out.push({ title: `${year} election, ${race.label} (district lines then in use)`, url: pg.url, results, retrievedAt: NOW });
        break;
      }
    }
  }
  return out;
}

async function raceResearch(race: Race, houseCache: Map<string, ReturnType<typeof districtParts>>, seatsByState: Map<string, number>) {
  const title = titleFromUrl(race.source.url);
  const page = title ? await wikitext(title, 6 * HOUR).catch(() => null) : null;
  if (!page) return { ratings: [], ratingsUrl: null, history: [] as HistoryEntry[] };
  let ratingsText = page.text;
  let prev: string | undefined;
  if (race.chamber === 'house') {
    const key = page.title;
    if (!houseCache.has(key)) houseCache.set(key, districtParts(page.text, race.state === 'AK' || race.district === 'AL' ? 1 : 2));
    const part = houseCache.get(key)!.get(race.district ?? '');
    ratingsText = part?.section ?? '';
    const pe = part?.box.get('previous_election');
    prev = pe ? linkTarget(pe).target ?? linkTarget(pe).display : undefined;
  } else {
    const pe = parseInfobox(page.text).get('previous_election');
    prev = pe ? linkTarget(pe).target ?? linkTarget(pe).display : undefined;
  }
  const ratings = parsePredictions(ratingsText);
  const hist = race.chamber === 'house' ? await houseHistory(race, seatsByState.get(race.state) ?? 2) : await history(prev, 2);
  return { ratings, ratingsUrl: page.url, history: hist };
}

async function main() {
  const ds = DatasetSchema.parse(JSON.parse(readFileSync('public/data/dataset.json', 'utf8')));
  const only = process.argv.includes('--races-only');
  const races: Research['races'] = {};
  // House pages are shared by many districts; keep parsed parts per page.
  const houseCache = new Map<string, ReturnType<typeof districtParts>>();
  const seatsByState = new Map<string, number>();
  for (const r of ds.races) if (r.chamber === 'house') seatsByState.set(r.state, (seatsByState.get(r.state) ?? 0) + 1);
  let i = 0;
  for (const race of ds.races) {
    try {
      races[race.id] = await raceResearch(race, houseCache, seatsByState);
    } catch (e) {
      warnings.push(`${race.id}: ${String(e).slice(0, 120)}`);
      races[race.id] = { ratings: [], ratingsUrl: null, history: [] };
    }
    if (++i % 25 === 0) console.log(`races ${i}/${ds.races.length}`);
  }
  const noRatings = Object.values(races).filter((r) => r.ratings.length === 0).length;
  const noHistory = Object.values(races).filter((r) => r.history.length === 0).length;
  console.log(`ratings missing for ${noRatings} races, history missing for ${noHistory}`);

  let candidates: Record<string, CandidateProfile> = {};
  if (!only) candidates = await buildCandidateProfiles(ds, NOW, warnings);

  const research: Research = ResearchSchema.parse({ generatedAt: NOW, races, candidates, warnings });
  writeFileSync('public/data/research.json', JSON.stringify(research));
  console.log(`research.json races=${Object.keys(races).length} candidates=${Object.keys(candidates).length} warnings=${warnings.length}`);
}

void pageUrl;
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
