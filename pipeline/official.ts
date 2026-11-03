/**
 * Builds public/data/official.json from state election offices whose feeds have been verified.
 * Today: North Carolina. Each adapter validates its own format and fails loudly if it changes.
 *   npm run official
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DatasetSchema, OfficialSchema, type Official } from '../src/data/schema';
import { NC_NAME, NC_URL, fetchNc, ncToOfficial, parseNcResults } from './official/nc';

async function main() {
  const ds = DatasetSchema.parse(JSON.parse(readFileSync('public/data/dataset.json', 'utf8')));
  const feeds: Official['feeds'] = [];
  try {
    const { tsv, asOf } = await fetchNc();
    const contests = ncToOfficial(parseNcResults(tsv), ds);
    if (!contests['senate-NC']) throw new Error('NC feed has no US Senate contest');
    const houseCount = Object.keys(contests).filter((k) => k.startsWith('house-NC-')).length;
    if (houseCount !== 14) throw new Error(`NC feed has ${houseCount} House contests, expected 14`);
    feeds.push({ state: 'NC', name: NC_NAME, url: NC_URL, asOf, contests });
    const total = Object.values(contests).reduce((n, c) => n + c.totalVotes, 0);
    console.log(`NC: ${Object.keys(contests).length} contests, ${total} votes counted, file time ${asOf}`);
  } catch (e) {
    console.error('NC adapter failed:', String(e));
  }
  writeFileSync('public/data/official.json', JSON.stringify(OfficialSchema.parse({ generatedAt: new Date().toISOString(), feeds })));
}

main().catch((e) => { console.error(e); process.exit(1); });
