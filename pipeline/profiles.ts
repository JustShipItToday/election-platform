import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { CandidateProfile, Dataset } from '../src/data/schema';
import { DAY, wikiJson } from './wiki';
import { getText, sleep, UA } from './http';
import { loadRoster, lastTerm, fullName, type Legislator } from './roster';
import { matchName } from './infobox';
import { plain } from './ballot';

const REST_GAP = 120;
const API_GAP = 1200;

/** Run `fn` over `items` with a fixed concurrency. */
async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          await fn(items[i]!, i);
        } catch {
          /* each item handles its own failure; the pool keeps going */
        }
      }
    }),
  );
}

interface Summary {
  type?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
  thumbnail?: { source: string };
  wikibase_item?: string;
}

const LICENSE_OK = /^(public domain|pd\b|cc0|cc[- ]by(?:[- ]sa)?[- ]\d)/i;

function sentenceCap(text: string, max = 1100): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.” '));
  return end > 300 ? cut.slice(0, end + 1) : cut;
}

function commonsFile(thumb: string): string | null {
  const m = /\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)\//.exec(thumb);
  return m ? decodeURIComponent(m[1]!) : null;
}

// ---------- Wikidata ----------
interface Claim { mainsnak?: { datavalue?: { value?: unknown } }; qualifiers?: Record<string, unknown>; rank?: string }
interface Entity { claims?: Record<string, Claim[]> }

const valueOf = (c: Claim) => c.mainsnak?.datavalue?.value;

async function wikidata(ids: string[]): Promise<Map<string, Entity>> {
  const out = new Map<string, Entity>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${chunk.join('|')}&props=claims&format=json`;
    const j: { entities?: Record<string, Entity> } = await wikiJson<{ entities?: Record<string, Entity> }>(url, 3 * DAY, API_GAP).catch(() => ({}));
    for (const [k, v] of Object.entries(j.entities ?? {})) out.set(k, v);
  }
  return out;
}

async function labels(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${chunk.join('|')}&props=labels&languages=en&format=json`;
    const j: { entities?: Record<string, { labels?: { en?: { value: string } } }> } = await wikiJson<{ entities?: Record<string, { labels?: { en?: { value: string } } }> }>(url, 30 * DAY, API_GAP).catch(() => ({}));
    for (const [k, v] of Object.entries(j.entities ?? {})) if (v.labels?.en) out.set(k, v.labels.en.value);
  }
  return out;
}

const qid = (c: Claim) => {
  const v = valueOf(c) as { id?: string } | undefined;
  return v?.id;
};

// ---------- Commons photo licenses ----------
interface ImgInfo { title: string; imageinfo?: { extmetadata?: Record<string, { value: string }> }[]; missing?: boolean }

