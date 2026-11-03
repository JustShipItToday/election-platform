import type { Candidate, Race, Research } from '../data/schema';
import { ctx, esc, PARTY_NAME } from '../ctx';
import { fetchNews, type NewsItem } from '../news/gdelt';
import { registerActions } from './actions';

let research: Research | null = null;
let loading: Promise<void> | null = null;
let missing = false;
let onLoaded: () => void = () => {};

export function setResearchListener(fn: () => void): void {
  onLoaded = fn;
}

/** Fetched once, on demand. A missing file simply means "no research context available". */
export function ensureResearch(): void {
  if (research || loading) return;
  loading = fetch(`${import.meta.env.BASE_URL}data/research.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: Research | null) => {
      research = j;
      missing = j === null;
      onLoaded();
    })
    .catch(() => { missing = true; onLoaded(); });
}

export function researchLoaded(): boolean {
  return research !== null;
}

export function getResearch(): Research | null {
  return research;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((p) => p[0]!).slice(0, 2).join('').toUpperCase();

/** A verified photo, or initials. Never a guessed image. */
export function avatar(c: Candidate, size = 44): string {
  const photo = research?.candidates[c.id]?.photo;
  const fallback = `<span class="avatar-fallback ${c.party}" aria-hidden="true">${esc(initials(c.name))}</span>`;
  if (!photo) return `<span class="avatar" style="width:${size}px;height:${size}px">${fallback}</span>`;
  return `<span class="avatar" style="width:${size}px;height:${size}px"><img class="cphoto" src="${esc(photo.url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="${size}" height="${size}" data-fallback="${esc(initials(c.name))}" data-party="${c.party}"></span>`;
}

function ratingsHtml(race: Race): string {
  const r = research?.races[race.id];
  if (!r) return '';
  const rows = r.ratings
    .map((x) => `<tr><td>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.source)}</a>` : esc(x.source)}</td><td><strong>${esc(x.rating)}</strong></td><td>${esc(x.asOf)}</td></tr>`)
    .join('');
  return `<details class="rsec"><summary>Analyst ratings (${r.ratings.length})</summary>
    ${r.ratings.length
      ? `<div class="tablewrap"><table class="pt"><thead><tr><th>Organization</th><th>Rating</th><th>As of</th></tr></thead><tbody>${rows}</tbody></table></div>
         <p class="muted small">These are the named organizations' own classifications, as listed on <a href="${esc(r.ratingsUrl ?? race.source.url)}" target="_blank" rel="noopener noreferrer">Wikipedia</a>. They are not Elecia's view and not a prediction we make.</p>`
      : '<p class="muted">No ratings are listed for this race on its Wikipedia page.</p>'}
  </details>`;
}

function historyHtml(race: Race): string {
  const r = research?.races[race.id];
  if (!r) return '';
  const blocks = r.history
    .map((h) => `<h4><a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer">${esc(h.title)}</a></h4>
      <div class="tablewrap"><table class="pt"><thead><tr><th>Candidate</th><th>Party</th><th>Votes</th><th>Share</th></tr></thead><tbody>${h.results
        .map((x) => `<tr><td>${esc(x.name)}</td><td><span class="chip ${x.party}">${x.party}</span> ${esc(x.partyLabel)}</td><td>${x.votes !== null ? x.votes.toLocaleString('en-US') : '–'}</td><td>${x.pct !== null ? `${x.pct}%` : '–'}</td></tr>`)
        .join('')}</tbody></table></div>`)
    .join('');
  return `<details class="rsec"><summary>Past results (${r.history.length})</summary>${blocks || '<p class="muted">No previous result could be read for this race.</p>'}
    <p class="muted small">Historical results as listed on Wikipedia. District lines may have changed since.</p></details>`;
}

function candidatesHtml(race: Race): string {
  if (!research) return '';
  const cards = race.candidates
    .map((c) => {
      const p = research!.candidates[c.id];
      const src: string[] = [];
      const lines: string[] = [];
      if (p?.bio) {
        lines.push(`<p>${esc(p.bio.text)}</p>`);
        src.push(`<a href="${esc(p.bio.url)}" target="_blank" rel="noopener noreferrer">Wikipedia</a> (${esc(p.bio.license)})`);
      }
      const facts: string[] = [];
      if (p?.facts.birth) facts.push(`Born ${esc(p.facts.birth)}`);
      if (p?.facts.positions.length) facts.push(`Offices held: ${esc(p.facts.positions.join('; '))}`);
      if (p?.facts.education.length) facts.push(`Education: ${esc(p.facts.education.join('; '))}`);
      if (facts.length) { lines.push(`<p class="small">${facts.join(' · ')} <span class="tag">Wikidata</span></p>`); }
      if (p?.congressService.length) lines.push(`<p class="small"><strong>Congressional service (public record):</strong> ${esc(p.congressService.join('; '))}</p>`);
      if (p?.campaign) {
        const cm = p.campaign;
        lines.push(`<p class="small"><span class="tag">Campaign claim</span> From <a href="${esc(cm.url)}" target="_blank" rel="noopener noreferrer">the campaign's website</a>${cm.description ? `: “${esc(cm.description)}”` : cm.title ? `: “${esc(cm.title)}”` : ''}${cm.issuesUrl ? ` · <a href="${esc(cm.issuesUrl)}" target="_blank" rel="noopener noreferrer">Issues page</a>` : ''}</p>`);
      } else if (p?.facts.website) {
        lines.push(`<p class="small"><span class="tag">Campaign</span> <a href="${esc(p.facts.website)}" target="_blank" rel="noopener noreferrer">Official website</a></p>`);
      }
      const credit = p?.photo ? `<p class="muted small">Photo: ${esc(p.photo.credit)}, ${esc(p.photo.license)} · <a href="${esc(p.photo.pageUrl)}" target="_blank" rel="noopener noreferrer">source</a></p>` : '';
      return `<div class="ccard"><div class="chead">${avatar(c, 64)}<div><strong>${esc(c.name)}</strong><br><span class="chip ${c.party}">${c.party}</span> <span class="muted small">${esc(c.partyLabel || PARTY_NAME[c.party])}</span></div></div>
        ${lines.join('') || '<p class="muted">No sourced profile is available for this candidate.</p>'}${credit}
        ${src.length ? `<p class="muted small">Sources: ${src.join(', ')}. Elecia does not rewrite or judge these descriptions.</p>` : ''}</div>`;
    })
    .join('');
  return `<details class="rsec"><summary>About the candidates</summary>${cards}</details>`;
}

