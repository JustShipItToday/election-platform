import { z } from 'zod';
import type { BallotQuestion, CallsFile, Dataset, Party, Race, Research } from '../data/schema';
import { describeMethod, evaluatePolls, sortPolls, type PollMethod, type PollSettings } from '../domain/polling';
import { computeMakeup, type Pick } from '../domain/makeup';
import { resolveScope, type Scope } from '../domain/scope';
import { judgeBallotCall, judgeCall } from '../domain/evidence';

/** Every tool answer says where it came from, so the UI can keep categories apart. */
export type Category = 'poll' | 'record' | 'rating' | 'statement' | 'news' | 'user' | 'computed';

export interface Display {
  title: string;
  lines: string[];
  table?: { head: string[]; rows: string[][] };
  links?: { label: string; url: string }[];
}

export interface ToolResult {
  tool: string;
  category: Category;
  source: string;
  retrievedAt: string;
  display: Display;
  /** Set when the page should fetch live headlines for this race (the tool itself stays pure). */
  liveNews?: { raceId: string };
  /** Present only for tools that propose a change the user must see. */
  proposal?: { kind: 'picks'; picks: { raceId: string; candidateId: string; party: Party }[] };
}

export interface ToolEnv {
  data: Dataset;
  research: Research | null;
  calls: CallsFile;
  nowMs: number;
  settings: PollSettings;
  scope: Scope;
  picks: { forecast: Record<string, Pick>; endorse: Record<string, Pick>; ballotForecast: Record<string, 'yes' | 'no'>; ballotEndorse: Record<string, 'yes' | 'no'> };
  /** Writes go through the app, which enforces the lifecycle gate. Undefined in read-only contexts. */
  savePick?: (race: Race, candidateId: string | null, party: Party) => boolean;
}

export interface Tool<I> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  run: (env: ToolEnv, input: I) => ToolResult;
}

const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;

function mk(env: ToolEnv, tool: string, category: Category, source: string, display: Display): ToolResult {
  return { tool, category, source, retrievedAt: iso(env.nowMs), display };
}

const raceIdSchema = z.string().min(3).max(60);
const stateSchema = z.string().length(2);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const pctText = (n: number) => `${Math.round(n * 10) / 10}`;

function raceName(env: ToolEnv, id: string): string {
  return env.data.races.find((r) => r.id === id)?.label ?? id;
}

function candName(r: Race, id: string): string {
  return r.candidates.find((c) => c.id === id)?.name ?? id;
}

export function racesIn(env: ToolEnv, f: { chamber?: Race['chamber']; states?: string[] }): Race[] {
  return env.data.races.filter((r) => (!f.chamber || r.chamber === f.chamber) && (!f.states?.length || f.states.includes(r.state)));
}

// ---------------------------------------------------------------- tools
const search_races: Tool<{ chamber?: Race['chamber']; states?: string[]; closeWithin?: number; hasPolling?: boolean }> = {
  name: 'search_races',
  description: 'Find races by chamber, state, and polling closeness. Returns facts only.',
  input: z.object({ chamber: z.enum(['senate', 'house', 'governor']).optional(), states: z.array(stateSchema).max(50).optional(), closeWithin: z.number().min(0).max(50).optional(), hasPolling: z.boolean().optional() }),
  run: (env, i) => {
    let rows = racesIn(env, i).map((r) => ({ r, o: evaluatePolls(env.data.polls.filter((p) => p.raceId === r.id), r.candidates, env.settings, env.nowMs) }));
    if (i.hasPolling) rows = rows.filter((x) => x.o.status !== 'no-polls');
    if (i.closeWithin !== undefined) rows = rows.filter((x) => x.o.margin !== null && x.o.margin <= i.closeWithin!);
    rows.sort((a, b) => (a.o.margin ?? 999) - (b.o.margin ?? 999));
    return mk(env, 'search_races', 'computed', 'Elecia, from the polls and races on this site', {
      title: `${rows.length} race${rows.length === 1 ? '' : 's'}`,
      lines: [`Polling uses: ${describeMethod(env.settings)}.`],
      table: { head: ['Race', 'Polling margin', 'Leader'], rows: rows.slice(0, 40).map((x) => [x.r.label, x.o.margin === null ? 'no polling' : `${x.o.margin} pts`, x.o.leaderId ? `${candName(x.r, x.o.leaderId)} (${x.o.leaderParty})` : x.o.status === 'tie' ? 'tie' : '–']) },
    });
  },
};

