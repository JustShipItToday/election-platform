import { ctx, esc, scopeRaces, picksFor, ballotPicks, persist } from '../ctx';
import { now } from '../domain/clock';
import { classify, outputIsSafe, REFUSAL_ADVICE, REFUSAL_EXTRACTION } from '../assistant/policy';
import { EXAMPLES, parseRequest, type Action } from '../assistant/grammar';
import { callTool, TOOLS, type ToolEnv, type ToolName, type ToolResult } from '../tools';
import { describeMethod, evaluatePolls, type PollMethod, type PollSettings } from '../domain/polling';
import { describeScope, type Scope } from '../domain/scope';
import type { Race } from '../data/schema';
import { getResearch, newsListHtml } from './research';
import { fetchNews } from '../news/gdelt';
import { registerActions } from './actions';

/** What the assistant may ask the page to do. Writes go through the same gated functions as the buttons. */
export interface FlowApi {
  mode: () => 'forecast' | 'endorse';
  writable: () => boolean;
  setScope: (scope: Scope) => void;
  setPoll: (fn: (s: PollSettings) => PollSettings) => void;
  currentRace: () => Race | undefined;
  pickCurrent: (candidateId: string | null, party: 'D' | 'R' | 'O') => boolean;
  deferCurrent: () => void;
  applyPollingRule: () => { called: number; left: number };
}

interface Msg {
  who: 'you' | 'helper';
  text?: string;
  results?: ToolResult[];
  /** Extra HTML appended after the results (for example live headlines). */
  extraHtml?: string;
  undo?: { label: string; fn: () => void };
  chips?: string[];
}

let api: FlowApi | null = null;
let log: Msg[] = [];
let host: HTMLElement | null = null;
let undoFn: (() => void) | null = null;

const CAT: Record<string, string> = { poll: 'Poll data', record: 'Public record', rating: 'Analyst rating', statement: 'Candidate or campaign statement', news: 'News reporting', user: 'Your data', computed: 'Computed here' };

export function bindAssistant(a: FlowApi): void {
  api = a;
}

function toolEnv(): ToolEnv {
  return {
    data: ctx.data,
    research: getResearch(),
    calls: ctx.calls,
    nowMs: now(),
    settings: ctx.working.pollSettings,
    scope: ctx.working.scope,
    picks: { forecast: ctx.working.forecast, endorse: ctx.working.endorse, ballotForecast: ballotPicks('forecast'), ballotEndorse: ballotPicks('endorse') },
  };
}