const newsHtmlByRace = new Map<string, string>();

export function newsListHtml(items: NewsItem[], url: string, cached: boolean): string {
  if (!items.length) return '<p class="muted">No headlines about these candidates were found in the last 7 days.</p>';
  return `<ul class="newslist">${items
    .map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a><br><span class="muted small">${esc(n.publisher)} · ${esc(n.seenAt.slice(0, 16).replace('T', ' '))} UTC</span></li>`)
    .join('')}</ul><p class="muted small">Found by <a href="${esc(url.replace('mode=artlist&format=json', 'mode=artlist'))}" target="_blank" rel="noopener noreferrer">GDELT</a>${cached ? ' (shown from the last 15 minutes)' : ''}. These are news reports, not facts established by Elecia, and are separate from polls and records.</p>`;
}

function newsHtml(race: Race): string {
  return `<details class="rsec"><summary>Recent news reporting</summary>
    <p class="muted small">Headlines about the candidates from the last 7 days. Headline, publisher, date and link only; Elecia does not summarize or vouch for them.</p>
    <button class="btn small" data-action="news-load" data-race="${esc(race.id)}">Load recent news</button>
    <div class="newsout" id="news-${esc(race.id)}" aria-live="polite">${newsHtmlByRace.get(race.id) ?? ''}</div></details>`;
}

registerActions({
  'news-load': async (el) => {
    const race = ctx.data.races.find((r) => r.id === el.dataset['race']);
    const out = race ? document.getElementById(`news-${race.id}`) : null;
    if (!race || !out) return;
    out.innerHTML = '<p class="muted">Looking up headlines…</p>';
    try {
      const r = await fetchNews(race);
      const html = newsListHtml(r.items, r.url, r.cached);
      newsHtmlByRace.set(race.id, html);
      out.innerHTML = html;
    } catch {
      out.innerHTML = '<p class="muted">The news service is busy or unreachable. Try again in a few seconds.</p>';
    }
  },
});

/** Research sections for a race card. Each is a separate, labeled category. */
export function researchSections(race: Race): string {
  ensureResearch();
  if (missing) return '';
  if (!research) return `<p class="muted small">Loading research context…</p>`;
  return `<div class="research"><h3 class="side-h">Research this race</h3>${candidatesHtml(race)}${ratingsHtml(race)}${historyHtml(race)}${newsHtml(race)}</div>`;
}

void ctx;
