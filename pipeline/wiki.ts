import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { getText, sleep } from './http';

/**
 * Polite, cached Wikipedia client. Wikimedia rate-limits shared IPs, so requests are
 * paced (>= 1.2 s apart) and responses are cached on disk with a per-call TTL. Fast-moving
 * race pages use a short TTL; history and list pages use long ones.
 */
const CACHE_DIR = process.env['WIKI_CACHE_DIR'] ?? '.cache/wiki';
const MIN_GAP_MS = 1200;
let lastRequestAt = 0;

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

async function cached(key: string, ttlMs: number, fetcher: () => Promise<string>, gapMs = MIN_GAP_MS): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = `${CACHE_DIR}/${createHash('sha1').update(key).digest('hex')}.json`;
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < ttlMs) return readFileSync(file, 'utf8');
  const wait = lastRequestAt + gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  let body: string;
  try {
    body = await fetcher();
  } catch (e) {
    // A stale cache entry is better than nothing when Wikipedia is rate-limiting us.
    if (existsSync(file)) return readFileSync(file, 'utf8');
    throw e;
  }
  writeFileSync(file, body);
  return body;
}

export interface WikiPage {
  title: string;
  text: string;
  /** Revision id when available, for citation. */
  revisionId: number | null;
  url: string;
}

export function pageUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export async function wikitext(title: string, ttlMs = 15 * MIN): Promise<WikiPage | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content|ids&rvslots=main&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(title)}`;
  const body = await cached(`wt:${title}`, ttlMs, () => getText(url));
  const j = JSON.parse(body) as {
    query: { pages: { title: string; missing?: boolean; revisions?: { revid: number; slots: { main: { content: string } } }[] }[] };
  };
  const page = j.query.pages[0];
  if (!page || page.missing || !page.revisions?.[0]) return null;
  const rev = page.revisions[0];
  return { title: page.title, text: rev.slots.main.content, revisionId: rev.revid ?? null, url: pageUrl(page.title) };
}

/** gapMs lets high-capacity read APIs (REST summaries, batched queries) be called faster than page loads. */
export async function wikiJson<T>(url: string, ttlMs: number, gapMs = MIN_GAP_MS): Promise<T> {
  return JSON.parse(await cached(`json:${url}`, ttlMs, () => getText(url), gapMs)) as T;
}

/** Split a wikitext table body into rows (text between "|-" separators). */
export function tableRows(wt: string): string[] {
  return wt.split(/\n\|-[^\n]*\n/).map((r) => r.trim()).filter(Boolean);
}
