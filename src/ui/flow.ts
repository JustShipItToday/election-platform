import type { Chamber, Party, Race } from '../data/schema';
import { ctx, esc, emit, outcomeFor, persist, picksFor, raceById, scopeRaces, setPick, clearPick, toast, writable, PARTY_NAME, type Mode } from '../ctx';
import { describeMethod, type PollSettings } from '../domain/polling';
import { computeMakeup, type ChamberMakeup, type Pick } from '../domain/makeup';
import { createQueue, current, decide, defer, revisit, type QueueState } from '../domain/deferral';
import { describeScope, type Clause } from '../domain/scope';
import { now } from '../domain/clock';
import { STATES } from '../data/states';
import { LIMITS, saveMap, type SavedMap, type SavedSeat } from '../storage';
import { mapEl, paintMap, resizeMap, flyToView, colorVar, type StateColor } from './map';
import { registerActions } from './actions';
import { sprig, tally } from './mascots';

interface View {
  chamber: Chamber;
  colorBy: 'picks' | 'polling';
  display: 'map' | 'list';
  focusRaceId: string | null;
  saveForm: boolean;
}
const view: View = { chamber: 'senate', colorBy: 'picks', display: 'map', focusRaceId: null, saveForm: false };
let mode: Mode = 'forecast';
let root: HTMLElement | null = null;
const counters = new Map<string, number>();
const history: string[] = [];
let qs: QueueState = createQueue([]);

const letter: Record<Party, string> = { D: 'D', R: 'R', O: 'O' };

// ---------------- queue ----------------
function syncQueue(): void {
  const ids = scopeRaces().map((r) => r.id);
  const picks = ctx.working[mode];
  const deferredIds = ctx.working.deferred[mode].filter((id) => ids.includes(id) && !picks[id]);
  const pending = ids.filter((id) => !picks[id] && !deferredIds.includes(id));
  qs = {
    pending,
    deferred: deferredIds.map((id) => ({ id, shownSince: counters.get(id) ?? 0 })),
    done: ids.filter((id) => picks[id]),
  };
}

function takeCounters(q: QueueState): void {
  counters.clear();
  for (const d of q.deferred) counters.set(d.id, d.shownSince);
}

function currentRace(): Race | undefined {
  if (view.focusRaceId) {
    const r = raceById(view.focusRaceId);
    if (r) return r;
  }
  const id = current(qs);
  return id ? raceById(id) : undefined;
}

// ---------------- rendering ----------------
export function mountFlow(host: HTMLElement, m: Mode): void {
  root = host;
  mode = m;
  view.saveForm = false;
  if (m === 'endorse') view.colorBy = 'picks';
  syncQueue();
  host.innerHTML = `
  <div class="flow ${m}">
    <details class="sidebar-wrap" id="sidebar-wrap" open>
      <summary class="sidebar-toggle">Scope and polling settings</summary>
      <aside class="sidebar" id="sidebar" aria-label="Choose which races to work on"></aside>
    </details>
    <section class="center" aria-label="Map and results">
      <div class="toolbar" id="toolbar"></div>
      <div class="mapslot" id="mapslot"></div>
      <div id="listslot" hidden></div>
      <div id="makeup"></div>
    </section>
    <section class="cardcol" id="card" aria-live="polite"></section>
  </div>`;
  if (window.matchMedia('(max-width: 900px)').matches) (host.querySelector('#sidebar-wrap') as HTMLDetailsElement).open = false;
  renderAll();
}

function renderAll(): void {
  if (!root) return;
  renderSidebar();
  renderToolbar();
  renderCard();
  renderMakeup();
  renderDisplay();
  paint();
}

function renderToolbar(): void {
  const el = root?.querySelector('#toolbar');
  if (!el) return;
  const btn = (action: string, val: string, label: string, on: boolean) =>
    `<button class="seg ${on ? 'on' : ''}" data-action="${action}" data-val="${val}" aria-pressed="${on}">${label}</button>`;
  el.innerHTML = `
    <div class="seggroup" role="group" aria-label="Chamber">${btn('chamber', 'senate', 'Senate', view.chamber === 'senate')}${btn('chamber', 'governor', 'Governors', view.chamber === 'governor')}</div>
    ${mode === 'forecast' ? `<div class="seggroup" role="group" aria-label="Color the map by">${btn('colorby', 'picks', 'My calls', view.colorBy === 'picks')}${btn('colorby', 'polling', 'Polling lean', view.colorBy === 'polling')}</div>` : ''}
    <div class="seggroup" role="group" aria-label="Display">${btn('display', 'map', 'Map', view.display === 'map')}${btn('display', 'list', 'List', view.display === 'list')}</div>
    ${view.display === 'map' ? `<div class="seggroup" role="group" aria-label="Jump to">${btn('fly', 'lower48', 'Lower 48', false)}${btn('fly', 'alaska', 'Alaska', false)}${btn('fly', 'hawaii', 'Hawaii', false)}</div>` : ''}`;
}