const get_race: Tool<{ raceId: string }> = {
  name: 'get_race',
  description: 'Basic facts about one race.',
  input: z.object({ raceId: raceIdSchema }),
  run: (env, i) => {
    const r = env.data.races.find((x) => x.id === i.raceId);
    if (!r) return mk(env, 'get_race', 'record', 'Elecia', { title: 'Race not found', lines: [`No race with id ${i.raceId}.`] });
    return mk(env, 'get_race', 'record', r.source.name, {
      title: r.label,
      lines: [`Incumbent or seat holder: ${r.incumbentName ?? 'none listed'}${r.seatPartyBefore ? ` (${r.seatPartyBefore})` : ''}.`, r.candidates.length ? `Candidates: ${r.candidates.map((c) => `${c.name} (${c.party})`).join(', ')}.` : 'Nominees are not confirmed in the source yet.'],
      links: [{ label: 'Wikipedia', url: r.source.url }],
    });
  },
};

const search_candidates: Tool<{ query: string }> = {
  name: 'search_candidates',
  description: 'Find candidates by name.',
  input: z.object({ query: z.string().min(2).max(80) }),
  run: (env, i) => {
    const q = i.query.toLowerCase();
    const hits = env.data.races.flatMap((r) => r.candidates.filter((c) => c.name.toLowerCase().includes(q)).map((c) => ({ r, c })));
    return mk(env, 'search_candidates', 'record', 'Wikipedia race pages', {
      title: `${hits.length} candidate${hits.length === 1 ? '' : 's'} match "${i.query}"`,
      lines: [],
      table: { head: ['Candidate', 'Party', 'Race'], rows: hits.slice(0, 30).map((x) => [x.c.name, x.c.partyLabel, x.r.label]) },
    });
  },
};

const get_candidate_bio: Tool<{ candidateId: string }> = {
  name: 'get_candidate_bio',
  description: 'Sourced background on a candidate (one excerpt per source, never rewritten).',
  input: z.object({ candidateId: z.string().min(3).max(120) }),
  run: (env, i) => {
    const race = env.data.races.find((r) => r.candidates.some((c) => c.id === i.candidateId));
    const c = race?.candidates.find((x) => x.id === i.candidateId);
    if (!race || !c) return mk(env, 'get_candidate_bio', 'record', 'Elecia', { title: 'Candidate not found', lines: [] });
    const p = env.research?.candidates[c.id];
    const lines: string[] = [];
    const links: { label: string; url: string }[] = [];
    if (p?.bio) { lines.push(p.bio.text); links.push({ label: 'Wikipedia (CC BY-SA 4.0)', url: p.bio.url }); }
    if (p?.facts.positions.length) lines.push(`Offices held (Wikidata): ${p.facts.positions.join('; ')}.`);
    if (p?.congressService.length) lines.push(`Congressional service (public record): ${p.congressService.join('; ')}.`);
    if (p?.campaign) { lines.push(`From the campaign's website${p.campaign.description ? `: "${p.campaign.description}"` : ''}`); links.push({ label: "Campaign website", url: p.campaign.url }); if (p.campaign.issuesUrl) links.push({ label: 'Issues page', url: p.campaign.issuesUrl }); }
    if (!lines.length) lines.push('No sourced background is available for this candidate in this release.');
    return mk(env, 'get_candidate_bio', 'statement', 'Wikipedia, Wikidata, congress-legislators, campaign website', { title: `${c.name} (${c.party}), ${race.label}`, lines, links });
  },
};

const get_candidate_photo: Tool<{ candidateId: string }> = {
  name: 'get_candidate_photo',
  description: 'A verified photo with credit, or nothing.',
  input: z.object({ candidateId: z.string().min(3).max(120) }),
  run: (env, i) => {
    const p = env.research?.candidates[i.candidateId]?.photo;
    return mk(env, 'get_candidate_photo', 'record', p ? p.license : 'none', p ? { title: 'Photo', lines: [`${p.credit}, ${p.license}`], links: [{ label: 'Source', url: p.pageUrl }] } : { title: 'No verified photo', lines: ['No photo with a verified source and license is available, so none is shown.'] });
  },
};

