import type { Dataset, Race } from '../data/schema';
import { STATES, USPS_BY_NAME } from '../data/states';
import type { PollSettings } from '../domain/polling';
import type { Clause, Scope } from '../domain/scope';
import type { ToolName } from '../tools';

/** What the assistant will do with a request. Parsing is plain rules: no model, nothing to leak. */
export type Action =
  | { type: 'tool'; name: ToolName; input: Record<string, unknown>; note?: string }
  | { type: 'multi'; calls: { name: ToolName; input: Record<string, unknown> }[]; note?: string }
  | { type: 'set-scope'; scope: Scope }
  | { type: 'set-method'; patch: Partial<Pick<PollSettings, 'excludeInternal' | 'tieBand'>> & { method?: PollSettings['method'] } }
  | { type: 'what-if'; method: PollSettings['method'] }
  | { type: 'apply-polling' }
  | { type: 'call-current'; party: 'D' | 'R' | 'O' }
  | { type: 'defer-current' }
  | { type: 'help' }
  | { type: 'unsupported'; why: string };

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30 };
const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return WORD_NUM[t] ?? null;
};

const NAMES = Object.values(STATES).sort((a, b) => b.length - a.length);
const SKIP_ABBR = new Set(['IN', 'OR', 'ME', 'OK', 'HI', 'OH', 'AS', 'IT', 'IS', 'SO', 'TO', 'DO', 'AN', 'AM', 'AT', 'BY', 'GO', 'IF', 'NO', 'OF', 'ON', 'UP', 'US', 'WE', 'ID']);
const MONTHS: Record<string, string> = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };

export function findStates(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  let rest = lower;
  for (const n of NAMES) {
    const re = new RegExp(`\\b${n.toLowerCase()}\\b`, 'g');
    if (re.test(rest)) {
      // "West Virginia" must not also count as "Virginia".
      out.push(USPS_BY_NAME[n]!);
      rest = rest.replace(new RegExp(`\\b${n.toLowerCase()}\\b`, 'g'), ' ');
    }
  }
  for (const m of text.matchAll(/\b([A-Z]{2})\b/g)) {
    const code = m[1]!;
    if (!SKIP_ABBR.has(code) && STATES[code] && !out.includes(code)) out.push(code);
  }
  return out;
}

const chamberOf = (t: string): ('senate' | 'house' | 'governor')[] => {
  const out: ('senate' | 'house' | 'governor')[] = [];
  if (/\bsenat/.test(t)) out.push('senate');
  if (/\bhouse\b|\bcongress(ional)?\b|\bdistricts?\b|\brepresentatives?\b/.test(t)) out.push('house');
  if (/\bgovernors?\b|\bgubernatorial\b/.test(t)) out.push('governor');
  return out;
};

/** Parse "latest three polls", "last 3 weeks", etc. */
export function parseMethod(t: string): PollSettings['method'] | null {
  const n = (s: string) => num(s);
  let m: RegExpExecArray | null;
  if ((m = /\blatest\s+(\d+|[a-z]+)(?:\s+polls?)?\b/.exec(t)) && n(m[1]!) !== null) return { kind: 'latestN', n: n(m[1]!)! };
  if ((m = /\b(?:last|past)\s+(\d+|[a-z]+)\s+(day|days|week|weeks)\b/.exec(t)) && n(m[1]!) !== null) return { kind: 'window', days: n(m[1]!)! * (m[2]!.startsWith('week') ? 7 : 1) };
  if (/\b(only )?(the )?latest (poll|one)\b|\bmost recent poll\b|\blatest only\b/.test(t)) return { kind: 'latest' };
  if (/\ball (the )?polls\b|\bevery poll\b/.test(t)) return { kind: 'all' };
  return null;
}

