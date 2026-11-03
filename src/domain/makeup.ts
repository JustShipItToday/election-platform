import type { Chamber, Dataset, Party, Race } from '../data/schema';

export interface Pick {
  raceId: string;
  /** A named candidate in the race, or null for "someone else / other". */
  candidateId: string | null;
  party: Party;
  origin: 'user' | 'rule:polling';
  madeAt: string;
}

export interface SeatLine {
  raceId: string;
  label: string;
  party: Party | null;
  pickName: string | null;
  origin: Pick['origin'] | null;
}

export interface ChamberMakeup {
  chamber: Chamber;
  /** Seats not up in 2026, fixed by the source. */
  holdover: { D: number; R: number; O: number };
  /** Seats in scope that the user called. */
  called: { D: number; R: number; O: number };
  uncalled: number;
  inScope: number;
  /** holdover + called */
  total: { D: number; R: number; O: number };
  seats: SeatLine[];
  complete: boolean;
}

/**
 * Deterministic aggregation of individual race calls into a chamber result.
 * Ballot questions are not part of this function by construction.
 * Seats in scope that are not called stay "uncalled" and are never assigned to a party.
 */
export function computeMakeup(
  chamber: Chamber,
  data: Dataset,
  raceIdsInScope: ReadonlySet<string>,
  picks: ReadonlyMap<string, Pick>,
): ChamberMakeup {
  const holdSrc = data.meta.holdovers[chamber];
  const holdover = { D: holdSrc.D, R: holdSrc.R, O: holdSrc.O };
  const races = data.races.filter((r) => r.chamber === chamber);
  const called = { D: 0, R: 0, O: 0 };
  const seats: SeatLine[] = [];
  let uncalled = 0;
  let inScope = 0;
  for (const race of races) {
    if (!raceIdsInScope.has(race.id)) continue;
    inScope += 1;
    const pick = picks.get(race.id);
    if (pick) {
      called[pick.party] += 1;
      seats.push({
        raceId: race.id,
        label: race.label,
        party: pick.party,
        pickName: pick.candidateId ? (race.candidates.find((c) => c.id === pick.candidateId)?.name ?? null) : 'Other',
        origin: pick.origin,
      });
    } else {
      uncalled += 1;
      seats.push({ raceId: race.id, label: race.label, party: null, pickName: null, origin: null });
    }
  }
  seats.sort((a, b) => a.label.localeCompare(b.label));
  return {
    chamber,
    holdover,
    called,
    uncalled,
    inScope,
    total: {
      D: holdover.D + called.D,
      R: holdover.R + called.R,
      O: holdover.O + called.O,
    },
    seats,
    complete: inScope > 0 && uncalled === 0 && inScope === races.length,
  };
}

export function partyOfPick(race: Race, candidateId: string | null): Party {
  if (candidateId === null) return 'O';
  return race.candidates.find((c) => c.id === candidateId)?.party ?? 'O';
}