const get_polling: Tool<{ raceId: string; since?: string; limit?: number }> = {
  name: 'get_polling',
  description: 'The underlying polls for a race, exactly as published.',
  input: z.object({ raceId: raceIdSchema, since: dateSchema.optional(), limit: z.number().int().min(1).max(100).optional() }),
  run: (env, i) => {
    const r = env.data.races.find((x) => x.id === i.raceId);
    let polls = sortPolls(env.data.polls.filter((p) => p.raceId === i.raceId));
    if (i.since) polls = polls.filter((p) => p.endDate >= i.since!);
    if (i.limit) polls = polls.slice(0, i.limit);
    return mk(env, 'get_polling', 'poll', 'VoteHub (CC BY 4.0); each poll links to its original source', {
      title: `${r?.label ?? i.raceId}: ${polls.length} poll${polls.length === 1 ? '' : 's'}${i.since ? ` since ${i.since}` : ''}`,
      lines: polls.length ? [] : ['No polls on file for this selection.'],
      table: polls.length && r ? { head: ['Pollster', 'Field dates', 'Sample', 'Result', 'Link'], rows: polls.map((p) => [p.pollster + (p.internal ? ' (internal)' : ''), `${p.startDate} to ${p.endDate}`, `${p.sampleSize ?? '–'} ${(p.population ?? '').toUpperCase()}`, p.results.map((x) => `${candName(r, x.candidateId).split(' ').slice(-1)[0]} ${x.pct}`).join(' · '), p.url ?? 'no link']) } : undefined,
    });
  },
};

const get_poll_average: Tool<{ raceId: string; asOf?: string }> = {
  name: 'get_poll_average',
  description: 'Deterministic average of the polls under the current method (optionally as of a past date).',
  input: z.object({ raceId: raceIdSchema, asOf: dateSchema.optional() }),
  run: (env, i) => {
    const r = env.data.races.find((x) => x.id === i.raceId);
    if (!r) return mk(env, 'get_poll_average', 'computed', 'Elecia', { title: 'Race not found', lines: [] });
    const at = i.asOf ? Date.parse(i.asOf + 'T23:59:59Z') : env.nowMs;
    const polls = env.data.polls.filter((p) => p.raceId === r.id && (!i.asOf || p.endDate <= i.asOf));
    const o = evaluatePolls(polls, r.candidates, env.settings, at);
    return mk(env, 'get_poll_average', 'computed', 'Elecia, computed from the polls shown', {
      title: `${r.label}${i.asOf ? ` as of ${i.asOf}` : ''}`,
      lines: [`Method: ${describeMethod(env.settings)}.`, o.status === 'no-polls' ? 'No polls available under this method.' : o.averages.map((a) => `${candName(r, a.candidateId)} ${pctText(a.pct)}% (${a.pollsCounted} polls)`).join(' · '), o.status === 'tie' ? `Tie under your tie setting (lead ${o.margin} pts).` : o.status === 'leader' ? `Leader: ${candName(r, o.leaderId!)} by ${o.margin} pts.` : ''].filter(Boolean),
    });
  },
};

const get_poll_methodology: Tool<Record<string, never>> = {
  name: 'get_poll_methodology',
  description: 'Describe the active polling method.',
  input: z.object({}),
  run: (env) => mk(env, 'get_poll_methodology', 'computed', 'Elecia settings', { title: 'Polling method', lines: [describeMethod(env.settings) + '.', 'Averages are computed here from the individual polls; the poll source does not publish its own average.'] }),
};

const get_historical_results: Tool<{ raceId: string }> = {
  name: 'get_historical_results',
  description: 'Previous results for this seat as listed on Wikipedia.',
  input: z.object({ raceId: raceIdSchema }),
  run: (env, i) => {
    const h = env.research?.races[i.raceId]?.history ?? [];
    return mk(env, 'get_historical_results', 'record', 'Wikipedia', {
      title: `${raceName(env, i.raceId)}: past results`,
      lines: h.length ? [] : ['No previous result could be read for this race.'],
      table: h.length ? { head: ['Election', 'Candidate', 'Party', 'Share'], rows: h.flatMap((e) => e.results.map((x) => [e.title, x.name, x.party, x.pct === null ? '–' : `${x.pct}%`])) } : undefined,
      links: h.map((e) => ({ label: e.title, url: e.url })),
    });
  },
};

const get_ratings: Tool<{ raceId: string }> = {
  name: 'get_ratings',
  description: 'Analyst classifications as listed on Wikipedia (not Elecia’s view).',
  input: z.object({ raceId: raceIdSchema }),
  run: (env, i) => {
    const r = env.research?.races[i.raceId];
    return mk(env, 'get_ratings', 'rating', 'Wikipedia, citing each organization', {
      title: `${raceName(env, i.raceId)}: analyst ratings`,
      lines: r?.ratings.length ? ['These are the named organizations’ own classifications.'] : ['No ratings are listed for this race.'],
      table: r?.ratings.length ? { head: ['Organization', 'Rating', 'As of'], rows: r.ratings.map((x) => [x.source, x.rating, x.asOf]) } : undefined,
    });
  },
};

