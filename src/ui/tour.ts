import { ctx, persist, LOCAL_ZONE } from '../ctx';
import { FORECAST_CLOSES_AT_MS, RESULTS_VISIBLE_AT_MS, formatInstant } from '../domain/lifecycle';
import { registerActions } from './actions';
import { dusk, sprig, tally } from './mascots';

interface Step { title: string; art: string; body: string }

function steps(): Step[] {
  return [
    { title: 'Welcome to Elecia', art: sprig(110), body: 'Call the 2026 Senate and Governor races the way you think they will go. It takes a few minutes, and you can skip this tour at any time.' },
    { title: 'Two different questions', art: tally(90), body: '<strong>Forecasting</strong> asks what you think will happen. <strong>Endorsing</strong> asks whom you want to win. They are stored separately, and you are free to disagree with yourself.' },
    { title: 'One race at a time', art: sprig(90), body: 'Each race gets a card with the nominees and the polls. Pick someone, or press <strong>Come back later</strong>. Skipped races return after about 20 more, and you can always open the list of them.' },
    { title: 'You control the polling', art: tally(90), body: 'Use the latest poll, the latest N, the last X days, or all polls. Every poll is listed with its dates and a link, and you see which ones were counted. If polling is tied or missing, the call is yours.' },
    { title: 'A map you can explore', art: sprig(90), body: 'Pan, zoom, and click a state to open its race. Prefer words to colors? The List view shows the same information as a table.' },
    { title: 'Saving, in your browser', art: tally(90), body: 'Save working versions as <em>prediction maps</em> and freeze named snapshots as <em>forecast maps</em>. Nothing leaves your device, so export a file if you want a backup.' },
    { title: 'Election night and after', art: dusk(100), body: `Predictions close at <strong>${formatInstant(FORECAST_CLOSES_AT_MS)}</strong> (${LOCAL_ZONE}). Real results start appearing at <strong>${formatInstant(RESULTS_VISIBLE_AT_MS)}</strong>. Your saved maps stay open for exploring, and you can compare them with what happened.` },
    { title: 'Facts, with sources', art: sprig(90), body: 'Elecia shows sourced facts and never tells you whom to support. There is no AI chat in this release, and everything works by hand.' },
  ];
}

let step = 0;

function dlg(): HTMLDialogElement {
  return document.getElementById('tour') as HTMLDialogElement;
}

function render(): void {
  const all = steps();
  const s = all[step]!;
  dlg().innerHTML = `<div class="tourbox"><div class="tourart">${s.art}</div>
    <p class="eyebrow">Step ${step + 1} of ${all.length}</p><h2 id="tour-title">${s.title}</h2><p>${s.body}</p>
    <div class="row wrap tournav">
      ${step > 0 ? '<button class="btn ghost small" data-action="tour-back">Back</button>' : ''}
      ${step < all.length - 1 ? '<button class="btn small" data-action="tour-next">Next</button>' : '<button class="btn small" data-action="tour-done">Start forecasting</button>'}
      <button class="link" data-action="tour-skip">Skip the tour</button>
    </div></div>`;
}

export function openTour(): void {
  step = 0;
  render();
  const d = dlg();
  if (!d.open) d.showModal();
}

function closeTour(): void {
  markSeen();
  const d = dlg();
  if (d.open) d.close();
}

function markSeen(): void {
  ctx.working.tourSeen = true;
  persist();
  hidePrompt();
}

export function hidePrompt(): void {
  const el = document.getElementById('tourprompt');
  if (el) el.innerHTML = '';
}

export function maybePromptTour(): void {
  if (ctx.working.tourSeen) return;
  const el = document.getElementById('tourprompt');
  if (!el) return;
  el.innerHTML = `<div class="tourprompt">${sprig(46)}<p><strong>First time here?</strong> Take a one-minute tour of how Elecia works.</p>
    <div class="row"><button class="btn small" data-action="tour-open">Show me</button><button class="btn small ghost" data-action="tour-skip">No thanks</button></div></div>`;
}

registerActions({
  'tour-open': () => { hidePrompt(); openTour(); },
  'tour-next': () => { step += 1; render(); },
  'tour-back': () => { step = Math.max(0, step - 1); render(); },
  'tour-done': () => { closeTour(); location.hash = '#/2026/forecasting'; },
  'tour-skip': () => closeTour(),
});

export function wireTourDialog(): void {
  dlg().addEventListener('close', () => markSeen());
}