function renderDisplay(): void {
  const mapslot = root?.querySelector('#mapslot') as HTMLElement | null;
  const listslot = root?.querySelector('#listslot') as HTMLElement | null;
  if (!mapslot || !listslot) return;
  if (view.display === 'map') {
    mapslot.hidden = false;
    listslot.hidden = true;
    if (mapEl.parentElement !== mapslot) mapslot.appendChild(mapEl);
    window.setTimeout(resizeMap, 30);
  } else {
    mapslot.hidden = true;
    listslot.hidden = false;
    listslot.innerHTML = listHtml();
  }
}

function pollingText(race: Race): { label: string; party: Party | null } {
  const o = outcomeFor(race);
  if (o.status === 'leader') return { label: `${o.leaderParty ?? '?'}+${o.margin}`, party: o.leaderParty };
  if (o.status === 'tie') return { label: 'Tie', party: null };
  return { label: 'No polls', party: null };
}

function listHtml(): string {
  const inScope = new Set(scopeRaces().map((r) => r.id));
  const picks = picksFor(mode);
  const races = ctx.data.races.filter((r) => r.chamber === view.chamber).sort((a, b) => a.stateName.localeCompare(b.stateName));
  const rows = races
    .map((r) => {
      const p = picks.get(r.id);
      const cand = p?.candidateId ? r.candidates.find((c) => c.id === p.candidateId)?.name : p ? 'Someone else' : null;
      const pol = pollingText(r);
      return `<tr class="${inScope.has(r.id) ? '' : 'dim'}">
        <th scope="row">${esc(r.stateName)}${r.special ? ' <span class="muted">(special)</span>' : ''}</th>
        <td>${r.seatPartyBefore ? `<span class="chip ${r.seatPartyBefore}">${r.seatPartyBefore}</span>` : '–'}</td>
        <td>${p ? `<span class="chip ${p.party}">${letter[p.party]}</span> ${esc(cand)}` : '<span class="muted">not yet</span>'}</td>
        <td>${pol.party ? `<span class="chip ${pol.party}">${pol.party}</span> ` : ''}${esc(pol.label)}</td>
        <td><button class="link" data-action="focus" data-race="${esc(r.id)}">${inScope.has(r.id) ? 'Open' : 'Open (outside scope)'}</button></td></tr>`;
    })
    .join('');
  return `<div class="tablewrap"><table class="list"><caption class="sr">${view.chamber === 'senate' ? 'Senate' : 'Governor'} races</caption>
    <thead><tr><th>State</th><th>Seat held by</th><th>${mode === 'forecast' ? 'Your call' : 'Your endorsement'}</th><th>Polling lean</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function paint(): void {
  const races = ctx.data.races.filter((r) => r.chamber === view.chamber);
  const inScope = new Set(scopeRaces().map((r) => r.id));
  const picks = picksFor(mode);
  const colors = new Map<string, StateColor>();
  const cur = currentRace();
  for (const r of races) {
    if (!inScope.has(r.id)) {
      colors.set(r.state, { fill: colorVar('--out-scope'), label: '·', title: `${r.stateName}: outside your scope` });
      continue;
    }
    if (view.colorBy === 'polling' && mode === 'forecast') {
      const o = outcomeFor(r);
      if (o.status === 'leader') colors.set(r.state, { fill: colorVar(`--${o.leaderParty!.toLowerCase()}`), label: `${o.leaderParty}+${Math.round(o.margin ?? 0)}`, title: `${r.stateName}: polling lead ${o.leaderParty}+${o.margin}` });
      else colors.set(r.state, { fill: colorVar('--uncalled'), label: o.status === 'tie' ? 'Tie' : '–', title: `${r.stateName}: ${o.status === 'tie' ? 'polling tie' : 'no usable polling'}` });
    } else {
      const p = picks.get(r.id);
      if (p) colors.set(r.state, { fill: colorVar(`--${p.party.toLowerCase()}`), label: letter[p.party], title: `${r.stateName}: ${PARTY_NAME[p.party]}` });
      else colors.set(r.state, { fill: colorVar('--uncalled'), label: '?', title: `${r.stateName}: not yet ${mode === 'forecast' ? 'called' : 'endorsed'}` });
    }
  }
  paintMap(colors, cur && cur.chamber === view.chamber ? cur.state : null);
}

// ---------------- sidebar ----------------
function stateOptions(): string[] {
  return [...new Set(ctx.data.races.map((r) => r.state))].sort((a, b) => STATES[a]!.localeCompare(STATES[b]!));
}

function clauseHtml(c: Clause, i: number): string {
  const ch = c.chambers ?? ['senate', 'governor'];
  const states = new Set(c.states ?? []);
  const grid = stateOptions()
    .map((s) => `<label class="cb"><input type="checkbox" data-action="clause-state" data-on="change" data-i="${i}" data-state="${s}" ${states.has(s) ? 'checked' : ''}> ${s}</label>`)
    .join('');
  return `<fieldset class="clause"><legend>Selection ${i + 1} <button type="button" class="link" data-action="clause-remove" data-i="${i}">Remove</button></legend>
    <div class="row">
      <label class="cb"><input type="checkbox" data-action="clause-chamber" data-on="change" data-i="${i}" data-ch="senate" ${ch.includes('senate') ? 'checked' : ''}> Senate</label>
      <label class="cb"><input type="checkbox" data-action="clause-chamber" data-on="change" data-i="${i}" data-ch="governor" ${ch.includes('governor') ? 'checked' : ''}> Governors</label>
    </div>
    <details><summary>States ${c.states?.length ? `(${c.states.length} chosen)` : '(all)'}</summary><div class="stategrid">${grid}</div>
      <button class="link" data-action="clause-clear-states" data-i="${i}">Clear states</button></details>
    <label class="cb"><input type="checkbox" data-action="clause-haspoll" data-on="change" data-i="${i}" ${c.hasPolling ? 'checked' : ''}> Only races with polling</label>
    <label class="field">Polling margin within <input type="number" min="0" max="50" step="0.5" value="${c.closeWithin ?? ''}" placeholder="any" data-action="clause-close" data-on="change" data-i="${i}"> pts</label>
    <label class="field">Seat currently held by
      <select data-action="clause-held" data-on="change" data-i="${i}">
        <option value="" ${!c.seatHeldBy ? 'selected' : ''}>anyone</option>
        <option value="D" ${c.seatHeldBy === 'D' ? 'selected' : ''}>Democrats</option>
        <option value="R" ${c.seatHeldBy === 'R' ? 'selected' : ''}>Republicans</option>
        <option value="O" ${c.seatHeldBy === 'O' ? 'selected' : ''}>Others</option>
      </select></label>
  </fieldset>`;
}

function renderSidebar(): void {
  const el = root?.querySelector('#sidebar');
  if (!el) return;
  const s = ctx.working.scope;
  const ps = ctx.working.pollSettings;
  const m = ps.method;
  const clauses = s.include.length ? s.include.map((c, i) => clauseHtml(c, i)).join('') : '';
  const n = scopeRaces().length;
  el.innerHTML = `
    <h2 class="side-h">Your scope</h2>
    <p class="scope-text"><strong>${n}</strong> race${n === 1 ? '' : 's'}: ${esc(describeScope(s))}</p>
    ${clauses || '<p class="muted">No filters: every Senate and Governor race.</p>'}
    <div class="row wrap">
      <button class="btn small" data-action="clause-add">${s.include.length ? 'Add another selection' : 'Narrow my scope'}</button>
      ${s.include.length ? '<button class="btn small ghost" data-action="scope-reset">Reset to everything</button>' : ''}
    </div>
    <h2 class="side-h">Polling method</h2>
    <p class="muted small">${esc(describeMethod(ps))}</p>
    <label class="field">Method
      <select data-action="poll-method" data-on="change">
        <option value="latest" ${m.kind === 'latest' ? 'selected' : ''}>Latest poll only</option>
        <option value="latestN" ${m.kind === 'latestN' ? 'selected' : ''}>Latest N polls</option>
        <option value="window" ${m.kind === 'window' ? 'selected' : ''}>Polls from the last X days</option>
        <option value="all" ${m.kind === 'all' ? 'selected' : ''}>All polls</option>
      </select></label>
    ${m.kind === 'latestN' ? `<label class="field">N <input type="number" min="1" max="30" value="${m.n}" data-action="poll-n" data-on="change"></label>` : ''}
    ${m.kind === 'window' ? `<label class="field">Days <input type="number" min="1" max="365" value="${m.days}" data-action="poll-days" data-on="change"></label>` : ''}
    <label class="cb"><input type="checkbox" data-action="poll-internal" data-on="change" ${ps.excludeInternal ? 'checked' : ''}> Leave out internal/partisan polls</label>
    <label class="field">Treat leads of at most <input type="number" min="0" max="10" step="0.5" value="${ps.tieBand}" data-action="poll-tie" data-on="change"> pts as ties</label>
    <p class="muted small">This source publishes individual polls, not a ready-made average, so every average here is computed from the polls you can see on each race.</p>
    ${mode === 'forecast' ? `<h2 class="side-h">Quick start</h2>
      <button class="btn" data-action="rule-polling" ${writable() ? '' : 'disabled'}>Go with what polling says</button>
      <p class="muted small">Calls every uncalled race in scope where the polling leader is clear under your method. Ties and races with no polls stay yours to decide. You can change any call.</p>` : ''}
    <p class="muted small">No AI is running on this site tonight, so everything here works by hand.</p>`;
}

function mutateClause(i: number, fn: (c: Clause) => void): void {
  const c = ctx.working.scope.include[i];
  if (!c) return;
  fn(c);
  afterScopeChange();
}

function afterScopeChange(): void {
  view.focusRaceId = null;
  persist();
  syncQueue();
  renderAll();
}

function setPollSettings(fn: (s: PollSettings) => PollSettings): void {
  ctx.working.pollSettings = fn(ctx.working.pollSettings);
  persist();
  emit();
  renderAll();
}

// ---------------- card ----------------
function pct(n: number): string {
  return `${Math.round(n * 10) / 10}%`;
}

function renderCard(): void {
  const el = root?.querySelector('#card');
  if (!el) return;
  const total = scopeRaces().length;
  const done = qs.done.length;
  const race = currentRace();
  const bar = `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="Progress"><span style="width:${total ? (100 * done) / total : 0}%"></span></div>
    <p class="muted small">${done} of ${total} ${mode === 'forecast' ? 'called' : 'endorsed'} · ${qs.deferred.length} to come back to</p>`;
  const deferred = qs.deferred.length
    ? `<details class="deferred"><summary>Come back later (${qs.deferred.length})</summary><ul>${qs.deferred
        .map((d) => `<li><button class="link" data-action="focus-deferred" data-race="${esc(d.id)}">${esc(raceById(d.id)?.label ?? d.id)}</button></li>`)
        .join('')}</ul></details>`
    : '';
  if (!race) {
    el.innerHTML = `${bar}<div class="card done">${sprig(110)}<h2>${total === 0 ? 'Nothing in this scope' : mode === 'forecast' ? 'Your forecast is complete' : 'Your endorsements are complete'}</h2>
      <p>${total === 0 ? 'Widen your scope in the sidebar to bring races back.' : mode === 'forecast' ? 'Every race in your scope has a call. Save it below, or head to Reconcile once you have endorsed too.' : 'Every race in your scope has a choice recorded.'}</p></div>
      ${deferred}${mode === 'forecast' ? saveHtml() : ''}`;
    void refreshCounts();
    return;
  }
  const pick = picksFor(mode).get(race.id);
  const out = outcomeFor(race);
  const avg = new Map(out.averages.map((a) => [a.candidateId, a]));
  const q = mode === 'forecast' ? 'Who do you think will win?' : 'Whom do you want to support?';
  const sub = mode === 'forecast' ? 'This is your prediction of what will happen.' : 'This is your own choice. It is saved separately from any forecast.';
  const cands = race.candidates.length
    ? race.candidates
        .map((c) => {
          const a = avg.get(c.id);
          const chosen = pick?.candidateId === c.id;
          return `<li class="cand ${chosen ? 'chosen' : ''}">
            <button class="pickbtn ${c.party}" data-action="pick" data-cand="${esc(c.id)}" ${writable() ? '' : 'disabled'} aria-pressed="${chosen}">
              <span class="chip big ${c.party}">${letter[c.party]}</span>
              <span class="cname">${esc(c.name)}<small>${esc(c.partyLabel)}</small></span>
              ${a ? `<span class="cpct">${pct(a.pct)}<small>${a.pollsCounted} poll${a.pollsCounted === 1 ? '' : 's'}</small></span>` : ''}
            </button>
            ${a ? `<div class="pbar"><span class="${c.party}" style="width:${Math.min(100, a.pct)}%"></span></div>` : ''}
          </li>`;
        })
        .join('')
    : '';
  const other = `<li class="cand ${pick && pick.candidateId === null ? 'chosen' : ''}"><button class="pickbtn O" data-action="pick" data-cand="" ${writable() ? '' : 'disabled'} aria-pressed="${!!pick && pick.candidateId === null}">
      <span class="chip big O">O</span><span class="cname">Someone else<small>A candidate not listed here</small></span></button></li>`;
  const included = new Set(out.selection.included.map((p) => p.id));
  const allPolls = [...out.selection.included.map((p) => ({ p, reason: '' })), ...out.selection.excluded.map((e) => ({ p: e.poll, reason: e.reason }))];
  allPolls.sort((a, b) => b.p.endDate.localeCompare(a.p.endDate));
  const names = new Map(race.candidates.map((c) => [c.id, c]));
  const pollRows = allPolls
    .slice(0, 40)
    .map(({ p, reason }) => {
      const res = p.results.map((r) => `${esc(names.get(r.candidateId)?.name.split(' ').slice(-1)[0] ?? '?')} ${r.pct}`).join(' · ');
      return `<tr class="${included.has(p.id) ? '' : 'excl'}">
        <td>${esc(p.pollster)}${p.internal ? ' <span class="tag">internal</span>' : ''}${p.partisan ? ' <span class="tag">partisan</span>' : ''}</td>
        <td>${esc(p.startDate)} to ${esc(p.endDate)}</td>
        <td>${p.sampleSize ?? '–'} ${esc((p.population ?? '').toUpperCase())}</td>
        <td>${res}</td>
        <td>${included.has(p.id) ? '<span class="used">Used</span>' : `<span class="muted">${esc(reason)}</span>`}</td>
        <td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Source</a>` : '<span class="muted">no link</span>'}</td></tr>`;
    })
    .join('');
  const status =
    out.status === 'leader'
      ? `Polling leader under your method: <strong>${esc(names.get(out.leaderId!)?.name ?? '')}</strong> by ${out.margin} pts`
      : out.status === 'tie'
        ? `Polling is a tie under your method (lead of ${out.margin} pts)`
        : out.status === 'insufficient'
          ? 'Not enough named candidates in the polls to compare'
          : 'No polls available for this race';
  const ruleBtn =
    mode === 'forecast'
      ? `<button class="btn ghost" data-action="rule-one" ${out.status === 'leader' && writable() ? '' : 'disabled'}>Use what polling says</button>`
      : '';
  el.innerHTML = `${bar}
    <article class="card" aria-labelledby="race-title">
      <p class="eyebrow">${race.chamber === 'senate' ? 'U.S. Senate' : 'Governor'}${race.special ? ' · special election' : ''}</p>
      <h2 id="race-title">${esc(race.label)}</h2>
      <p class="muted">Seat currently held by ${race.seatPartyBefore ? `<span class="chip ${race.seatPartyBefore}">${race.seatPartyBefore}</span> ${esc(PARTY_NAME[race.seatPartyBefore])}` : 'unknown'}${race.incumbentName ? ` (${esc(race.incumbentName)})` : ''}.</p>
      <h3 class="q">${q}</h3><p class="muted small">${sub}</p>
      ${pick ? `<p class="mine">${mode === 'forecast' ? 'Your forecast' : 'Your endorsement'}: <strong>${pick.candidateId ? esc(names.get(pick.candidateId)?.name ?? '') : 'Someone else'}</strong>${pick.origin === 'rule:polling' ? ' <span class="tag">from polling rule</span>' : ''} <button class="link" data-action="clear-pick">Clear</button></p>` : ''}
      <ul class="cands">${cands}${other}</ul>
      <p class="status">${status}</p>
      <p class="muted small">Method: ${esc(describeMethod(ctx.working.pollSettings))}. ${race.candidatesStatus === 'nominees' ? '' : 'Nominees are not confirmed in the source yet.'}</p>
      <div class="actions">
        <button class="btn later" data-action="later" ${writable() ? '' : 'disabled'}>Come back later</button>
        ${ruleBtn}
        ${history.length ? '<button class="btn ghost" data-action="undo">Undo last</button>' : ''}
      </div>
      <details class="polls" ${allPolls.length ? '' : ''}>
        <summary>${allPolls.length} poll${allPolls.length === 1 ? '' : 's'} on file (${out.selection.included.length} used)</summary>
        ${allPolls.length ? `<div class="tablewrap"><table class="pt"><thead><tr><th>Pollster</th><th>Field dates</th><th>Sample</th><th>Result</th><th>In average?</th><th>Link</th></tr></thead><tbody>${pollRows}</tbody></table></div>${allPolls.length > 40 ? '<p class="muted small">Showing the newest 40.</p>' : ''}` : '<p class="muted">No polls matched this race\'s nominees.</p>'}
      </details>
      <p class="sources small muted"><span class="srctag">Candidates</span> <a href="${esc(race.source.url)}" target="_blank" rel="noopener noreferrer">Wikipedia</a> (CC BY-SA 4.0), retrieved ${esc(race.source.retrievedAt.slice(0, 16).replace('T', ' '))} UTC · <span class="srctag">Seat holder</span> ${race.chamber === 'senate' ? 'congress-legislators' : 'Wikipedia'} · <span class="srctag">Polls</span> <a href="https://votehub.com/polls/api/" target="_blank" rel="noopener noreferrer">VoteHub</a> (CC BY 4.0), each poll links to its original source</p>
    </article>
    ${deferred}
    ${mode === 'forecast' ? saveHtml() : ''}`;
  void refreshCounts();
}

