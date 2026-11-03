import { USPS_BY_NAME } from '../src/data/states';
import { DAY, HOUR, wikitext } from './wiki';

export interface SenateRaceSpec {
  state: string;
  special: boolean;
}

/** Headings after the "Race summary" section that name a state, e.g. "Georgia" or "Florida (special)". */
export function stateHeadingsAfterRaceSummary(wt: string): { state: string; special: boolean }[] {
  const start = wt.search(/^==+\s*Race summary\s*==+\s*$/m);
  if (start < 0) return [];
  const out: { state: string; special: boolean }[] = [];
  const seen = new Set<string>();
  for (const m of wt.slice(start).matchAll(/^={2,}\s*(.+?)\s*={2,}\s*$/gm)) {
    const raw = m[1]!.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{[^}]*\}\}/g, '').trim();
    const sp = /\(special\)/i.test(raw);
    const name = raw.replace(/\(special\)/i, '').trim();
    const state = USPS_BY_NAME[name];
    if (!state) continue;
    const key = `${state}:${sp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ state, special: sp });
  }
  return out;
}

export async function deriveGovernorStates(): Promise<string[]> {
  const page = await wikitext('2026 United States gubernatorial elections', 6 * HOUR);
  if (!page) throw new Error('Could not read the 2026 gubernatorial elections page');
  const states = stateHeadingsAfterRaceSummary(page.text).filter((x) => !x.special).map((x) => x.state);
  return [...new Set(states)].sort();
}

export async function deriveSenateRaces(): Promise<SenateRaceSpec[]> {
  const page = await wikitext('2026 United States Senate elections', 6 * HOUR);
  if (!page) throw new Error('Could not read the 2026 Senate elections page');
  return stateHeadingsAfterRaceSummary(page.text).sort((a, b) => a.state.localeCompare(b.state) || Number(a.special) - Number(b.special));
}

void DAY;
