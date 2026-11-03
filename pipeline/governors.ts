import type { Party } from '../src/data/schema';
import { USPS_BY_NAME } from '../src/data/states';
import { normalizeParty } from './infobox';
import { HOUR, tableRows, wikitext } from './wiki';

export interface SittingGovernor {
  state: string;
  name: string;
  party: Party;
  partyLabel: string;
}

/** Parse Wikipedia's "List of current United States governors" table. */
export function parseGovernors(wt: string): SittingGovernor[] {
  const tableStart = wt.indexOf('{| class="wikitable');
  const table = tableStart >= 0 ? wt.slice(tableStart) : wt;
  const out: SittingGovernor[] = [];
  for (const row of tableRows(table)) {
    const st = /\[\[Governor of ([^\]|]+)\|/.exec(row);
    if (!st) continue;
    const state = USPS_BY_NAME[st[1]!.trim()];
    if (!state) continue;
    const party = /\{\{party color\|([^}|]+)/i.exec(row);
    const nameCell = /^!\s*scope="row"\s*\|\s*(.+)$/m.exec(row)?.[1] ?? '';
    const sn = /\{\{sortname\|([^|}]*)\|([^|}]*)/i.exec(nameCell);
    const link = /\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/.exec(nameCell);
    const name = sn ? `${sn[1]!.trim()} ${sn[2]!.trim()}` : link ? link[1]!.trim() : '';
    if (!name || !party) continue;
    const partyLabel = party[1]!.trim();
    out.push({ state, name, party: normalizeParty(partyLabel), partyLabel });
  }
  return out;
}

export async function loadGovernors(): Promise<{ governors: SittingGovernor[]; url: string; revisionId: number | null }> {
  const page = await wikitext('List of current United States governors', 6 * HOUR);
  if (!page) throw new Error('Could not read the current governors list');
  const governors = parseGovernors(page.text);
  if (governors.length !== 50) throw new Error(`Expected 50 sitting governors, parsed ${governors.length}`);
  if (new Set(governors.map((g) => g.state)).size !== 50) throw new Error('Duplicate states in the governors list');
  return { governors, url: page.url, revisionId: page.revisionId };
}
