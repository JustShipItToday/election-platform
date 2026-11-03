import { ctx, esc, phase, picksFor, raceById, toast, writable, PARTY_NAME, LOCAL_ZONE, onChange } from '../ctx';
import { FORECAST_CLOSES_AT_MS, RESULTS_VISIBLE_AT_MS, countdown, formatInstant } from '../domain/lifecycle';
import { now, clockState, isSimulated } from '../domain/clock';
import { judgeCall } from '../domain/evidence';
import { dusk, sprig, tally } from './mascots';
import { LIMITS, saveMap, type SavedMap } from '../storage';
import { registerActions } from './actions';
import { mapEl, paintMap, resizeMap, colorVar, type StateColor } from './map';
import type { Chamber, Party } from '../data/schema';

const REPO = 'https://github.com/JustShipItToday/election-platform';

function timeRows(): string {
  const rows: [string, number][] = [
    ['Predictions close', FORECAST_CLOSES_AT_MS],
    ['Real results begin to appear', RESULTS_VISIBLE_AT_MS],
  ];
  return rows
    .map(
      ([label, ms]) => `<tr><th scope="row">${label}</th>
      <td><strong>${esc(formatInstant(ms))}</strong><br><span class="muted small">your time (${esc(LOCAL_ZONE)})</span></td>
      <td>${esc(formatInstant(ms, 'America/Los_Angeles'))}<br>${esc(formatInstant(ms, 'America/New_York'))}</td></tr>`,
    )
    .join('');
}

export function aboutPage(): string {
  const c = clockState();
  return `<article class="page about">
  <header class="pagehead">${sprig(130)}<div><p class="eyebrow">About</p><h1>Elecia is a greenhouse for election-night thinking</h1>
  <p class="lede">Call the 2026 Senate and Governor races the way you think they will go. Separately, record whom you want to win. Look at the polls behind every race. Everything stays in your own browser.</p></div></header>
  <section><h2>Forecasting and endorsing are different</h2>
  <p><strong>Forecasting</strong> asks what you think will happen. <strong>Endorsing</strong> asks whom you want to support. You can predict one candidate and endorse another. Elecia never reconciles the two for you, and the Reconcile page only describes how your choices relate.</p></section>
  <section><h2>When predictions close</h2>
  <p>Forecasting and endorsing shut down at <strong>${esc(formatInstant(FORECAST_CLOSES_AT_MS))}</strong> in your time zone. That is 1:57 AM Pacific, which is 4:57 AM Eastern. Real results begin to appear at <strong>${esc(formatInstant(RESULTS_VISIBLE_AT_MS))}</strong> (9:00 AM Eastern).</p>
  <div class="tablewrap"><table class="times"><thead><tr><th></th><th>In your time zone</th><th>Pacific / Eastern</th></tr></thead><tbody>${timeRows()}</tbody></table></div>
  <p class="muted small">${c.trusted ? 'These times are checked against the web server\'s clock, not your computer\'s clock.' : 'This browser could not reach the server clock, so it is using your computer\'s clock for the countdown.'} After the cutoff your saved maps stay viewable and you can still explore them.</p></section>
  <section><h2>Where the facts come from</h2>
  <ul>
    <li><strong>Polls:</strong> <a href="https://votehub.com/polls/api/" target="_blank" rel="noopener noreferrer">VoteHub</a>, shared under CC BY 4.0. Every poll links to its original source. Averages are computed here from those polls using the method you choose.</li>
    <li><strong>Candidates and nominees:</strong> each race's Wikipedia page (CC BY-SA 4.0), linked on every race card.</li>
    <li><strong>Sitting senators:</strong> the public-domain <a href="https://github.com/unitedstates/congress-legislators" target="_blank" rel="noopener noreferrer">congress-legislators</a> roster.</li>
    <li><strong>Map shapes:</strong> U.S. Census Bureau boundaries via us-atlas.</li>
  </ul>
  <p>When a source is missing something, Elecia says so instead of filling the gap.</p></section>
  <section><h2>What is not in this release</h2>
  <p>House races, ballot questions, accounts, and the AI research assistant are not part of this release. Your data lives only in this browser; clearing site data erases it, and Saved lets you export a file first. The project is open source at <a href="${REPO}" target="_blank" rel="noopener noreferrer">GitHub</a>.</p></section>
  </article>`;
}