const get_ballot_questions: Tool<{ state?: string }> = {
  name: 'get_ballot_questions',
  description: 'Statewide ballot measures and what a yes vote does, in the source’s words.',
  input: z.object({ state: stateSchema.optional() }),
  run: (env, i) => {
    const qs = env.data.ballot.filter((q) => !i.state || q.state === i.state);
    return mk(env, 'get_ballot_questions', 'record', 'Wikipedia: 2026 United States ballot measures', {
      title: `${qs.length} ballot question${qs.length === 1 ? '' : 's'}`,
      lines: ['A yes vote’s effect is the source’s wording. The source does not say what a no vote does.'],
      table: { head: ['State', 'Measure', 'A yes vote would'], rows: qs.slice(0, 40).map((q) => [q.stateName, q.title, q.yesMeans.slice(0, 220)]) },
    });
  },
};

const get_ballot_question_polling: Tool<{ id: string }> = {
  name: 'get_ballot_question_polling',
  description: 'Polling on a measure, if any exists in the poll source.',
  input: z.object({ id: z.string().min(3).max(80) }),
  run: (env) => mk(env, 'get_ballot_question_polling', 'poll', 'VoteHub', { title: 'Ballot measure polling', lines: ['No polling for 2026 statewide ballot measures is available from the poll source.'] }),
};

const get_recent_race_changes: Tool<{ days: number; chamber?: Race['chamber'] }> = {
  name: 'get_recent_race_changes',
  description: 'Races that received new polls in the last N days.',
  input: z.object({ days: z.number().int().min(1).max(365), chamber: z.enum(['senate', 'house', 'governor']).optional() }),
  run: (env, i) => {
    const since = iso(env.nowMs - i.days * DAY).slice(0, 10);
    const by = new Map<string, { n: number; latest: string; pollster: string }>();
    for (const p of env.data.polls) {
      if (p.releasedDate < since) continue;
      const r = env.data.races.find((x) => x.id === p.raceId);
      if (!r || (i.chamber && r.chamber !== i.chamber)) continue;
      const cur = by.get(p.raceId);
      if (!cur) by.set(p.raceId, { n: 1, latest: p.releasedDate, pollster: p.pollster });
      else { cur.n += 1; if (p.releasedDate > cur.latest) { cur.latest = p.releasedDate; cur.pollster = p.pollster; } }
    }
    const rows = [...by].sort((a, b) => b[1].latest.localeCompare(a[1].latest));
    return mk(env, 'get_recent_race_changes', 'poll', 'VoteHub release dates', {
      title: `${rows.length} race${rows.length === 1 ? '' : 's'} with new polls since ${since}`,
      lines: [],
      table: { head: ['Race', 'New polls', 'Latest release', 'Latest pollster'], rows: rows.slice(0, 40).map(([id, v]) => [raceName(env, id), String(v.n), v.latest, v.pollster]) },
    });
  },
};

const compare_races: Tool<{ raceIds: string[] }> = {
  name: 'compare_races',
  description: 'Side-by-side facts (polling, last results, ratings). No ranking.',
  input: z.object({ raceIds: z.array(raceIdSchema).min(2).max(6) }),
  run: (env, i) => {
    const rows = i.raceIds.map((id) => {
      const r = env.data.races.find((x) => x.id === id);
      if (!r) return [id, '–', '–', '–'];
      const o = evaluatePolls(env.data.polls.filter((p) => p.raceId === id), r.candidates, env.settings, env.nowMs);
      const prev = env.research?.races[id]?.history[0];
      return [r.label, o.status === 'no-polls' ? 'no polls' : o.leaderId ? `${candName(r, o.leaderId)} +${o.margin}` : `tie (${o.margin})`, prev ? `${prev.title}: ${prev.results.map((x) => `${x.name} ${x.pct ?? '–'}%`).join(', ')}` : '–', String(env.research?.races[id]?.ratings.length ?? 0)];
    });
    return mk(env, 'compare_races', 'computed', 'Polls, Wikipedia', { title: 'Comparison', lines: [`Polling uses: ${describeMethod(env.settings)}.`], table: { head: ['Race', 'Polling', 'Previous result', 'Ratings listed'], rows } });
  },
};