function saveHtml(): string {
  return `<section class="savebox"><h3>Save this forecast</h3>
    <p class="muted small">Saved only in this browser. <span id="counts"></span></p>
    <div class="row wrap">
      <button class="btn small" data-action="save-prediction" ${writable() ? '' : 'disabled'}>Save as prediction map</button>
      <button class="btn small ghost" data-action="open-freeze" ${writable() ? '' : 'disabled'}>Freeze as forecast map…</button>
    </div>
    ${view.saveForm ? `<form class="freeze" data-action="freeze-submit" data-on="submit">
        <label class="field">Name <input id="fz-name" required maxlength="80" placeholder="e.g. My election-day forecast"></label>
        <label class="field">Notes (optional) <textarea id="fz-notes" rows="2" maxlength="500"></textarea></label>
        <button class="btn small" type="submit">Freeze forecast map</button>
        <p class="muted small">A forecast map is a named snapshot. It keeps your calls, scope, polling method and the polls as they stood now, and it cannot be edited later.</p>
      </form>` : ''}
  </section>`;
}

async function refreshCounts(): Promise<void> {
  const el = root?.querySelector('#counts');
  if (!el) return;
  try {
    const all = await ctx.store.list();
    const f = all.filter((m) => m.kind === 'forecast').length;
    const p = all.filter((m) => m.kind === 'prediction').length;
    el.textContent = `Forecast maps ${f}/${LIMITS.forecast} · prediction maps ${p}/${LIMITS.prediction}.${ctx.storePersistent ? '' : ' (This browser blocks storage, so maps last only for this visit.)'}`;
  } catch {
    el.textContent = 'Saved maps are unavailable in this browser.';
  }
}