export function contactPage(): string {
  return `<article class="page"><header class="pagehead">${tally(90)}<div><p class="eyebrow">Contact</p><h1>Say hello</h1></div></header>
  <p>The simplest way to reach the project is a public note on its <a href="${REPO}/issues" target="_blank" rel="noopener noreferrer">GitHub issues page</a>. Report a wrong nominee or poll, suggest a fix, or ask a question there.</p>
  <p class="muted">Because this site has no server, it cannot receive messages directly, and it never collects your personal information.</p></article>`;
}

export function termsPage(): string {
  return `<article class="page terms"><header class="pagehead">${sprig(100)}<div><p class="eyebrow">Terms</p><h1>Plain-English terms</h1><p class="muted">Last updated November 3, 2026</p></div></header>
  <h2>What this is</h2><p>Elecia is a free, educational tool for recording your own election predictions and preferences. It is not affiliated with any campaign, party, government, or news organization.</p>
  <h2>Not advice, not official results</h2><p>Nothing here is political, legal, or voting advice, and Elecia does not tell you whom to support. Poll averages are computed from published polls and are not predictions. Results shown after election night are labeled with their sources and are not official until certified by election authorities.</p>
  <h2>Your data</h2><p>Your calls, endorsements, and saved maps are stored in your browser on your device. They are not sent to us. We use no accounts and no analytics. Clearing your browser data deletes them.</p>
  <h2>Sources and licenses</h2><p>Poll data comes from VoteHub (CC BY 4.0) and links to each original poll. Candidate lists come from Wikipedia (CC BY-SA 4.0). Please credit these sources if you reuse their material.</p>
  <h2>No warranty</h2><p>The site is provided as is. Data may be incomplete, delayed, or wrong, and we may change or remove features, including the cutoff for predictions described on the About page.</p>
  <h2>Contact</h2><p>See the <a href="#/contact">Contact</a> page.</p></article>`;
}

export function blogPage(): string {
  return `<article class="page blog"><header class="pagehead">${tally(90)}<div><p class="eyebrow">Blog</p><h1>Notes from the greenhouse</h1></div></header>
  <article class="post"><p class="muted small">November 3, 2026</p><h2>How Elecia counts polls</h2>
  <p>Polls disagree, and the way you combine them changes the picture. So Elecia keeps every poll and lets you pick the rule.</p>
  <p><strong>Latest poll only</strong> uses the single most recent poll, judged by the day its fieldwork ended. <strong>Latest N</strong> averages the newest N polls. <strong>Last X days</strong> averages every poll that ended inside that window. <strong>All polls</strong> averages everything on file.</p>
  <p>Each candidate's average is the plain mean of that candidate's number across the polls used. Elecia never weights, smooths, or adjusts them. If a lead is no bigger than your tie setting, the race is called a tie, and a tie or a race with no polls is always left for you to decide.</p>
  <p>Every race card lists each poll with its pollster, dates, sample, and a link to its original source, and shows whether it was used and why not if it was left out. You can also leave out polls the source flags as internal or partisan.</p>
  <p>Because the source publishes individual polls rather than a finished average, there is no hidden number to trust. Everything you see can be recomputed from the table in front of you.</p></article></article>`;
}

// ---------------- closed + results ----------------
export function closedPage(): string {
  const p = phase();
  const left = countdown(RESULTS_VISIBLE_AT_MS, now());
  return `<article class="page closed"><div class="closedhero">${dusk(130)}<div><p class="eyebrow">Predictions are closed</p>
  <h1>The polls have closed on forecasting</h1>
  <p class="lede">Forecasting and endorsing ended at ${esc(formatInstant(FORECAST_CLOSES_AT_MS))}. Your saved maps are safe and still fully explorable.</p>
  ${p === 'closed' ? `<p>Real results begin to appear at ${esc(formatInstant(RESULTS_VISIBLE_AT_MS))}${left ? `, in ${esc(left)}` : ''}.</p>` : '<p>Results are now available.</p>'}
  <p class="row wrap"><a class="btn" href="#/2026/saved">Open my saved maps</a>${p === 'results' ? '<a class="btn ghost" href="#/2026/results">See results</a>' : ''}</p></div></div></article>`;
}