const get_user_predictions: Tool<{ mode: 'forecast' | 'endorse'; staleFirst?: boolean }> = {
  name: 'get_user_predictions',
  description: 'The user’s own calls or endorsements.',
  input: z.object({ mode: z.enum(['forecast', 'endorse']), staleFirst: z.boolean().optional() }),
  run: (env, i) => {
    const picks = Object.values(i.mode === 'forecast' ? env.picks.forecast : env.picks.endorse).sort((a, b) => (i.staleFirst ? a.madeAt.localeCompare(b.madeAt) : b.madeAt.localeCompare(a.madeAt)));
    return mk(env, 'get_user_predictions', 'user', 'Your data, stored in this browser', {
      title: `${picks.length} ${i.mode === 'forecast' ? 'forecast' : 'endorsement'}${picks.length === 1 ? '' : 's'}${i.staleFirst ? ', oldest first' : ''}`,
      lines: picks.length ? [] : ['You have not made any yet.'],
      table: picks.length ? { head: ['Race', 'Pick', 'Made'], rows: picks.slice(0, 40).map((p) => { const r = env.data.races.find((x) => x.id === p.raceId); return [r?.label ?? p.raceId, p.candidateId && r ? candName(r, p.candidateId) : `Other (${p.party})`, p.madeAt.slice(0, 16).replace('T', ' ') + ' UTC']; }) } : undefined,
    });
  },
};

const calculate_makeup: Tool<{ useScope?: boolean }> = {
  name: 'calculate_makeup',
  description: 'Seat totals from the user’s forecast (deterministic).',
  input: z.object({ useScope: z.boolean().optional() }),
  run: (env, i) => {
    const ids = new Set((i.useScope === false ? env.data.races : resolveScope(env.scope, env.data, env.settings, env.nowMs)).map((r) => r.id));
    const picks = new Map(Object.entries(env.picks.forecast));
    const rows = (['senate', 'house', 'governor'] as const).map((c) => { const m = computeMakeup(c, env.data, ids, picks); return [c === 'senate' ? 'Senate' : c === 'house' ? 'House' : 'Governors', `${m.total.D} D`, `${m.total.R} R`, `${m.total.O} other`, `${m.uncalled} uncalled`]; });
    return mk(env, 'calculate_makeup', 'computed', 'Elecia, from your calls', { title: 'Your forecast totals', lines: ['Ballot questions are never included in these totals.'], table: { head: ['Chamber', 'D', 'R', 'Other', 'Not yet called'], rows } });
  },
};

const calculate_forecast_statistics: Tool<Record<string, never>> = {
  name: 'calculate_forecast_statistics',
  description: 'Counts about the user’s own forecast.',
  input: z.object({}),
  run: (env) => {
    const f = Object.values(env.picks.forecast);
    const byOrigin = f.filter((p) => p.origin === 'rule:polling').length;
    const oldest = [...f].sort((a, b) => a.madeAt.localeCompare(b.madeAt))[0];
    return mk(env, 'calculate_forecast_statistics', 'user', 'Your data', { title: 'Forecast statistics', lines: [`${f.length} races called (${f.length - byOrigin} by you, ${byOrigin} from the polling rule).`, `${Object.keys(env.picks.ballotForecast).length} ballot questions forecast.`, oldest ? `Oldest call: ${oldest.madeAt.slice(0, 16).replace('T', ' ')} UTC (${raceName(env, oldest.raceId)}).` : 'No calls yet.'] });
  },
};

const get_real_results: Tool<{ raceId?: string }> = {
  name: 'get_real_results',
  description: 'Reported results and evidence-confirmed calls.',
  input: z.object({ raceId: raceIdSchema.optional() }),
  run: (env, i) => {
    const calls = new Map(env.calls.calls.map((c) => [c.raceId, c]));
    const races = env.data.races.filter((r) => !i.raceId || r.id === i.raceId);
    const rows = races.map((r) => { const v = judgeCall(calls.get(r.id), r); return [r.label, v.called ? `${candName(r, v.winnerId)} (${v.reason})` : 'not called', r.reported.afterName ? `${r.reported.afterName} (unverified, from Wikipedia)` : '–']; });
    const bq: string[][] = env.data.ballot.filter((q) => !i.raceId || q.id === i.raceId).map((q) => { const v = judgeBallotCall(calls.get(q.id), q); return [q.title, v.called ? `${v.winnerId} (${v.reason})` : 'not called', q.status]; });
    return mk(env, 'get_real_results', 'record', 'Official or two-source confirmation; Wikipedia as unverified', { title: 'Results', lines: ['A race is called only with an official source or two independent news sources.'], table: { head: ['Race', 'Called result', 'Reported by Wikipedia'], rows: [...rows, ...bq].slice(0, 60) } });
  },
};

