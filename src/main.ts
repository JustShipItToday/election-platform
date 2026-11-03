import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';
import './styles.css';
import { DatasetSchema, CallsFileSchema, OfficialSchema } from './data/schema';
import { ctx, esc, initWorking, onChange, phase, emit } from './ctx';
import { initSimulation, startClockSync, now } from './domain/clock';
import { FORECAST_CLOSES_AT_MS } from './domain/lifecycle';
import { installActionDelegation } from './ui/actions';
import { setMapPickHandler, applyMapTheme } from './ui/map';
import { mountFlow, onMapPick, refreshFlow } from './ui/flow';
import { aboutPage, statusPage, mountReconcileMap, blogPage, bannerHtml, closedPage, contactPage, reconcilePage, resultsPage, savedDetail, savedPage, setSavedRerender, termsPage } from './ui/pages';
import { maybePromptTour, wireTourDialog } from './ui/tour';
import { tally } from './ui/mascots';

const app = document.getElementById('app') as HTMLElement;

// ---- adaptive performance tier ----
function detectTier(): 'lite' | 'balanced' | 'full' {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mem = nav.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  if (reduced || nav.connection?.saveData || mem <= 2 || cores <= 2) return 'lite';
  if (mem <= 4 || cores <= 4) return 'balanced';
  return 'full';
}
document.documentElement.dataset['tier'] = detectTier();
initSimulation();

// ---- shell ----
function renderTop(route: string): void {
  const p = phase();
  const link = (href: string, label: string, active: boolean, extra = '') =>
    `<a href="${href}" class="${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${label}${extra}</a>`;
  const is = (s: string) => route === s || route.startsWith(s + '/');
  document.getElementById('top')!.innerHTML = `
    <a class="brand" href="#/2026/forecasting" aria-label="Elecia home"><span class="logo" aria-hidden="true">${tally(34)}</span><span class="name">Elecia</span></a>
    <nav class="primary" aria-label="2026">
      <span class="yr">2026</span>
      ${link('#/2026/forecasting', 'Forecasting', is('/2026/forecasting'))}
      ${link('#/2026/endorsing', 'Endorsing', is('/2026/endorsing'))}
      ${link('#/2026/reconcile', 'Reconcile', is('/2026/reconcile'))}
      ${link('#/2026/saved', 'Saved', is('/2026/saved'))}
      ${p === 'results' ? link('#/2026/results', 'Results', is('/2026/results')) : ''}
    </nav>
    <nav class="secondary" aria-label="More">
      ${link('#/about', 'About', is('/about'))}${link('#/blog', 'Blog', is('/blog'))}${link('#/contact', 'Contact', is('/contact'))}${link('#/terms', 'Terms', is('/terms'))}
      <button class="themebtn" data-action="theme" aria-label="Switch light or dark theme" title="Switch theme">Theme</button>
    </nav>`;
}

function renderFoot(): void {
  document.getElementById('foot')!.innerHTML = `<p><a href="#/status">Data status</a> · Elecia is free and keeps your choices in your browser. Polls: <a href="https://votehub.com/polls/api/" target="_blank" rel="noopener noreferrer">VoteHub</a> (CC BY 4.0), each linked to its original source. Candidates: Wikipedia (CC BY-SA 4.0). Senate roster: congress-legislators. Map: U.S. Census Bureau. Not affiliated with any campaign or party.</p>`;
}

function updateBanner(): void {
  const el = document.getElementById('banner')!;
  const html = bannerHtml();
  if (el.dataset['h'] !== html) {
    el.innerHTML = html;
    el.dataset['h'] = html;
  }
  el.dataset['phase'] = phase();
}

// ---- router ----
let lastPhase = phase();

