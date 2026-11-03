import { z } from 'zod';
import type { Race } from '../data/schema';

/**
 * Recent reporting via the GDELT DOC 2.0 API, fetched live from the visitor's browser (it allows cross-origin
 * requests). We show only the headline, publisher, date and link. GDELT asks for at most one request per
 * 5 seconds per client, so calls are queued and results are cached for 15 minutes.
 */
const ArticleSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  seendate: z.string(),
  domain: z.string(),
  language: z.string().optional(),
});
const ResponseSchema = z.object({ articles: z.array(ArticleSchema).optional() });

export interface NewsItem {
  title: string;
  url: string;
  publisher: string;
  seenAt: string; // ISO
}

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/\s+([,.:;!?])/g, '$1').trim();

/** "20261103T111500Z" -> ISO string. */
export function parseSeenDate(s: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

export function parseGdelt(json: unknown): NewsItem[] {
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const a of parsed.data.articles ?? []) {
    const seenAt = parseSeenDate(a.seendate);
    const title = clean(a.title);
    if (!seenAt || !title || seen.has(a.url) || !/^https?:\/\//.test(a.url)) continue;
    seen.add(a.url);
    out.push({ title, url: a.url, publisher: a.domain, seenAt });
  }
  return out;
}

/** Quoted candidate names; House queries add context so common names do not match unrelated stories. */
export function buildQuery(race: Race): string {
  const names = race.candidates.map((c) => `"${c.name.replace(/"/g, '')}"`);
  if (names.length === 0) return `"${race.stateName}" ${race.chamber === 'senate' ? '"Senate race"' : race.chamber === 'governor' ? '"governor race"' : '"congressional race"'} sourcelang:english`;
  const core = names.length > 1 ? `(${names.join(' OR ')})` : names[0]!;
  const ctx = race.chamber === 'house' ? ` ("Congress" OR "House" OR "congressional")` : '';
  return `${core}${ctx} sourcelang:english`;
}

export function newsUrl(query: string, timespan = '7d'): string {
  return `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=10&sort=datedesc&timespan=${timespan}`;
}

let lastCall = 0;
let queue: Promise<unknown> = Promise.resolve();
const memory = new Map<string, { at: number; items: NewsItem[] }>();
const TTL = 15 * 60_000;

export async function fetchNews(race: Race): Promise<{ items: NewsItem[]; url: string; cached: boolean }> {
  const query = buildQuery(race);
  const url = newsUrl(query);
  const hit = memory.get(url);
  if (hit && Date.now() - hit.at < TTL) return { items: hit.items, url, cached: true };
  const run = queue.then(async () => {
    const wait = lastCall + 5300 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`News service answered ${res.status}`);
    const text = await res.text();
    let json: unknown = {};
    try { json = JSON.parse(text); } catch { /* an empty or text reply means no articles */ }
    return parseGdelt(json);
  });
  queue = run.catch(() => undefined);
  const items = await run;
  memory.set(url, { at: Date.now(), items });
  return { items, url, cached: false };
}
