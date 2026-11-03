import type { Party, SourceRef } from '../src/data/schema';
import { getJson } from './http';

export interface Legislator {
  id: { bioguide: string };
  name: { official_full?: string; first: string; last: string };
  terms: { type: string; state: string; class?: number; district?: number; party: string; end: string; caucus?: string }[];
}

export function partyBucket(party: string): Party {
  if (party === 'Democrat') return 'D';
  if (party === 'Republican') return 'R';
  return 'O';
}

export const lastTerm = (l: Legislator) => l.terms[l.terms.length - 1]!;
export const fullName = (l: Legislator) => l.name.official_full ?? `${l.name.first} ${l.name.last}`;

export async function loadRoster(now: string) {
  const url = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
  const all = await getJson<Legislator[]>(url);
  const senators = all.filter((l) => lastTerm(l).type === 'sen');
  if (senators.length !== 100) throw new Error(`Expected 100 senators, got ${senators.length}`);
  const reps = all.filter((l) => lastTerm(l).type === 'rep');
  const source: SourceRef = { name: 'unitedstates/congress-legislators', url, retrievedAt: now, license: 'Public domain (CC0)' };
  return { all, senators, reps, source };
}