const apply_polling_rule: Tool<Record<string, never>> = {
  name: 'apply_polling_rule',
  description: 'Propose calls for uncalled races where polling has a clear leader. Does not save.',
  input: z.object({}),
  run: (env) => {
    const inScope = resolveScope(env.scope, env.data, env.settings, env.nowMs);
    const picks: { raceId: string; candidateId: string; party: Party }[] = [];
    let left = 0;
    for (const r of inScope) {
      if (env.picks.forecast[r.id]) continue;
      const o = evaluatePolls(env.data.polls.filter((p) => p.raceId === r.id), r.candidates, env.settings, env.nowMs);
      if (o.status === 'leader' && o.leaderId && o.leaderParty) picks.push({ raceId: r.id, candidateId: o.leaderId, party: o.leaderParty }); else left += 1;
    }
    const res = mk(env, 'apply_polling_rule', 'computed', 'Elecia, polling rule', { title: `Polling rule would call ${picks.length} race${picks.length === 1 ? '' : 's'}`, lines: [`${left} would stay yours to decide (tie, no polls, or already called).`, `Method: ${describeMethod(env.settings)}.`] });
    res.proposal = { kind: 'picks', picks };
    return res;
  },
};

const save_user_prediction: Tool<{ raceId: string; candidateId: string | null; party: 'D' | 'R' | 'O'; userConfirmed: true }> = {
  name: 'save_user_prediction',
  description: 'Save a call the USER stated. Requires explicit user confirmation; the assistant never chooses.',
  input: z.object({ raceId: raceIdSchema, candidateId: z.string().nullable(), party: z.enum(['D', 'R', 'O']), userConfirmed: z.literal(true) }),
  run: (env, i) => {
    const r = env.data.races.find((x) => x.id === i.raceId);
    if (!r || !env.savePick) return mk(env, 'save_user_prediction', 'user', 'Your data', { title: 'Could not save', lines: ['That race was not found, or saving is unavailable.'] });
    const ok = env.savePick(r, i.candidateId, i.party);
    return mk(env, 'save_user_prediction', 'user', 'Your data', { title: ok ? `Saved your call for ${r.label}` : 'Not saved', lines: [ok ? `Your forecast: ${i.candidateId ? candName(r, i.candidateId) : 'Someone else'} (${i.party}).` : 'Predictions are closed.'] });
  },
};

const search_news: Tool<{ raceId?: string }> = {
  name: 'search_news',
  description: 'Recent reporting about a race (headline, publisher, date, link only).',
  input: z.object({ raceId: raceIdSchema.optional() }),
  run: (env, i) => {
    const r = i.raceId ? env.data.races.find((x) => x.id === i.raceId) : undefined;
    const res = mk(env, 'search_news', 'news', 'GDELT, live', r
      ? { title: `Recent reporting: ${r.label}`, lines: ['Looking up headlines from the last 7 days…'] }
      : { title: 'News search', lines: ['Name a state and a race, for example "Find recent reporting about the Georgia Senate race".'] });
    if (r) res.liveNews = { raceId: r.id };
    return res;
  },
};

export const TOOLS = {
  search_races, get_race, search_candidates, get_candidate_bio, get_candidate_photo, get_polling, get_poll_average, get_poll_methodology,
  get_historical_results, get_ratings, get_ballot_questions, get_ballot_question_polling, get_recent_race_changes, compare_races,
  get_user_predictions, calculate_makeup, calculate_forecast_statistics, get_real_results, apply_polling_rule, save_user_prediction, search_news,
} as const;

export type ToolName = keyof typeof TOOLS;

/** Validate input with the tool's own schema, then run it. Bad input never reaches the tool. */
export function callTool(env: ToolEnv, name: ToolName, input: unknown): ToolResult {
  const tool = TOOLS[name] as Tool<unknown>;
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) return mk(env, name, 'computed', 'Elecia', { title: 'That request could not be understood', lines: [parsed.error.issues.map((x) => x.message).join('; ').slice(0, 200)] });
  return tool.run(env, parsed.data);
}

export type { PollMethod, BallotQuestion };