function route(): string {
  const h = location.hash.replace(/^#/, '');
  return h === '' || h === '/' ? '/2026/forecasting' : h;
}

async function render(): Promise<void> {
  const r = route();
  renderTop(r);
  document.body.dataset['route'] = r.split('/')[1] === '2026' ? `2026-${r.split('/')[2] ?? ''}` : (r.split('/')[1] ?? '');
  const open = phase() === 'open';
  if (r === '/2026/forecasting' || r === '/2026/endorsing') {
    if (!open) { app.innerHTML = closedPage(); return; }
    mountFlow(app, r.endsWith('endorsing') ? 'endorse' : 'forecast');
    maybePromptTour();
  } else if (r === '/2026/reconcile') { app.innerHTML = reconcilePage(); mountReconcileMap(app); }
  else if (r === '/2026/results') app.innerHTML = phase() === 'results' ? resultsPage() : closedPage();
  else if (r === '/2026/saved') {
    setSavedRerender(() => void savedPage(app));
    await savedPage(app);
  } else if (r.startsWith('/2026/saved/')) {
    await savedDetail(app, decodeURIComponent(r.slice('/2026/saved/'.length)));
  } else if (r === '/about') app.innerHTML = aboutPage();
  else if (r === '/blog') app.innerHTML = blogPage();
  else if (r === '/status') app.innerHTML = statusPage();
  else if (r === '/contact') app.innerHTML = contactPage();
  else if (r === '/terms') app.innerHTML = termsPage();
  else app.innerHTML = `<article class="page"><h1>Page not found</h1><p><a href="#/2026/forecasting">Go to Forecasting</a></p></article>`;
  window.scrollTo({ top: 0 });
}

// ---- data ----
async function load(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const [d, c, dm] = await Promise.all([
    fetch(`${base}data/dataset.json`, { cache: 'no-cache' }).then((x) => x.json()),
    fetch(`${base}data/calls.json`, { cache: 'no-cache' }).then((x) => x.json()),
    fetch(`${base}data/districts-meta.json`).then((x) => x.json()).catch(() => ({ redrawnStates: [] })),
  ]);
  const off = await fetch(`${base}data/official.json`, { cache: 'no-cache' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  const parsedOff = OfficialSchema.safeParse(off);
  ctx.official = parsedOff.success ? parsedOff.data : null;
  ctx.redrawn = new Set<string>((dm as { redrawnStates?: string[] }).redrawnStates ?? []);
  ctx.data = DatasetSchema.parse(d);
  ctx.calls = CallsFileSchema.parse(c);
}

async function refreshData(): Promise<void> {
  try {
    await load();
    emit();
    const r = route();
    if (r === '/2026/results' || r.startsWith('/2026/saved/')) await render();
    else refreshFlow();
  } catch {
    /* keep showing the last good data */
  }
}

async function boot(): Promise<void> {
  app.innerHTML = `<div class="loading">${tally(80)}<p>Loading the greenhouse…</p></div>`;
  renderFoot();
  installActionDelegation(document.body);
  wireTourDialog();
  startClockSync();
  try {
    await load();
  } catch (e) {
    app.innerHTML = `<article class="page"><h1>The data did not load</h1><p>Check your connection and reload. If it keeps happening, tell us on the <a href="https://github.com/JustShipItToday/election-platform/issues">issues page</a>.</p><p class="muted small">${esc(String(e))}</p></article>`;
    return;
  }
  initWorking();
  setMapPickHandler(onMapPick);
  window.addEventListener('hashchange', () => void render());
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => applyMapTheme());
  await render();
  updateBanner();
  window.setInterval(() => {
    updateBanner();
    const p = phase();
    if (p !== lastPhase) {
      lastPhase = p;
      void render();
    }
  }, 1000);
  window.setInterval(() => void refreshData(), 5 * 60_000);
  onChange(() => { /* flow re-renders itself; hook kept for future listeners */ });
  void FORECAST_CLOSES_AT_MS; void now;
}

// theme toggle (explicit choice overrides system)
import { registerActions } from './ui/actions';
registerActions({
  theme: () => {
    const root = document.documentElement;
    const cur = root.dataset['theme'] ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    root.dataset['theme'] = next;
    try { localStorage.setItem('elecia:theme', next); } catch { /* optional */ }
    window.setTimeout(applyMapTheme, 30);
  },
});
try {
  const t = localStorage.getItem('elecia:theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset['theme'] = t;
} catch { /* optional */ }

// A photo that fails to load falls back to initials; we never substitute another image.
document.addEventListener('error', (e) => {
  const t = e.target as HTMLElement | null;
  if (t instanceof HTMLImageElement && t.classList.contains('cphoto')) {
    const span = document.createElement('span');
    span.className = `avatar-fallback ${t.dataset['party'] ?? 'O'}`;
    span.setAttribute('aria-hidden', 'true');
    span.textContent = t.dataset['fallback'] ?? '';
    t.replaceWith(span);
  }
}, true);

void boot();