// ---------------- makeup ----------------
function makeupHtml(m: ChamberMakeup, name: string): string {
  const seatsTotal = m.holdover.D + m.holdover.R + m.holdover.O + m.inScope + m.uncalled * 0;
  void seatsTotal;
  const sum = m.total.D + m.total.R + m.total.O;
  const w = (n: number) => (sum ? (100 * n) / sum : 0);
  const rows = m.seats
    .map((s) => `<li><button class="link" data-action="focus" data-race="${esc(s.raceId)}">${esc(s.label)}</button> ${s.party ? `<span class="chip ${s.party}">${s.party}</span> ${esc(s.pickName)}${s.origin === 'rule:polling' ? ' <span class="tag">polling rule</span>' : ''}` : '<span class="muted">not yet called</span>'}</li>`)
    .join('');
  return `<div class="makeup-card"><h3>${name}</h3>
    <div class="tot" role="img" aria-label="${name}: Democratic ${m.total.D}, Republican ${m.total.R}, Other ${m.total.O}">
      <span class="D"><b>${m.total.D}</b> D</span><span class="R"><b>${m.total.R}</b> R</span><span class="O"><b>${m.total.O}</b> O</span></div>
    <div class="stack" aria-hidden="true"><i class="D" style="width:${w(m.total.D)}%"></i><i class="O" style="width:${w(m.total.O)}%"></i><i class="R" style="width:${w(m.total.R)}%"></i></div>
    <p class="muted small">${m.holdover.D} D, ${m.holdover.R} R, ${m.holdover.O} other not up in 2026 + your calls in scope (${m.called.D} D, ${m.called.R} R, ${m.called.O} other). ${m.uncalled} in-scope race${m.uncalled === 1 ? '' : 's'} uncalled and not counted.${m.complete ? '' : ' Partial totals.'}</p>
    <details><summary>Which seats add up to this (${m.inScope})</summary><ul class="seatlist">${rows || '<li class="muted">No races of this chamber are in your scope.</li>'}</ul></details></div>`;
}