function resultHtml(r: ToolResult): string {
  const d = r.display;
  const table = d.table
    ? `<div class="tablewrap"><table class="pt"><thead><tr>${d.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${d.table.rows.map((row) => `<tr>${row.map((c) => `<td>${/^https?:\/\//.test(c) ? `<a href="${esc(c)}" target="_blank" rel="noopener noreferrer">link</a>` : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '';
  const links = d.links?.length ? `<p class="small">${d.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`).join(' · ')}</p>` : '';
  return `<div class="ares"><div class="acat"><span class="tag">${esc(CAT[r.category] ?? r.category)}</span> <span class="muted small">${esc(r.source)} · ${esc(r.retrievedAt.slice(0, 16).replace('T', ' '))} UTC</span></div>
    <strong>${esc(d.title)}</strong>${d.lines.map((l) => `<p class="small">${esc(l)}</p>`).join('')}${table}${links}</div>`;
}

export function renderAssistant(el: HTMLElement): void {
  host = el;
  if (ctx.working.assistantHidden) {
    el.innerHTML = `<p class="small"><button class="link" data-action="asst-show">Show the research helper</button></p>`;
    return;
  }
  const msgs = log
    .map((m) =>
      m.who === 'you'
        ? `<div class="amsg you"><span class="sr">You: </span>${esc(m.text)}</div>`
        : `<div class="amsg helper">${m.text ? `<p>${esc(m.text)}</p>` : ''}${(m.results ?? []).map(resultHtml).join('')}${m.extraHtml ?? ''}${m.chips ? `<p class="chips">${m.chips.map((c) => `<button class="chipbtn" data-action="asst-example" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</p>` : ''}${m.undo ? `<button class="link" data-action="asst-undo">${esc(m.undo.label)}</button>` : ''}</div>`,
    )
    .join('');
  el.innerHTML = `<section class="asst" aria-label="Research helper">
    <div class="asst-head"><h2 class="side-h">Research helper</h2><button class="xbtn" data-action="asst-hide" aria-label="Hide the research helper" title="Hide the research helper">×</button></div>
    <p class="muted small">Answers questions about races, polls, results, ratings and your own calls, always with sources. It is rule-based, not an AI model, and it never advises whom or what to support.</p>
    <div class="alog" role="log" aria-live="polite">${msgs || `<p class="chips">${EXAMPLES.slice(0, 5).map((c) => `<button class="chipbtn" data-action="asst-example" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</p>`}</div>
    <form class="aform" data-action="asst-submit" data-on="submit"><label class="sr" for="asst-q">Ask the research helper</label>
      <input id="asst-q" autocomplete="off" maxlength="300" placeholder="Ask about a race, poll, or your calls"><button class="btn small" type="submit">Ask</button></form></section>`;
  const logEl = el.querySelector('.alog');
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

function push(m: Msg): void {
  log.push(m);
  if (log.length > 30) log = log.slice(-30);
}

function whatIf(method: PollMethod): ToolResult {
  const env = toolEnv();
  const alt: PollSettings = { ...env.settings, method };
  const rows: string[][] = [];
  let changed = 0;
  let compared = 0;
  for (const r of scopeRaces()) {
    const polls = ctx.data.polls.filter((p) => p.raceId === r.id);
    const a = evaluatePolls(polls, r.candidates, env.settings, env.nowMs);
    const b = evaluatePolls(polls, r.candidates, alt, env.nowMs);
    if (a.status === 'no-polls' && b.status === 'no-polls') continue;
    compared += 1;
    const name = (o: typeof a) => (o.status === 'leader' ? `${r.candidates.find((c) => c.id === o.leaderId)?.name ?? '?'} +${o.margin}` : o.status === 'tie' ? `tie (${o.margin})` : 'no polls');
    if (a.leaderId !== b.leaderId || a.status !== b.status) { changed += 1; if (rows.length < 20) rows.push([r.label, name(a), name(b)]); }
  }
  return { tool: 'compare_poll_methods', category: 'computed', source: 'Elecia, computed from the polls on each race', retrievedAt: new Date(env.nowMs).toISOString(), display: { title: `If you used "${describeMethod(alt)}"`, lines: [`${changed} of ${compared} polled races in your scope would change their polling result. Nothing was changed.`], table: rows.length ? { head: ['Race', 'Now', 'With that method'], rows } : undefined } };
}

export function ask(text: string): void {
  if (!api) return;
  push({ who: 'you', text });
  const intent = classify(text);
  if (intent === 'extraction') push({ who: 'helper', text: REFUSAL_EXTRACTION });
  else if (intent === 'advice') push({ who: 'helper', text: REFUSAL_ADVICE });
  else {
    const msg = respond(parseRequest(text, ctx.data, now()));
    push(msg);
    const live = msg.results?.find((r) => r.liveNews);
    const race = live ? ctx.data.races.find((r) => r.id === live.liveNews!.raceId) : undefined;
    if (race) {
      fetchNews(race)
        .then((r) => { msg.extraHtml = newsListHtml(r.items, r.url, r.cached); if (host) renderAssistant(host); })
        .catch(() => { msg.extraHtml = '<p class="muted small">The news service is busy or unreachable. Try again in a few seconds.</p>'; if (host) renderAssistant(host); });
    }
  }
  if (host) renderAssistant(host);
}

function respond(a: Action): Msg {
  const env = toolEnv();
  const A = api!;
  const mode = A.mode();
  switch (a.type) {
    case 'help':
      return { who: 'helper', text: 'Try one of these. Every answer shows its source.', chips: EXAMPLES };
    case 'unsupported':
      return { who: 'helper', text: `${a.why} I can answer factual questions about races, polls, ratings, past results, candidates and your own calls.`, chips: EXAMPLES.slice(0, 6) };
    case 'tool':
      return { who: 'helper', results: [callTool(env, a.name, a.input)] };
    case 'multi':
      return { who: 'helper', text: a.note, results: a.calls.map((c) => callTool(env, c.name, c.input)) };
    case 'what-if':
      return { who: 'helper', results: [whatIf(a.method)] };
    case 'set-scope': {
      const prev = structuredClone(ctx.working.scope);
      A.setScope(a.scope);
      return { who: 'helper', text: `Scope set to: ${describeScope(a.scope)}.${a.scope.include.some((c) => c.closeWithin !== undefined) ? ' "Competitive" means a polling margin within 5 points.' : ''} You can edit this in the sidebar.`, undo: { label: 'Undo scope change', fn: () => A.setScope(prev) } };
    }
    case 'set-method': {
      const prev = structuredClone(ctx.working.pollSettings);
      A.setPoll((s) => ({ ...s, ...(a.patch.method ? { method: a.patch.method } : {}), ...(a.patch.excludeInternal !== undefined ? { excludeInternal: a.patch.excludeInternal } : {}), ...(a.patch.tieBand !== undefined ? { tieBand: a.patch.tieBand } : {}) }));
      return { who: 'helper', text: `Polling method is now: ${describeMethod(ctx.working.pollSettings)}.`, undo: { label: 'Undo method change', fn: () => A.setPoll(() => prev) } };
    }
    case 'apply-polling': {
      if (mode !== 'forecast') return { who: 'helper', text: 'Endorsements are recorded with the buttons on each card, not through the helper. The polling rule applies to forecasts only.' };
      if (!A.writable()) return { who: 'helper', text: 'Predictions are closed.' };
      const r = A.applyPollingRule();
      return { who: 'helper', text: `Polling called ${r.called} race${r.called === 1 ? '' : 's'}; ${r.left} stay yours to decide. Method: ${describeMethod(ctx.working.pollSettings)}.` };
    }
    case 'call-current': {
      if (mode !== 'forecast') return { who: 'helper', text: 'Endorsements are recorded with the buttons on each card, not through the helper.' };
      if (!A.writable()) return { who: 'helper', text: 'Predictions are closed.' };
      const race = A.currentRace();
      if (!race) return { who: 'helper', text: 'There is no race open to call right now.' };
      const cand = race.candidates.find((c) => c.party === a.party);
      if (!cand && a.party !== 'O') return { who: 'helper', text: `No ${a.party === 'D' ? 'Democratic' : 'Republican'} nominee is listed for ${race.label}. Choose “Someone else” on the card if you expect another outcome.` };
      const ok = A.pickCurrent(cand ? cand.id : null, a.party);
      return { who: 'helper', text: ok ? `Saved your call for ${race.label}: ${cand ? cand.name : 'Someone else'} (${a.party}).` : 'Could not save that call.' };
    }
    case 'defer-current': {
      if (!A.writable()) return { who: 'helper', text: 'Predictions are closed.' };
      A.deferCurrent();
      return { who: 'helper', text: 'Saved for later. It comes back after about 20 more items.' };
    }
  }
}

registerActions({
  'asst-submit': (_el, ev) => {
    ev.preventDefault();
    const input = document.getElementById('asst-q') as HTMLInputElement | null;
    const v = input?.value.trim() ?? '';
    if (!v) return;
    ask(v);
    (document.getElementById('asst-q') as HTMLInputElement | null)?.focus();
  },
  'asst-example': (el) => ask(el.dataset['q'] ?? ''),
  'asst-hide': () => { ctx.working.assistantHidden = true; persist(); if (host) renderAssistant(host); },
  'asst-show': () => { ctx.working.assistantHidden = false; persist(); if (host) renderAssistant(host); },
  'asst-undo': () => {
    const last = [...log].reverse().find((m) => m.undo);
    if (last?.undo) { last.undo.fn(); delete last.undo; undoFn = null; if (host) renderAssistant(host); }
  },
});

void undoFn; void TOOLS; void (null as unknown as ToolName); void outputIsSafe; void picksFor;
