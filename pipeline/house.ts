import { readFileSync } from 'node:fs';
import type { Party, Race, SourceRef } from '../src/data/schema';
import { STATES } from '../src/data/states';
import { linkTarget, normalizeParty, parseInfoboxes, type Infobox } from './infobox';
import { candidatesFrom, reportedFrom } from './race-parse';
import { MIN, wikitext } from './wiki';
import { fullName, lastTerm, partyBucket, type Legislator } from './roster';

const RACE_TTL = 12 * MIN;

export interface Seat {
  id: string;
  state: string;
  district: string;
}

/** Seats come from the Census 120th-Congress district file, not from any list typed by hand. */
export function loadSeats(path = 'public/data/districts.json'): Seat[] {
  const topo = JSON.parse(readFileSync(path, 'utf8')) as { objects: { districts: { geometries: { properties: Seat }[] } } };
  return topo.objects.districts.geometries.map((g) => g.properties);
}

const ordinal = (n: number) => {
  const v = n % 100;
  const s = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
};

export const houseLabel = (stateName: string, district: string) =>
  district === 'AL' ? `${stateName} at-large` : `${stateName} ${ordinal(Number(district))} District`;

interface Blob {
  title: string;
  url: string;
  text: string;
}

async function stateBlobs(stateName: string): Promise<Blob[]> {
  const titles = [
    `2026 United States House of Representatives elections in ${stateName}`,
    `2026 United States House of Representatives election in ${stateName}`,
  ];
  let page = null;
  for (const t of titles) {
    page = await wikitext(t, RACE_TTL);
    if (page) break;
  }
  if (!page) return [];
  const blobs: Blob[] = [{ title: page.title, url: page.url, text: page.text }];
  // Large states split their districts onto sub-pages such as "(districts 1–26)".
  const subs = new Set<string>();
  for (const m of page.text.matchAll(/\{\{\s*main\s*\|\s*([^}|]*\(districts?[^)]*\))\s*\}\}/gi)) subs.add(m[1]!.trim());
  for (const t of subs) {
    const sub = await wikitext(t, RACE_TTL);
    if (sub) blobs.push({ title: sub.title, url: sub.url, text: sub.text });
  }
  return blobs;
}

const isNov3 = (box: Infobox) => {
  const d = box.get('election_date') ?? '';
  return !d || /November\s+3,\s+2026|2026\|11\|0?3\b/i.test(d);
};

/** Map each district to its general-election infobox using the nearest preceding district heading. */
export function districtBoxes(text: string, seatCount: number): Map<string, Infobox> {
  const heads: { pos: number; district: string }[] = [];
  for (const m of text.matchAll(/^={2,5}\s*([^=\n]*?\bDistrict\s+(\d+)\b[^=\n]*|[^=\n]*\bat-large\b[^=\n]*)\s*={2,5}\s*$/gim)) {
    heads.push({ pos: m.index ?? 0, district: m[2] ? String(Number(m[2])) : 'AL' });
  }
  const out = new Map<string, Infobox>();
  for (const { pos, box } of parseInfoboxes(text)) {
    if (!isNov3(box)) continue;
    let district: string | null = null;
    for (const h of heads) if (h.pos < pos) district = h.district;
    if (!district && seatCount === 1) district = 'AL';
    if (!district) continue;
    const prev = out.get(district);
    // Prefer an infobox that actually names nominees.
    if (!prev || (!prev.has('nominee1') && box.has('nominee1'))) out.set(district, box);
  }
  return out;
}

/** Like districtBoxes, but also returns each district's section text (for ratings tables). */
export function districtParts(text: string, seatCount: number): Map<string, { box: Infobox; section: string }> {
  const heads: { pos: number; level: number; district: string | null }[] = [];
  for (const m of text.matchAll(/^(={2,5})\s*([^=\n]+?)\s*\1\s*$/gm)) {
    const d = /\bDistrict\s+(\d+)\b/i.exec(m[2]!);
    heads.push({ pos: m.index ?? 0, level: m[1]!.length, district: d ? String(Number(d[1])) : /at-large/i.test(m[2]!) ? 'AL' : null });
  }
  const boxes = districtBoxes(text, seatCount);
  const out = new Map<string, { box: Infobox; section: string }>();
  for (const [district, box] of boxes) {
    const i = heads.findIndex((h) => h.district === district);
    let section = '';
    if (i >= 0) {
      const start = heads[i]!;
      const next = heads.slice(i + 1).find((h) => h.level <= start.level);
      section = text.slice(start.pos, next?.pos ?? text.length);
    } else if (seatCount === 1) {
      section = text;
    }
    out.set(district, { box, section });
  }
  return out;
}