export function chamberMakeup(chamber: Chamber, picks: Map<string, Pick>, scopeIds: Set<string>): ChamberMakeup {
  return computeMakeup(chamber, ctx.data, scopeIds, picks);
}

function renderMakeup(): void {
  const el = root?.querySelector('#makeup');
  if (!el) return;
  const ids = new Set(scopeRaces().map((r) => r.id));
  const picks = picksFor(mode);
  if (mode === 'forecast') {
    const s = chamberMakeup('senate', picks, ids);
    const g = chamberMakeup('governor', picks, ids);
    el.innerHTML = `<h2 class="side-h">My 2026 forecast so far</h2><div class="makeup">${makeupHtml(s, 'Senate')}${makeupHtml(g, 'Governors')}</div>
      <p class="muted small">Ballot-question predictions are separate and never change these totals. They are not part of tonight's release.</p>`;
  } else {
    const count = (ch: Chamber) => {
      const c = { D: 0, R: 0, O: 0 };
      for (const r of ctx.data.races) if (r.chamber === ch && picks.get(r.id)) c[picks.get(r.id)!.party] += 1;
      return c;
    };
    const s = count('senate');
    const g = count('governor');
    el.innerHTML = `<h2 class="side-h">My endorsements so far</h2><p>Senate: ${s.D} D, ${s.R} R, ${s.O} other · Governors: ${g.D} D, ${g.R} R, ${g.O} other.</p>
      <p class="muted small">These are what you want, not what you expect. They never change your forecast.</p>`;
  }
}