export function resultsPage(): string {
  const calls = new Map(ctx.calls.calls.map((c) => [c.raceId, c]));
  const picks = picksFor('forecast');
  let hit = 0, miss = 0, pending = 0, unforecast = 0;
  const rows = ctx.data.races
    .slice()
    .sort((a, b) => (a.chamber === b.chamber ? a.stateName.localeCompare(b.stateName) : a.chamber === 'senate' ? -1 : 1))
    .map((r) => {
      const v = judgeCall(calls.get(r.id), r);
      const p = picks.get(r.id);
      const mine = p ? (p.candidateId ? r.candidates.find((c) => c.id === p.candidateId)?.name : 'Someone else') : null;
      let result = '<span class="muted">Not called yet</span>';
      let verdict = '';
      if (v.called) {
        const w = r.candidates.find((c) => c.id === v.winnerId)!;
        result = `<span class="chip ${w.party}">${w.party}</span> ${esc(w.name)} <span class="muted small">(${esc(v.reason)})</span>`;
        if (!p) { unforecast += 1; verdict = '<span class="muted">no forecast</span>'; }
        else if (p.candidateId === v.winnerId) { hit += 1; verdict = '<span class="ok">Matched</span>'; }
        else { miss += 1; verdict = '<span class="warn">Different</span>'; }
      } else if (p) pending += 1;
      const rep = r.reported.afterName || r.reported.results.length
        ? `<span class="small">${r.reported.afterName ? `${esc(r.reported.afterName)}${r.reported.afterParty ? ` (${r.reported.afterParty})` : ''}` : r.reported.results.map((x) => `${esc(r.candidates.find((c) => c.id === x.candidateId)?.name ?? '')} ${x.pct ?? ''}${x.pct != null ? '%' : ''}`).join(', ')}</span> <span class="tag">unverified</span>`
        : '<span class="muted small">none yet</span>';
      return `<tr><th scope="row">${esc(r.label)}</th><td>${mine ? esc(mine) : '<span class="muted">none</span>'}</td><td>${result}</td><td>${verdict}</td><td>${rep}</td></tr>`;
    })
    .join('');
  return `<article class="page results"><header class="pagehead">${tally(90)}<div><p class="eyebrow">Results</p><h1>Your forecast against what happened</h1>
  <p class="lede">A race counts as <strong>called</strong> only when an official source confirms it or two independent news sources agree. Anything else stays open.</p></div></header>
  <div class="summary"><div><b>${hit}</b><span>called and matched your forecast</span></div><div><b>${miss}</b><span>called and different</span></div><div><b>${pending}</b><span>forecast, not called yet</span></div><div><b>${unforecast}</b><span>called, no forecast from you</span></div></div>
  <p class="muted small">Calls updated ${esc(ctx.calls.updatedAt ? formatInstant(Date.parse(ctx.calls.updatedAt)) : 'not yet')} · Data refreshed ${esc(formatInstant(Date.parse(ctx.data.meta.generatedAt)))}. The "reported" column is read from each race's Wikipedia page and has not been independently verified.</p>
  <div class="tablewrap"><table class="list"><thead><tr><th>Race</th><th>Your forecast</th><th>Called result</th><th>Compared</th><th>Reported by Wikipedia</th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
}

// ---------------- reconcile ----------------
export function reconcilePage(): string {
  const f = picksFor('forecast');
  const e = picksFor('endorse');
  const ids = ctx.data.races.map((r) => r.id);
  let both = 0, same = 0, differ = 0, fOnly = 0, eOnly = 0, neither = 0;
  const matrix: Record<Party, Record<Party, number>> = { D: { D: 0, R: 0, O: 0 }, R: { D: 0, R: 0, O: 0 }, O: { D: 0, R: 0, O: 0 } };
  const byChamber: Record<Chamber, { both: number; same: number }> = { senate: { both: 0, same: 0 }, governor: { both: 0, same: 0 } };
  const diffRows: string[] = [];
  for (const id of ids) {
    const r = raceById(id)!;
    const a = f.get(id), b = e.get(id);
    if (a && b) {
      both += 1; byChamber[r.chamber].both += 1;
      matrix[b.party][a.party] += 1;
      if (a.candidateId === b.candidateId && a.party === b.party) { same += 1; byChamber[r.chamber].same += 1; }
      else {
        differ += 1;
        const nm = (p: typeof a) => (p!.candidateId ? r.candidates.find((c) => c.id === p!.candidateId)?.name : 'Someone else');
        diffRows.push(`<tr><th scope="row">${esc(r.label)}</th><td>${esc(nm(a))} <span class="chip ${a.party}">${a.party}</span></td><td>${esc(nm(b))} <span class="chip ${b.party}">${b.party}</span></td></tr>`);
      }
    } else if (a) fOnly += 1;
    else if (b) eOnly += 1;
    else neither += 1;
  }
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');
  const bar = (n: number, d: number) => `<span class="rbar"><i style="width:${d ? (100 * n) / d : 0}%"></i></span>`;
  const mrows = (['D', 'R', 'O'] as Party[]).map((ep) => `<tr><th scope="row">Endorsed ${PARTY_NAME[ep]}</th>${(['D', 'R', 'O'] as Party[]).map((fp) => `<td>${matrix[ep][fp]}</td>`).join('')}</tr>`).join('');
  return `<article class="page reconcile"><header class="pagehead">${sprig(110)}<div><p class="eyebrow">Reconcile</p><h1>What I thought would happen, and what I wanted</h1>
  <p class="lede">A descriptive look at your own choices. Differences are not mistakes, and matches are not better. Forecasting and endorsing answer different questions.</p></div></header>
  <div class="summary"><div><b>${both}</b><span>races with both a forecast and an endorsement</span></div><div><b>${same}</b><span>same candidate in both</span></div><div><b>${differ}</b><span>different candidates</span></div><div><b>${fOnly}</b><span>forecast but not endorsed</span></div><div><b>${eOnly}</b><span>endorsed but not forecast</span></div><div><b>${neither}</b><span>neither yet</span></div></div>
  <h2>By chamber</h2>
  <table class="list"><thead><tr><th>Chamber</th><th>Both recorded</th><th>Same candidate</th><th></th></tr></thead><tbody>
  <tr><th scope="row">Senate</th><td>${byChamber.senate.both}</td><td>${pct(byChamber.senate.same, byChamber.senate.both)}</td><td>${bar(byChamber.senate.same, byChamber.senate.both)}</td></tr>
  <tr><th scope="row">Governors</th><td>${byChamber.governor.both}</td><td>${pct(byChamber.governor.same, byChamber.governor.both)}</td><td>${bar(byChamber.governor.same, byChamber.governor.both)}</td></tr></tbody></table>
  <h2>Endorsed party against forecast party</h2>
  <div class="tablewrap"><table class="list matrix"><thead><tr><th></th><th>Forecast Democratic</th><th>Forecast Republican</th><th>Forecast Other</th></tr></thead><tbody>${mrows}</tbody></table></div>
  <h2>Where they differ</h2>
  ${diffRows.length ? `<div class="tablewrap"><table class="list"><thead><tr><th>Race</th><th>I forecast</th><th>I endorsed</th></tr></thead><tbody>${diffRows.join('')}</tbody></table></div>` : '<p class="muted">No races with different forecast and endorsement yet.</p>'}
  <p class="row wrap"><a class="btn" href="#/2026/forecasting">Forecasting</a><a class="btn ghost" href="#/2026/endorsing">Endorsing</a></p></article>`;
}

// ---------------- saved ----------------
let savedTab: 'forecast' | 'prediction' = 'forecast';

export async function savedPage(host: HTMLElement): Promise<void> {
  host.innerHTML = `<article class="page saved"><header class="pagehead">${tally(90)}<div><p class="eyebrow">Saved</p><h1>My maps</h1><p class="lede">Stored only in this browser.${ctx.storePersistent ? '' : ' This browser blocks storage, so nothing here lasts beyond this visit.'}</p></div></header><div id="savedbody">Loading…</div></article>`;
  const body = host.querySelector('#savedbody') as HTMLElement;
  let all: SavedMap[] = [];
  try { all = await ctx.store.list(); } catch { body.innerHTML = '<p>Saved maps are unavailable in this browser.</p>'; return; }
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const list = all.filter((m) => m.kind === savedTab);
  const counts = { forecast: all.filter((m) => m.kind === 'forecast').length, prediction: all.filter((m) => m.kind === 'prediction').length };
  const canDelete = writable();
  body.innerHTML = `<div class="seggroup" role="tablist"><button class="seg ${savedTab === 'forecast' ? 'on' : ''}" data-action="saved-tab" data-val="forecast">Forecast maps ${counts.forecast}/${LIMITS.forecast}</button><button class="seg ${savedTab === 'prediction' ? 'on' : ''}" data-action="saved-tab" data-val="prediction">Prediction maps ${counts.prediction}/${LIMITS.prediction}</button></div>
  <p class="muted small">${savedTab === 'forecast' ? 'Forecast maps are named, frozen snapshots.' : 'Prediction maps are working saves and versions.'}</p>
  <div class="row wrap"><button class="btn small ghost" data-action="export-all">Export all as a file</button>
  <label class="btn small ghost">Import a file<input type="file" accept="application/json" data-action="import-file" data-on="change" hidden></label></div>
  ${list.length ? `<ul class="maplist">${list.map((m) => `<li class="mapitem"><div><strong>${esc(m.name)}</strong><br><span class="muted small">${esc(formatInstant(Date.parse(m.createdAt)))} · ${m.picks.length} calls · Senate ${m.aggregate.senate.total.D}D-${m.aggregate.senate.total.R}R · Governors ${m.aggregate.governor.total.D}D-${m.aggregate.governor.total.R}R</span></div>
  <div class="row"><a class="btn small" href="#/2026/saved/${esc(m.id)}">Open</a>${canDelete ? `<button class="btn small ghost" data-action="saved-delete" data-id="${esc(m.id)}">Delete</button>` : ''}</div></li>`).join('')}</ul>` : `<div class="empty">${sprig(90)}<p>No ${savedTab} maps yet. Make some calls on the Forecasting page, then save them.</p><a class="btn" href="#/2026/forecasting">Go forecast</a></div>`}`;
}

export async function savedDetail(host: HTMLElement, id: string): Promise<void> {
  const m = await ctx.store.get(id);
  if (!m) { host.innerHTML = '<article class="page"><h1>Map not found</h1><p><a href="#/2026/saved">Back to saved maps</a></p></article>'; return; }
  const calls = new Map(ctx.calls.calls.map((c) => [c.raceId, c]));
  const showResults = phase() === 'results';
  const rows = m.seats.map((s) => {
    const r = raceById(s.raceId);
    const v = r ? judgeCall(calls.get(r.id), r) : null;
    let cmp = '';
    if (showResults && v?.called) {
      const p = m.picks.find((x) => x.raceId === s.raceId);
      cmp = p && p.candidateId === v.winnerId ? '<span class="ok">Matched the call</span>' : p ? '<span class="warn">Different from the call</span>' : '';
    }
    return `<tr><th scope="row">${esc(s.label)}</th><td>${s.party ? `<span class="chip ${s.party}">${s.party}</span> ${esc(s.pickName)}` : '<span class="muted">not called</span>'}</td><td class="small">${s.polling ? `${esc(s.polling.marginText)} (${s.polling.included} polls)` : ''}</td>${showResults ? `<td>${cmp}</td>` : ''}</tr>`;
  }).join('');
  const agg = (n: string, a: SavedMap['aggregate']['senate']) => `<div class="makeup-card"><h3>${n}</h3><div class="tot"><span class="D"><b>${a.total.D}</b> D</span><span class="R"><b>${a.total.R}</b> R</span><span class="O"><b>${a.total.O}</b> O</span></div><p class="muted small">${a.holdover.D} D, ${a.holdover.R} R, ${a.holdover.O} other not up + ${a.called.D} D, ${a.called.R} R, ${a.called.O} other called. ${a.uncalled} uncalled.</p></div>`;
  host.innerHTML = `<article class="page detail"><p><a href="#/2026/saved">Back to saved maps</a></p>
  <h1>${esc(m.name)}</h1><p class="muted">${m.kind === 'forecast' ? 'Forecast map (frozen)' : 'Prediction map'} · saved ${esc(formatInstant(Date.parse(m.createdAt)))} · data as of ${esc(formatInstant(Date.parse(m.dataAsOf)))}</p>
  ${m.notes ? `<p class="notes">${esc(m.notes)}</p>` : ''}
  <p class="small"><strong>Scope:</strong> ${esc(m.scopeText)}<br><strong>Polling method:</strong> ${esc(m.methodText)}</p>
  <div class="toolbar"><div class="seggroup"><button class="seg on" data-action="saved-chamber" data-val="senate" aria-pressed="true">Senate</button><button class="seg" data-action="saved-chamber" data-val="governor" aria-pressed="false">Governors</button></div></div>
  <div class="mapslot" id="savedmap"></div>
  <div class="makeup">${agg('Senate', m.aggregate.senate)}${agg('Governors', m.aggregate.governor)}</div>
  <div class="tablewrap"><table class="list"><thead><tr><th>Race</th><th>Call</th><th>Polling then</th>${showResults ? '<th>Compared with result</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div></article>`;
  const slot = host.querySelector('#savedmap') as HTMLElement;
  slot.appendChild(mapEl);
  window.setTimeout(resizeMap, 30);
  const paintSaved = (chamber: Chamber) => {
    const colors = new Map<string, StateColor>();
    for (const r of ctx.data.races.filter((x) => x.chamber === chamber)) {
      const s = m.seats.find((x) => x.raceId === r.id);
      if (!s) { colors.set(r.state, { fill: colorVar('--out-scope'), label: '·', title: `${r.stateName}: not in this map` }); continue; }
      colors.set(r.state, s.party ? { fill: colorVar(`--${s.party.toLowerCase()}`), label: s.party, title: `${r.stateName}: ${PARTY_NAME[s.party]}` } : { fill: colorVar('--uncalled'), label: '?', title: `${r.stateName}: not called` });
    }
    paintMap(colors, null);
  };
  paintSaved('senate');
  savedChamberHandler = (c) => { paintSaved(c); host.querySelectorAll<HTMLElement>('[data-action="saved-chamber"]').forEach((b) => { const on = b.dataset['val'] === c; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); };
}

let savedChamberHandler: (c: Chamber) => void = () => {};
let rerenderSaved: () => void = () => {};
export function setSavedRerender(fn: () => void): void { rerenderSaved = fn; }

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

registerActions({
  'saved-tab': (el) => { savedTab = el.dataset['val'] as 'forecast' | 'prediction'; rerenderSaved(); },
  'saved-chamber': (el) => savedChamberHandler(el.dataset['val'] as Chamber),
  'saved-delete': async (el) => {
    if (!writable()) { toast('Saved maps are kept as history after the cutoff and cannot be deleted.'); return; }
    await ctx.store.remove(el.dataset['id']!);
    toast('Map deleted from this browser.');
    rerenderSaved();
  },
  'export-all': async () => {
    const all = await ctx.store.list();
    download(`elecia-maps-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'elecia', version: 1, maps: all, working: ctx.working }, null, 1));
  },
  'import-file': async (el) => {
    const input = el as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const j = JSON.parse(await file.text()) as { app?: string; maps?: SavedMap[] };
      if (j.app !== 'elecia' || !Array.isArray(j.maps)) throw new Error('not an Elecia file');
      let ok = 0, fail = 0;
      for (const m of j.maps) {
        if (!m || typeof m.id !== 'string' || (m.kind !== 'forecast' && m.kind !== 'prediction') || !Array.isArray(m.picks) || !Array.isArray(m.seats)) { fail += 1; continue; }
        const exists = await ctx.store.get(m.id);
        if (exists) continue;
        const r = await saveMap(ctx.store, m, now());
        if (r.ok) ok += 1; else { fail += 1; toast(r.error); }
      }
      toast(`Imported ${ok} map${ok === 1 ? '' : 's'}${fail ? `, ${fail} skipped` : ''}.`);
      rerenderSaved();
    } catch {
      toast('That file could not be read as an Elecia export.');
    }
    input.value = '';
  },
});

export function bannerHtml(): string {
  const p = phase();
  const n = now();
  const sim = isSimulated() ? ' <span class="tag">simulated clock</span>' : '';
  if (p === 'open') {
    const left = countdown(FORECAST_CLOSES_AT_MS, n);
    return `<span><strong>Predictions are open.</strong> They close in <strong>${esc(left ?? '')}</strong> (${esc(formatInstant(FORECAST_CLOSES_AT_MS))}).${sim}${clockState().trusted || isSimulated() ? '' : ' <span class="tag">using your device clock</span>'}</span>`;
  }
  if (p === 'closed') {
    const left = countdown(RESULTS_VISIBLE_AT_MS, n);
    return `<span><strong>Predictions are closed.</strong> Results begin at ${esc(formatInstant(RESULTS_VISIBLE_AT_MS))}${left ? ` (in ${esc(left)})` : ''}.${sim}</span>`;
  }
  return `<span><strong>Results are in.</strong> Compare them with your saved forecasts. Calls need official or two-source confirmation.${sim}</span>`;
}

export { onChange };