function parseDate(t: string, nowYear: number): string | null {
  let m = /\b(?:since|after|from)\s+(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /\b(?:since|after|from|in|as of)\s+([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/.exec(t);
  if (m && MONTHS[m[1]!]) return `${m[3] ?? nowYear}-${MONTHS[m[1]!]}-${m[2]!.padStart(2, '0')}`;
  m = /\b(?:since|from|in|as of|compared? with|with|to|vs\.?)\s+([a-z]+)\b/.exec(t);
  if (m && MONTHS[m[1]!]) return `${nowYear}-${MONTHS[m[1]!]}-01`;
  return null;
}

function buildScope(text: string, t: string): Scope | null {
  const parts = t.split(/\bbut\b|;|\bplus\b|\balso\b/).map((x) => x.trim()).filter(Boolean);
  const original = text.split(/\bbut\b|;|\bplus\b|\balso\b/i);
  const include: Clause[] = [];
  parts.forEach((part, idx) => {
    const c: Clause = {};
    const ch = chamberOf(part);
    const states = findStates(original[idx] ?? part);
    if (ch.length) c.chambers = ch;
    if (states.length) c.states = states;
    if (/\b(competitive|close|toss.?up|tight|battleground|swing)\b/.test(part)) c.closeWithin = 5;
    if (/\bcould (determine|decide|control|swing)\b/.test(part)) { c.closeWithin = 5; if (!c.chambers) c.chambers = ['senate']; }
    if (/\bwith polling\b|\bthat (have|has) polling\b|\bpolled\b/.test(part)) c.hasPolling = true;
    const held = /\bheld by (democrats?|republicans?)\b/.exec(part);
    if (held) c.seatHeldBy = held[1]!.startsWith('d') ? 'D' : 'R';
    if (/\b(no|without) ballot (questions?|measures?)\b/.test(part)) c.ballot = false;
    if (Object.keys(c).length) include.push(c);
    else if (/\ball\b|\beverything\b/.test(part)) include.push({});
  });
  return include.length ? { include, exclude: [] } : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

export function parseRequest(text: string, data: Dataset, nowMs: number): Action {
  const t = norm(text);
  const year = new Date(nowMs).getUTCFullYear();
  const states = findStates(text);
  const chambers = chamberOf(t);

  if (!t || /^(help|hi|hello|hey|\?|what can you do)/.test(t)) return { type: 'help' };
  if (/\b(come back later|skip (this|it)|ask me later|not now)\b/.test(t)) return { type: 'defer-current' };
  const calling = /\b(?:i'?m|i am|i will|let'?s|go ahead and)?\s*(?:calling|call|going with|picking|forecasting)\s+(?:this|it|that race)\s+(?:as\s+|for\s+|a\s+)?(democrat(?:ic)?|republican|gop|other|independent)\b/.exec(t);
  if (calling) return { type: 'call-current', party: calling[1]!.startsWith('d') ? 'D' : calling[1]!.startsWith('o') || calling[1]!.startsWith('i') ? 'O' : 'R' };
  if (/\b(go with|use|follow|apply)\b.{0,25}\b(whatever )?(the )?polling( says| shows| rule)?\b/.test(t) && !/\bmethod|average\b/.test(t)) return { type: 'apply-polling' };

  // what-if comparisons: "what happens if I use the latest three instead"
  if (/\b(what (happens|if|about)|compare|instead|would change|switch to)\b/.test(t) && parseMethod(t) && !/\bsince\b/.test(t)) return { type: 'what-if', method: parseMethod(t)! };

  // polling method changes
  const method = parseMethod(t);
  const wantsMethod = /\b(use|average|only use|only|switch|set|apply|count|take)\b/.test(t) && method && /\bpolls?\b/.test(t);
  const internal = /\b(exclude|leave out|without|ignore|drop|skip)\b.{0,15}\b(internal|partisan)\b/.test(t) ? true : /\b(include|add back)\b.{0,15}\b(internal|partisan)\b/.test(t) ? false : null;
  const tie = /\bties?\b.{0,20}\b(?:within|at most|under|of|up to)\s+(\d+(?:\.\d+)?)/.exec(t);
  if (wantsMethod || internal !== null || tie) {
    return { type: 'set-method', patch: { ...(wantsMethod ? { method: method! } : {}), ...(internal !== null ? { excludeInternal: internal } : {}), ...(tie ? { tieBand: Number(tie[1]) } : {}) } };
  }

  // my own data
  if (/\b(my|i have|i've)\b.{0,25}\b(endorsements?)\b/.test(t)) return { type: 'tool', name: 'get_user_predictions', input: { mode: 'endorse' } };
  if (/\b(revisited|reviewed|stale|oldest|haven'?t (revisited|looked)|not been revisited)\b/.test(t) && /\b(calls?|forecasts?|predictions?)\b/.test(t)) return { type: 'tool', name: 'get_user_predictions', input: { mode: 'forecast', staleFirst: true } };
  if (/\b(my|i have|i've|how many)\b.{0,25}\b(calls?|forecasts?|predictions?|called)\b/.test(t)) return /\bhow many\b/.test(t) ? { type: 'tool', name: 'calculate_forecast_statistics', input: {} } : { type: 'tool', name: 'get_user_predictions', input: { mode: 'forecast' } };
  if (/\b(makeup|seat count|totals?|how many seats|my forecast so far)\b/.test(t)) return { type: 'tool', name: 'calculate_makeup', input: {} };

  if (/\bpresidential\b/.test(t)) return { type: 'unsupported', why: 'Presidential results by district are not part of this site’s data in this release.' };

  // results
  if (/\b(results?|who won|winner|called result|was it called)\b/.test(t)) {
    const r = pickRace(data, states, chambers);
    return { type: 'tool', name: 'get_real_results', input: r ? { raceId: r.id } : {} };
  }

  // ballot
  if (/\b(ballot|measure|proposition|amendment|initiative|referendum|yes vote|question)s?\b/.test(t)) {
    if (/\bpoll/.test(t)) return { type: 'tool', name: 'get_ballot_question_polling', input: { id: 'any' } };
    return { type: 'tool', name: 'get_ballot_questions', input: states[0] ? { state: states[0] } : {} };
  }

  // news
  if (/\b(news|reporting|headlines?|articles?|coverage|reported)\b/.test(t)) return { type: 'tool', name: 'search_news', input: {} };

  // new polling
  const recent = /\b(?:new|recent|latest|fresh)\b.{0,25}\b(poll|polling)\b.{0,30}\b(?:last|past|in the)\s+(\d+|[a-z]+)\s+(day|days|week|weeks)\b/.exec(t) ?? /\b(received|got|have|with)\b.{0,15}\b(new|recent)\b.{0,15}\b(poll|polling)\b.{0,30}\b(?:last|past)\s+(\d+|[a-z]+)\s+(day|days|week|weeks)\b/.exec(t);
  if (recent) {
    const nStr = recent[recent.length - 2]!;
    const unit = recent[recent.length - 1]!;
    const n = num(nStr);
    if (n !== null) return { type: 'tool', name: 'get_recent_race_changes', input: { days: n * (unit.startsWith('week') ? 7 : 1), ...(chambers.length === 1 ? { chamber: chambers[0] } : {}) } };
  }
  if (/\bwhat changed\b|\bnew since\b|\bsince the last poll\b/.test(t) && states.length) {
    const asOf = parseDate(t, year);
    const race = pickRace(data, states, chambers);
    if (race) return { type: 'multi', calls: [{ name: 'get_polling', input: { raceId: race.id, limit: 3 } }, { name: 'get_poll_average', input: { raceId: race.id } }], note: asOf ?? undefined };
  }

  // compare "polling now with August"
  if (/\bcompare\b.{0,30}\b(polling|poll|average)\b/.test(t)) {
    const asOf = parseDate(t, year);
    const race = pickRace(data, states, chambers);
    if (asOf && race) return { type: 'multi', calls: [{ name: 'get_poll_average', input: { raceId: race.id } }, { name: 'get_poll_average', input: { raceId: race.id, asOf } }], note: `Now compared with ${asOf}` };
    return { type: 'unsupported', why: 'Name a state and a month, for example "Compare Georgia polling now with August".' };
  }
  if (/\bcompare\b/.test(t) && states.length >= 2) {
    const ids = states.slice(0, 4).map((s) => pickRace(data, [s], chambers)?.id).filter((x): x is string => !!x);
    if (ids.length >= 2) return { type: 'tool', name: 'compare_races', input: { raceIds: ids } };
  }

  // competitiveness by polling
  if (/\b(closest|most competitive|tightest|toss.?ups?|within \d+ points?|margin)\b/.test(t) && !/\bset|scope|focus|only\b/.test(t)) {
    const within = /\bwithin\s+(\d+|[a-z]+)\s+points?\b/.exec(t);
    return { type: 'tool', name: 'search_races', input: { ...(chambers.length === 1 ? { chamber: chambers[0] } : {}), ...(states.length ? { states } : {}), ...(within && num(within[1]) !== null ? { closeWithin: num(within[1])! } : { closeWithin: 10 }), hasPolling: true } };
  }

  // polls
  if (/\b(polls?|polling)\b/.test(t) && (states.length || chambers.length)) {
    const race = pickRace(data, states, chambers);
    if (race) {
      const since = parseDate(t, year);
      const n = method?.kind === 'latestN' ? method.n : method?.kind === 'latest' ? 1 : undefined;
      return { type: 'tool', name: 'get_polling', input: { raceId: race.id, ...(since ? { since } : {}), ...(n ? { limit: n } : {}) } };
    }
  }

  // ratings / history
  if (/\b(rating|ratings|rated|classification|cook|sabato|inside elections)\b/.test(t)) {
    const race = pickRace(data, states, chambers);
    if (race) return { type: 'tool', name: 'get_ratings', input: { raceId: race.id } };
  }
  if (/\b(past|previous|historical|history|last time|2024|2022|2020|2018)\b/.test(t) && /\b(result|results|election|vote|won|margin)\b/.test(t)) {
    if (/\bpresidential\b/.test(t)) return { type: 'unsupported', why: 'Presidential results by district are not part of this site’s data in this release.' };
    const race = pickRace(data, states, chambers);
    if (race) return { type: 'tool', name: 'get_historical_results', input: { raceId: race.id } };
  }

  // candidates and biographies
  const lastWord = (n: string) => n.split(/\s+/).pop()!.toLowerCase();
  const people = data.races.flatMap((r) => r.candidates.map((c) => ({ r, c })));
  const named = people.find(({ c }) => t.includes(c.name.toLowerCase())) ?? (/\b(about|biography|bio of|who is|background)\b/.test(t) ? people.find(({ c }) => new RegExp(`\\b${lastWord(c.name).replace(/[^a-z]/g, '')}\\b`).test(t) && lastWord(c.name).length > 3) : undefined);
  if (named) return { type: 'tool', name: 'get_candidate_bio', input: { candidateId: named.c.id } };
  if (/\b(candidates?|nominees?|who is running|who'?s running|who are)\b/.test(t) && states.length) {
    const race = pickRace(data, states, chambers);
    if (race) return { type: 'tool', name: 'get_race', input: { raceId: race.id } };
  }

  // scope requests (last, so factual questions win)
  if (/\b(only|just|focus|focusing|limit|restrict|show me all|all|everything|scope)\b/.test(t) && (states.length || chambers.length)) {
    const scope = buildScope(text, t);
    if (scope) return { type: 'set-scope', scope };
  }
  if (states.length === 1 && chambers.length <= 1) {
    const race = pickRace(data, states, chambers);
    if (race) return { type: 'tool', name: 'get_race', input: { raceId: race.id } };
  }
  return { type: 'unsupported', why: 'I did not recognize that request.' };
}

function pickRace(data: Dataset, states: string[], chambers: ('senate' | 'house' | 'governor')[]): Race | undefined {
  const st = states[0];
  if (!st) return undefined;
  const order = chambers.length ? chambers : (['senate', 'governor', 'house'] as const);
  for (const c of order) {
    const hit = data.races.find((r) => r.state === st && r.chamber === c);
    if (hit) return hit;
  }
  return undefined;
}

export const EXAMPLES = [
  'Just focus on Georgia',
  'All Senate races, but only competitive House races in PA, MI and WI',
  'Show me the latest three Georgia polls',
  'Average the latest three polls',
  'Only use polls from the last three weeks',
  'Which Senate races received new polling in the last seven days?',
  'Compare Georgia polling now with August',
  'What were the past results in Ohio?',
  'Show analyst ratings for Maine',
  'Tell me about Sherrod Brown',
  'Which of my calls have not been revisited recently?',
  'Go with whatever the polling says',
];
