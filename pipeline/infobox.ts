import type { Party } from '../src/data/schema';

export type Infobox = Map<string, string>;

/** Extract the first {{Infobox election ...}} template and return its fields (cleaned). */
export function parseInfobox(wikitext: string): Infobox {
  const start = wikitext.search(/\{\{\s*Infobox election/i);
  const out: Infobox = new Map();
  if (start < 0) return out;
  let depth = 0;
  let link = 0;
  let i = start;
  let end = wikitext.length;
  const fields: string[] = [];
  let cur = '';
  let first = true;
  for (; i < wikitext.length; i++) {
    const two = wikitext.slice(i, i + 2);
    if (two === '{{') { depth++; cur += two; i++; continue; }
    if (two === '}}') {
      depth--;
      if (depth === 0) { end = i; break; }
      cur += two; i++; continue;
    }
    if (two === '[[') { link++; cur += two; i++; continue; }
    if (two === ']]') { link--; cur += two; i++; continue; }
    const ch = wikitext[i]!;
    if (ch === '|' && depth === 1 && link === 0) {
      if (first) first = false; else fields.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  void end;
  fields.push(cur);
  for (const f of fields) {
    const eq = f.indexOf('=');
    if (eq < 0) continue;
    const key = f.slice(0, eq).trim().toLowerCase();
    const val = clean(f.slice(eq + 1));
    if (key && val) out.set(key, val);
  }
  return out;
}

function stripTemplates(s: string, names: RegExp): string {
  // Remove balanced {{name ...}} templates (efn, sfn, etc.).
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('{{', i)) {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s.startsWith('{{', j)) { depth++; j++; }
        else if (s.startsWith('}}', j)) { depth--; j++; if (depth === 0) break; }
      }
      const body = s.slice(i + 2, j - 1);
      if (names.test(body)) { i = j + 1; continue; }
      out += s.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += s[i];
    i++;
  }
  return out;
}

function clean(raw: string): string {
  let s = raw.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  s = stripTemplates(s, /^\s*(efn|sfn|notelist|cite|citation|refn)/i);
  s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
  return s.replace(/''+/g, '').trim();
}

/** "[[Mike Rogers (Michigan politician)|Mike Rogers]]" -> { target, display } */
export function linkTarget(raw: string): { target: string | null; display: string } {
  const m = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/.exec(raw);
  if (m) {
    const target = m[1]!.trim();
    const display = (m[2] ?? m[1]!).trim();
    return { target, display: display.replace(/\s+\(.*\)$/, '').trim() };
  }
  const plain = raw.replace(/\{\{[^}]*\}\}/g, '').replace(/\[|\]/g, '').trim();
  return { target: null, display: plain };
}

export function normalizeParty(raw: string): Party {
  const s = raw.toLowerCase();
  if (s.includes('democrat')) return 'D';
  if (s.includes('republican')) return 'R';
  return 'O';
}

export function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function nameTokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Same person if last names match and first initials match. */
export function matchName(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  return ta[ta.length - 1] === tb[tb.length - 1] && ta[0]![0] === tb[0]![0];
}