async function commonsLicenses(files: string[]): Promise<Map<string, { license: string; credit: string }>> {
  const out = new Map<string, { license: string; credit: string }>();
  for (let i = 0; i < files.length; i += 40) {
    const chunk = files.slice(i, i + 40);
    const titles = chunk.map((f) => `File:${f}`).join('|');
    const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=extmetadata&iiextmetadatafilter=LicenseShortName|Artist|Credit&format=json&formatversion=2`;
    const j: { query?: { pages?: ImgInfo[] } } = await wikiJson<{ query?: { pages?: ImgInfo[] } }>(url, 14 * DAY, API_GAP).catch(() => ({}));
    for (const pg of j.query?.pages ?? []) {
      const meta = pg.imageinfo?.[0]?.extmetadata;
      const license = meta?.['LicenseShortName']?.value ?? '';
      if (!meta || !LICENSE_OK.test(license)) continue;
      const artist = plain(meta['Artist']?.value ?? '') || plain(meta['Credit']?.value ?? '') || 'Unknown author';
      out.set(pg.title.replace(/^File:/, '').replace(/ /g, '_'), { license, credit: artist.slice(0, 120) });
    }
  }
  return out;
}

// ---------- campaign websites (polite, verbatim only) ----------
const SITE_CACHE = '.cache/site';

function publicHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    const h = u.hostname;
    if (h === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || !h.includes('.')) return null;
    return u;
  } catch {
    return null;
  }
}

async function robotsAllows(u: URL): Promise<boolean> {
  try {
    const res = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return true;
    const txt = (await res.text()).slice(0, 20_000);
    let applies = false;
    for (const line of txt.split(/\r?\n/)) {
      const l = line.trim();
      if (/^user-agent:\s*\*/i.test(l) || /^user-agent:\s*electia/i.test(l)) applies = true;
      else if (/^user-agent:/i.test(l)) applies = false;
      else if (applies && /^disallow:\s*\/\s*$/i.test(l)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

async function campaignSite(raw: string, now: string): Promise<CandidateProfile['campaign']> {
  const u = publicHttpUrl(raw);
  if (!u) return null;
  mkdirSync(SITE_CACHE, { recursive: true });
  const file = `${SITE_CACHE}/${createHash('sha1').update(u.href).digest('hex')}.json`;
  if (existsSync(file)) {
    const c = JSON.parse(readFileSync(file, 'utf8')) as { at: number; v: CandidateProfile['campaign'] };
    if (Date.now() - c.at < 3 * DAY) return c.v;
  }
  let v: CandidateProfile['campaign'] = null;
  if (await robotsAllows(u)) {
    try {
      const res = await fetch(u.href, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
      const type = res.headers.get('content-type') ?? '';
      if (res.ok && /html/i.test(type)) {
        const buf = new Uint8Array(await res.arrayBuffer()).slice(0, 400_000);
        const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
        const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim() || null;
        const desc = decode(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ?? /<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["'](?:description|og:description)["']/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim() || null;
        let issuesUrl: string | null = null;
        for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
          if (/\b(issues|priorities|platform|where i stand|on the issues)\b/i.test(plain(m[2]!))) {
            const abs = (() => { try { return new URL(m[1]!, res.url); } catch { return null; } })();
            if (abs && abs.hostname === new URL(res.url).hostname) { issuesUrl = abs.href; break; }
          }
        }
        v = { url: res.url, title: title ? title.slice(0, 200) : null, description: desc ? desc.slice(0, 400) : null, issuesUrl, fetchedAt: now };
      }
    } catch {
      v = null;
    }
  }
  writeFileSync(file, JSON.stringify({ at: Date.now(), v }));
  return v;
}

// ---------- congressional service (public record) ----------
function serviceLines(l: Legislator): string[] {
  const lines: string[] = [];
  let cur: { label: string; from: number; to: number } | null = null;
  for (const t of l.terms) {
    const label = t.type === 'sen' ? `U.S. Senate (${t.state})` : `U.S. House (${t.state}${t.district === 0 || t.district === undefined ? ' at-large' : `-${t.district}`})`;
    const from = Number(t.start.slice(0, 4));
    const to = Number(t.end.slice(0, 4));
    if (cur && cur.label === label && from <= cur.to + 1) cur.to = Math.max(cur.to, to);
    else {
      if (cur) lines.push(`${cur.label}, ${cur.from}–${cur.to >= 2026 ? 'present' : cur.to}`);
      cur = { label, from, to };
    }
  }
  if (cur) lines.push(`${cur.label}, ${cur.from}–${cur.to >= 2026 ? 'present' : cur.to}`);
  return lines;
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function buildCandidateProfiles(ds: Dataset, now: string, warnings: string[]): Promise<Record<string, CandidateProfile>> {
  const roster = await loadRoster(now);
  const people = ds.races.flatMap((r) => r.candidates.map((c) => ({ race: r, c })));
  const withTitle = people.filter((p) => p.c.wikipediaTitle);
  console.log(`profiles: ${people.length} candidates, ${withTitle.length} with a Wikipedia article`);

  // 1. Wikipedia summaries (bio text, thumbnail, Wikidata id)
  const summaries = new Map<string, Summary>();
  await pool(withTitle, 4, async ({ c }) => {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c.wikipediaTitle!.replace(/ /g, '_'))}?redirect=true`;
    const s = await wikiJson<Summary>(url, 7 * DAY, REST_GAP).catch(() => null);
    if (s && s.type !== 'disambiguation' && s.extract) summaries.set(c.id, s);
  });
  console.log(`summaries: ${summaries.size}`);

  // 2. Wikidata facts
  const ids = [...new Set([...summaries.values()].map((s) => s.wikibase_item).filter((x): x is string => !!x))];
  const entities = await wikidata(ids);
  const refIds = new Set<string>();
  for (const e of entities.values()) {
    for (const c of [...(e.claims?.['P39'] ?? []), ...(e.claims?.['P69'] ?? [])]) {
      const q = qid(c);
      if (q) refIds.add(q);
    }
  }
  const labelMap = await labels([...refIds]);
  console.log(`wikidata entities: ${entities.size}, labels: ${labelMap.size}`);

  // 3. Commons photo licenses
  const commonsNames = new Map<string, string>();
  for (const [id, s] of summaries) {
    const f = s.thumbnail ? commonsFile(s.thumbnail.source) : null;
    if (f) commonsNames.set(id, f);
  }
  const licenses = await commonsLicenses([...new Set(commonsNames.values())]);
  console.log(`commons photos with allowed license: ${licenses.size} of ${new Set(commonsNames.values()).size}`);

  // 4. Roster matches (current members): public-domain portrait + service history
  const members = [...roster.senators, ...roster.reps];
  const memberFor = (state: string, chamber: string, district: string | null, name: string): Legislator | undefined => {
    const pool2 = members.filter((m) => lastTerm(m).state === state);
    const byName = pool2.find((m) => matchName(fullName(m), name));
    if (byName) return byName;
    void chamber; void district;
    return undefined;
  };

  const out: Record<string, CandidateProfile> = {};
  const bioguideById = new Map<string, string>();
  const siteJobs: { id: string; url: string }[] = [];
  for (const { race, c } of people) {
    const s = summaries.get(c.id);
    const ent = s?.wikibase_item ? entities.get(s.wikibase_item) : undefined;
    const claims = ent?.claims ?? {};
    const birthRaw = (valueOf(claims['P569']?.[0] ?? {}) as { time?: string } | undefined)?.time ?? null;
    const birth = birthRaw ? birthRaw.replace(/^\+/, '').slice(0, 10) : null;
    const website = (valueOf(claims['P856']?.[0] ?? {}) as string | undefined) ?? null;
    const positions = (claims['P39'] ?? []).map(qid).filter((x): x is string => !!x).map((q) => labelMap.get(q)).filter((x): x is string => !!x);
    const education = (claims['P69'] ?? []).map(qid).filter((x): x is string => !!x).map((q) => labelMap.get(q)).filter((x): x is string => !!x);
    const member = memberFor(race.state, race.chamber, race.district, c.name);
    const f = commonsNames.get(c.id);
    const lic = f ? licenses.get(f.replace(/ /g, '_')) : undefined;
    out[c.id] = {
      photo: lic && f && s?.thumbnail
        ? { url: s.thumbnail.source, credit: lic.credit, license: lic.license, pageUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(f.replace(/ /g, '_'))}`, kind: 'commons' }
        : null,
      bio: s?.extract
        ? { text: sentenceCap(s.extract), url: s.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(c.wikipediaTitle ?? '')}`, license: 'CC BY-SA 4.0', retrievedAt: now }
        : null,
      facts: { birth, positions: [...new Set(positions)].slice(0, 8), education: [...new Set(education)].slice(0, 5), website, wikidataId: s?.wikibase_item ?? null },
      congressService: member ? serviceLines(member) : [],
      campaign: null,
    };
    if (website) siteJobs.push({ id: c.id, url: website });
    if (member) bioguideById.set(c.id, member.id.bioguide);
  }

  // 5. Official portraits for sitting members (verify each exists)
  // The official portrait (public domain) beats a Commons photo whenever we can confirm it exists.
  await pool([...bioguideById], 8, async ([id, bio]) => {
    const url = `https://unitedstates.github.io/images/congress/225x275/${bio}.jpg`;
    if (await headOk(url)) {
      out[id]!.photo = { url, credit: 'Official congressional portrait', license: 'Public domain (U.S. government work)', pageUrl: `https://bioguide.congress.gov/search/bio/${bio}`, kind: 'bioguide' };
    }
  });

  // 6. Campaign websites
  console.log(`campaign sites to read: ${siteJobs.length}`);
  await pool(siteJobs, 6, async ({ id, url }) => {
    out[id]!.campaign = await campaignSite(url, now);
    await sleep(100);
  });
  console.log(`campaign sites read: ${Object.values(out).filter((p) => p.campaign).length}`);

  const withPhoto = Object.values(out).filter((p) => p.photo).length;
  const withBio = Object.values(out).filter((p) => p.bio).length;
  warnings.push(`Candidate profiles: ${withBio} with a bio, ${withPhoto} with a verified photo, out of ${people.length} candidates.`);
  void getText;
  return out;
}
