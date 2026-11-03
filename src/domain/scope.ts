import type { BallotQuestion, Chamber, Dataset, Race } from '../data/schema';
import { evaluatePolls, type PollSettings } from './polling';

/**
 * A scope is a predicate tree, not a preset. Clauses are unioned in `include`,
 * then anything matching `exclude` is removed. Empty `include` means "everything".
 */
export interface Clause {
  chambers?: Chamber[];
  states?: string[];
  raceIds?: string[];
  /** Only races with at least one usable poll under the active polling settings. */
  hasPolling?: boolean;
  /** Only races whose polling margin is at most this many points (needs polling). */
  closeWithin?: number;
  /** Only races whose seat is currently held by this party. */
  seatHeldBy?: 'D' | 'R' | 'O';
  /** Set to false to leave ballot questions out of this selection (default: included). */
  ballot?: boolean;
}

export interface Scope {
  include: Clause[];
  exclude: Clause[];
}

export const EVERYTHING: Scope = { include: [], exclude: [] };

function matches(clause: Clause, race: Race, data: Dataset, settings: PollSettings, nowMs: number): boolean {
  if (clause.chambers && !clause.chambers.includes(race.chamber)) return false;
  if (clause.states && !clause.states.includes(race.state)) return false;
  if (clause.raceIds && !clause.raceIds.includes(race.id)) return false;
  if (clause.seatHeldBy && race.seatPartyBefore !== clause.seatHeldBy) return false;
  if (clause.hasPolling || clause.closeWithin !== undefined) {
    const polls = data.polls.filter((p) => p.raceId === race.id);
    const out = evaluatePolls(polls, race.candidates, settings, nowMs);
    if (out.status === 'no-polls') return false;
    if (clause.closeWithin !== undefined) {
      if (out.margin === null || out.margin > clause.closeWithin) return false;
    }
  }
  return true;
}

export function resolveScope(scope: Scope, data: Dataset, settings: PollSettings, nowMs: number): Race[] {
  return data.races.filter((race) => {
    const included =
      scope.include.length === 0 || scope.include.some((c) => matches(c, race, data, settings, nowMs));
    if (!included) return false;
    return !scope.exclude.some((c) => matches(c, race, data, settings, nowMs));
  });
}

/** Race-only filters (polling, party, explicit races) never apply to ballot questions. */
const raceOnly = (c: Clause) => !!c.hasPolling || c.closeWithin !== undefined || !!c.seatHeldBy || !!c.raceIds;

/**
 * Which ballot questions are in scope. Ballot questions follow the state filters of each selection
 * and are included by default; a selection can opt out with `ballot: false`.
 */
export function resolveBallot(scope: Scope, data: Dataset): BallotQuestion[] {
  const fits = (c: Clause, q: BallotQuestion) => c.ballot !== false && !raceOnly(c) && (!c.states || c.states.includes(q.state));
  return data.ballot.filter((q) => {
    const included = scope.include.length === 0 || scope.include.some((c) => fits(c, q));
    return included && !scope.exclude.some((c) => !c.chambers && fits(c, q));
  });
}

/** Plain-English description of a scope, always shown back to the user. */
export function describeScope(scope: Scope): string {
  if (scope.include.length === 0 && scope.exclude.length === 0) return 'All Senate, House and Governor races';
  const part = (c: Clause): string => {
    const bits: string[] = [];
    if (c.chambers) bits.push(c.chambers.map((x) => (x === 'senate' ? 'Senate' : x === 'house' ? 'House' : 'Governor')).join(' + '));
    if (c.states) bits.push(c.states.length > 6 ? `${c.states.length} states` : c.states.join(', '));
    if (c.raceIds) bits.push(`${c.raceIds.length} chosen race${c.raceIds.length === 1 ? '' : 's'}`);
    if (c.seatHeldBy) bits.push(`seat held by ${c.seatHeldBy === 'D' ? 'Democrats' : c.seatHeldBy === 'R' ? 'Republicans' : 'others'}`);
    if (c.hasPolling) bits.push('with polling');
    if (c.closeWithin !== undefined) bits.push(`polling margin within ${c.closeWithin} pts`);
    if (c.ballot === false) bits.push('no ballot questions');
    return bits.length ? bits.join(' · ') : 'everything';
  };
  const inc = scope.include.length ? scope.include.map(part).join('  OR  ') : 'All races';
  return scope.exclude.length ? `${inc}, except ${scope.exclude.map(part).join(' / ')}` : inc;
}
