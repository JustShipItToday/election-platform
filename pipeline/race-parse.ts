import type { Candidate } from '../src/data/schema';
import { linkTarget, normalizeParty, slug, type Infobox } from './infobox';

export function candidatesFrom(box: Infobox, raceId: string): Candidate[] {
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

export function numberOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const digits = s.replace(/[^0-9.]/g, '');
  const n = Number(digits);
  return digits !== '' && Number.isFinite(n) ? n : null;
}

export function reportedFrom(box: Infobox, cands: Candidate[], retrievedAt = new Date().toISOString()) {
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
    retrievedAt,
  };
}

