import type { CallRecord, Race } from '../data/schema';

export type CallVerdict =
  | { called: true; winnerId: string; reason: string }
  | { called: false; reason: string };

/**
 * A race counts as "called" only with attributable evidence:
 *  - at least one official source (state election office or similar), OR
 *  - at least two news sources from different publishers.
 * The winner must be one of the race's known candidates.
 */
export function judgeCall(call: CallRecord | undefined, race: Race): CallVerdict {
  if (!call) return { called: false, reason: 'No confirmed call yet' };
  if (!race.candidates.some((c) => c.id === call.winnerCandidateId)) {
    return { called: false, reason: 'Winner is not a known candidate in this race' };
  }
  const official = call.evidence.filter((e) => e.kind === 'official');
  if (official.length >= 1) {
    return { called: true, winnerId: call.winnerCandidateId, reason: 'Confirmed by an official source' };
  }
  const publishers = new Set(call.evidence.filter((e) => e.kind === 'news').map((e) => e.publisher.trim().toLowerCase()));
  if (publishers.size >= 2) {
    return { called: true, winnerId: call.winnerCandidateId, reason: `Confirmed by ${publishers.size} independent news sources` };
  }
  return { called: false, reason: 'Not enough independent evidence yet' };
}