export interface HouseResult {
  races: Race[];
  coverage: { seats: number; withNominees: number; vacant: number; noPage: string[] };
}

export async function buildHouse(a: { reps: Legislator[]; now: string; warnings: string[] }): Promise<HouseResult> {
  const seats = loadSeats();
  const byState = new Map<string, Seat[]>();
  for (const s of seats) byState.set(s.state, [...(byState.get(s.state) ?? []), s]);

  const repAt = new Map<string, Legislator>();
  for (const r of a.reps) {
    const t = lastTerm(r);
    if (!STATES[t.state]) continue;
    repAt.set(`${t.state}-${t.district === 0 ? 'AL' : t.district}`, r);
  }

  const races: Race[] = [];
  const noPage: string[] = [];
  for (const [state, stateSeats] of [...byState].sort((x, y) => x[0].localeCompare(y[0]))) {
    const stateName = STATES[state]!;
    const blobs = await stateBlobs(stateName);
    if (!blobs.length) noPage.push(state);
    const boxes = new Map<string, { box: Infobox; blob: Blob }>();
    for (const blob of blobs) for (const [d, box] of districtBoxes(blob.text, stateSeats.length)) if (!boxes.has(d)) boxes.set(d, { box, blob });

    for (const seat of stateSeats) {
      const hit = boxes.get(seat.district);
      const rep = repAt.get(`${state}-${seat.district}`);
      const candidates = hit ? candidatesFrom(hit.box, seat.id) : [];
      // In districts redrawn for 2026 the member who held this district NUMBER is often not the incumbent
      // running here, so Wikipedia's infobox (the incumbent of this race) wins and the roster is the fallback.
      const rawInfo = hit?.box.get('before_election') ? linkTarget(hit.box.get('before_election')!).display : '';
      const openSeat = /^(none|vacant|new seat)/i.test(rawInfo);
      const infoName = openSeat ? '' : rawInfo;
      const infoParty = hit?.box.get('before_party');
      const useInfobox = !!hit && (openSeat || !!infoName);
      const incumbentName = useInfobox ? infoName || null : rep ? fullName(rep) : null;
      const seatPartyBefore: Party | null = useInfobox
        ? infoName && infoParty ? normalizeParty(infoParty) : null
        : rep ? partyBucket(lastTerm(rep).party) : null;
      const lastName = (n: string) => n.toLowerCase().replace(/[^a-z\s'-]/g, ' ').trim().split(/\s+/).filter((t) => !/^(jr|sr|ii|iii)$/.test(t)).pop();
      if (rep && infoName && lastName(fullName(rep)) !== lastName(infoName)) {
        a.warnings.push(`${seat.id}: roster member for this district number is ${fullName(rep)}; Wikipedia lists ${infoName} as the incumbent`);
      }
      const src = hit?.blob;
      const source: SourceRef = { name: 'Wikipedia (district infobox)', url: src?.url ?? 'https://en.wikipedia.org/', retrievedAt: a.now, license: 'CC BY-SA 4.0' };
      races.push({
        id: seat.id,
        chamber: 'house',
        state,
        stateName,
        label: houseLabel(stateName, seat.district),
        special: false,
        district: seat.district,
        seatPartyBefore,
        incumbentName,
        candidates,
        candidatesStatus: candidates.length >= 1 ? 'nominees' : 'unavailable',
        reported: hit ? reportedFrom(hit.box, candidates, a.now) : { afterParty: null, afterName: null, results: [], retrievedAt: a.now },
        source,
      });
    }
    process.stdout.write(`h:${state} `);
  }
  console.log();
  const withNominees = races.filter((r) => r.candidatesStatus === 'nominees').length;
  const vacant = races.filter((r) => !r.incumbentName).length;
  return { races, coverage: { seats: races.length, withNominees, vacant, noPage } };
}