// ---------------- saving ----------------
function buildMap(kind: 'prediction' | 'forecast', name: string, notes: string): SavedMap {
  const scopeRacesList = scopeRaces();
  const ids = new Set(scopeRacesList.map((r) => r.id));
  const picks = picksFor('forecast');
  const inScopePicks = [...picks.values()].filter((p) => ids.has(p.raceId));
  const pickMap = new Map(inScopePicks.map((p) => [p.raceId, p]));
  const s = computeMakeup('senate', ctx.data, ids, pickMap);
  const g = computeMakeup('governor', ctx.data, ids, pickMap);
  const seats: SavedSeat[] = [...s.seats, ...g.seats].map((x) => {
    const race = raceById(x.raceId)!;
    const o = outcomeFor(race);
    return {
      ...x,
      polling: { status: o.status, marginText: o.status === 'leader' ? `${o.leaderParty}+${o.margin}` : o.status, included: o.selection.included.length, method: describeMethod(ctx.working.pollSettings) },
    };
  });
  const agg = (m: ChamberMakeup) => ({ holdover: m.holdover, called: m.called, total: m.total, uncalled: m.uncalled });
  return {
    id: `${kind[0]}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    name: name || `Prediction map ${new Date(now()).toLocaleString()}`,
    notes,
    createdAt: new Date(now()).toISOString(),
    dataAsOf: ctx.data.meta.generatedAt,
    scopeText: describeScope(ctx.working.scope),
    scope: structuredClone(ctx.working.scope),
    pollSettings: structuredClone(ctx.working.pollSettings),
    methodText: describeMethod(ctx.working.pollSettings),
    picks: inScopePicks,
    seats,
    aggregate: { senate: agg(s), governor: agg(g) },
  };
}

async function doSave(kind: 'prediction' | 'forecast', name: string, notes: string): Promise<void> {
  const res = await saveMap(ctx.store, buildMap(kind, name, notes), now());
  toast(res.ok ? (kind === 'forecast' ? 'Forecast map frozen and saved in this browser.' : 'Prediction map saved in this browser.') : res.error);
  if (res.ok) view.saveForm = false;
  renderCard();
}

// ---------------- actions ----------------
function gate(): boolean {
  if (writable()) return true;
  toast('Predictions are closed. Your saved maps are still here.');
  return false;
}

function afterDecision(id: string, nextQ: QueueState): void {
  takeCounters(nextQ);
  history.push(id);
  view.focusRaceId = null;
  syncQueue();
  emit();
  renderAll();
}

registerActions({
  chamber: (el) => { view.chamber = el.dataset['val'] as Chamber; const c = currentRace(); if (c && c.chamber !== view.chamber) view.focusRaceId = null; renderToolbar(); renderDisplay(); paint(); },
  colorby: (el) => { view.colorBy = el.dataset['val'] as View['colorBy']; renderToolbar(); paint(); renderDisplay(); },
  display: (el) => { view.display = el.dataset['val'] as View['display']; renderToolbar(); renderDisplay(); paint(); },
  fly: (el) => flyToView(el.dataset['val'] as 'lower48'),
  focus: (el) => {
    const r = raceById(el.dataset['race']!);
    if (!r) return;
    view.focusRaceId = r.id;
    view.chamber = r.chamber;
    renderAll();
    root?.querySelector('#card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'focus-deferred': (el) => {
    const id = el.dataset['race']!;
    qs = revisit(qs, id);
    view.focusRaceId = id;
    renderAll();
  },
  pick: (el) => {
    if (!gate()) return;
    const race = currentRace();
    if (!race) return;
    const cand = el.dataset['cand'] || null;
    syncQueue();
    const next = decide(qs, race.id);
    if (!setPick(mode, race, cand)) return;
    afterDecision(race.id, next);
  },
  'clear-pick': () => {
    const race = currentRace();
    if (!race || !gate()) return;
    clearPick(mode, race.id);
    syncQueue();
    emit();
    renderAll();
  },
  later: () => {
    if (!gate()) return;
    const race = currentRace();
    if (!race) return;
    syncQueue();
    const next = defer(qs, race.id);
    const d = ctx.working.deferred[mode];
    ctx.working.deferred[mode] = [...d.filter((x) => x !== race.id), race.id];
    persist();
    toast('Saved for later. It will come back after about 20 more races, or sooner if few are left.');
    afterDecision(race.id, next);
    history.pop();
  },
  undo: () => {
    if (!gate()) return;
    const id = history.pop();
    if (!id) return;
    clearPick(mode, id);
    syncQueue();
    view.focusRaceId = id;
    emit();
    renderAll();
  },
  'rule-one': () => {
    if (!gate()) return;
    const race = currentRace();
    if (!race) return;
    const o = outcomeFor(race);
    if (o.status !== 'leader' || !o.leaderId) return;
    syncQueue();
    const next = decide(qs, race.id);
    setPick('forecast', race, o.leaderId, o.leaderParty ?? undefined, 'rule:polling');
    afterDecision(race.id, next);
  },
  'rule-polling': () => {
    if (!gate()) return;
    let called = 0;
    let left = 0;
    for (const race of scopeRaces()) {
      if (ctx.working.forecast[race.id]) continue;
      const o = outcomeFor(race);
      if (o.status === 'leader' && o.leaderId) {
        setPick('forecast', race, o.leaderId, o.leaderParty ?? undefined, 'rule:polling');
        called += 1;
      } else left += 1;
    }
    toast(`Polling called ${called} race${called === 1 ? '' : 's'}. ${left} left for you (ties, no polls, or already called).`);
    syncQueue();
    emit();
    renderAll();
  },
  'clause-remove': (el) => { ctx.working.scope.include.splice(Number(el.dataset['i']), 1); afterScopeChange(); },
  'clause-add': () => { ctx.working.scope.include.push({}); afterScopeChange(); },
  'scope-reset': () => { ctx.working.scope = { include: [], exclude: [] }; afterScopeChange(); },
  'clause-chamber': (el) => {
    const i = Number(el.dataset['i']);
    const ch = el.dataset['ch'] as Chamber;
    mutateClause(i, (c) => {
      const cur = new Set(c.chambers ?? ['senate', 'governor']);
      if ((el as HTMLInputElement).checked) cur.add(ch); else cur.delete(ch);
      c.chambers = cur.size === 2 || cur.size === 0 ? undefined : ([...cur] as Chamber[]);
    });
  },
  'clause-state': (el) => {
    const i = Number(el.dataset['i']);
    const s = el.dataset['state']!;
    mutateClause(i, (c) => {
      const cur = new Set(c.states ?? []);
      if ((el as HTMLInputElement).checked) cur.add(s); else cur.delete(s);
      c.states = cur.size ? [...cur] : undefined;
    });
  },
  'clause-clear-states': (el) => mutateClause(Number(el.dataset['i']), (c) => { c.states = undefined; }),
  'clause-haspoll': (el) => mutateClause(Number(el.dataset['i']), (c) => { c.hasPolling = (el as HTMLInputElement).checked || undefined; }),
  'clause-close': (el) => mutateClause(Number(el.dataset['i']), (c) => { const v = (el as HTMLInputElement).value; c.closeWithin = v === '' ? undefined : Math.max(0, Number(v)); }),
  'clause-held': (el) => mutateClause(Number(el.dataset['i']), (c) => { const v = (el as HTMLSelectElement).value; c.seatHeldBy = v === '' ? undefined : (v as Party); }),
  'poll-method': (el) => {
    const k = (el as HTMLSelectElement).value;
    setPollSettings((s) => ({ ...s, method: k === 'latest' ? { kind: 'latest' } : k === 'latestN' ? { kind: 'latestN', n: 3 } : k === 'window' ? { kind: 'window', days: 21 } : { kind: 'all' } }));
  },
  'poll-n': (el) => setPollSettings((s) => ({ ...s, method: { kind: 'latestN', n: Math.max(1, Math.min(30, Number((el as HTMLInputElement).value) || 3)) } })),
  'poll-days': (el) => setPollSettings((s) => ({ ...s, method: { kind: 'window', days: Math.max(1, Math.min(365, Number((el as HTMLInputElement).value) || 21)) } })),
  'poll-internal': (el) => setPollSettings((s) => ({ ...s, excludeInternal: (el as HTMLInputElement).checked })),
  'poll-tie': (el) => setPollSettings((s) => ({ ...s, tieBand: Math.max(0, Number((el as HTMLInputElement).value) || 0) })),
  'save-prediction': () => { if (gate()) void doSave('prediction', '', ''); },
  'open-freeze': () => { view.saveForm = !view.saveForm; renderCard(); },
  'freeze-submit': (_el, ev) => {
    ev.preventDefault();
    if (!gate()) return;
    const name = (document.getElementById('fz-name') as HTMLInputElement | null)?.value.trim() ?? '';
    const notes = (document.getElementById('fz-notes') as HTMLTextAreaElement | null)?.value.trim() ?? '';
    if (!name) return;
    void doSave('forecast', name, notes);
  },
});

/** Called by the router when the map is clicked. */
export function onMapPick(usps: string): void {
  if (!root || !root.querySelector('.flow')) return;
  const r = ctx.data.races.find((x) => x.chamber === view.chamber && x.state === usps);
  if (!r) return;
  view.focusRaceId = r.id;
  renderAll();
  if (window.matchMedia('(max-width: 900px)').matches) root.querySelector('#card')?.scrollIntoView({ behavior: 'smooth' });
}

export function refreshFlow(): void {
  if (!root?.querySelector('.flow')) return;
  syncQueue();
  renderAll();
}

export function tallyIcon(): string {
  return tally(48);
}
