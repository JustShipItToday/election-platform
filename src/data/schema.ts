import { z } from 'zod';

/** Party buckets used for makeup. "O" covers every non-major-party label. */
export const PartySchema = z.enum(['D', 'R', 'O']);
export type Party = z.infer<typeof PartySchema>;

export const ChamberSchema = z.enum(['senate', 'house', 'governor']);
export type Chamber = z.infer<typeof ChamberSchema>;

export const SourceRefSchema = z.object({
  name: z.string(),
  url: z.string(),
  retrievedAt: z.string(),
  license: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const CandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  party: PartySchema,
  partyLabel: z.string(),
  wikipediaTitle: z.string().nullable(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/** Result fields as reported by the source infobox. Never treated as final by themselves. */
export const ReportedResultSchema = z.object({
  candidateId: z.string(),
  votes: z.number().nullable(),
  pct: z.number().nullable(),
});

export const RaceSchema = z.object({
  id: z.string(),
  chamber: ChamberSchema,
  state: z.string().length(2),
  stateName: z.string(),
  label: z.string(),
  special: z.boolean(),
  /** House only: "AL" for at-large, otherwise the district number as text. */
  district: z.string().nullable(),
  seatPartyBefore: PartySchema.nullable(),
  incumbentName: z.string().nullable(),
  candidates: z.array(CandidateSchema),
  /** "nominees" = the source lists named nominees. "unavailable" = it does not (yet). */
  candidatesStatus: z.enum(['nominees', 'unavailable']),
  reported: z.object({
    afterParty: PartySchema.nullable(),
    afterName: z.string().nullable(),
    results: z.array(ReportedResultSchema),
    retrievedAt: z.string(),
  }),
  source: SourceRefSchema,
});
export type Race = z.infer<typeof RaceSchema>;

export const PollSchema = z.object({
  id: z.string(),
  raceId: z.string(),
  pollster: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  releasedDate: z.string(),
  sampleSize: z.number().nullable(),
  population: z.string().nullable(),
  /** Original poll source link; the provider omits it for a few polls. */
  url: z.string().nullable(),
  internal: z.boolean(),
  partisan: z.string().nullable(),
  sponsors: z.array(z.string()),
  /** Only answers that map to this race's nominees. */
  results: z.array(z.object({ candidateId: z.string(), pct: z.number() })),
  /** Every answer exactly as published, for transparency. */
  answers: z.array(z.object({ choice: z.string(), pct: z.number() })),
});
export type Poll = z.infer<typeof PollSchema>;

export const HoldoverSchema = z.object({
  D: z.number(),
  R: z.number(),
  O: z.number(),
  note: z.string(),
  source: SourceRefSchema,
});

export const MetaSchema = z.object({
  generatedAt: z.string(),
  election: z.object({
    date: z.string(),
    forecastClosesAt: z.string(),
    resultsVisibleAt: z.string(),
  }),
  holdovers: z.object({ senate: HoldoverSchema, house: HoldoverSchema, governor: HoldoverSchema }),
  sources: z.array(SourceRefSchema),
  counts: z.object({ races: z.number(), polls: z.number(), racesWithNominees: z.number() }),
  warnings: z.array(z.string()),
});
export type Meta = z.infer<typeof MetaSchema>;

export const BallotQuestionSchema = z.object({
  id: z.string(),
  state: z.string().length(2),
  stateName: z.string(),
  /** The measure's title as listed by the source. */
  title: z.string(),
  /** Short name such as "Alaska Measure 2" (the source article title), when there is one. */
  measureName: z.string().nullable(),
  origin: z.string(),
  /** What a "yes" vote does, as written by the source. The source does not say what "no" does, so neither do we. */
  yesMeans: z.string(),
  /** On ballot, Approved, or Failed, as reported by the source. */
  status: z.string(),
  wikipediaTitle: z.string().nullable(),
  /** Reported result once available. Not final until confirmed. */
  reported: z.object({ yesPct: z.number().nullable(), noPct: z.number().nullable(), yesVotes: z.number().nullable(), noVotes: z.number().nullable() }),
  source: SourceRefSchema,
});
export type BallotQuestion = z.infer<typeof BallotQuestionSchema>;

export const DatasetSchema = z.object({
  meta: MetaSchema,
  races: z.array(RaceSchema),
  polls: z.array(PollSchema),
  ballot: z.array(BallotQuestionSchema),
});
export type Dataset = z.infer<typeof DatasetSchema>;

/** Human-confirmed calls. A race is "called" only with enough attributable evidence. */
export const CallEvidenceSchema = z.object({
  kind: z.enum(['official', 'news', 'other']),
  publisher: z.string(),
  url: z.string(),
  retrievedAt: z.string(),
});
export const CallSchema = z.object({
  raceId: z.string(),
  winnerCandidateId: z.string(),
  calledAt: z.string(),
  evidence: z.array(CallEvidenceSchema),
  note: z.string().optional(),
});
export const CallsFileSchema = z.object({
  updatedAt: z.string(),
  calls: z.array(CallSchema),
});
export type CallRecord = z.infer<typeof CallSchema>;
export type CallsFile = z.infer<typeof CallsFileSchema>;
