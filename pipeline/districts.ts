/**
 * Builds public/data/districts.json (TopoJSON) from the U.S. Census Bureau's TIGER/Line 2026
 * congressional district files for the 120th Congress (the districts elected on Nov 3, 2026).
 *   npm run districts            build
 *   npm run districts -- --verify  also compare against TIGER 2025 (119th) to show which states were redrawn
 * District shapes do not change on election night, so this runs by hand and the output is committed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
// @ts-expect-error the shapefile package ships no types
import * as shapefile from 'shapefile';
import { topology } from 'topojson-server';
import { quantize } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { FIPS_TO_USPS } from '../src/data/states';
import { getBuffer, getJson } from './http';

const CACHE = '.cache/tiger';
const verify = process.argv.includes('--verify');

async function zipFor(year: 2025 | 2026, fips: string): Promise<Uint8Array> {
  const cd = year === 2026 ? 'cd120' : 'cd119';
  const name = `tl_${year}_${fips}_${cd}.zip`;
  mkdirSync(CACHE, { recursive: true });
  const file = `${CACHE}/${name}`;
  if (!existsSync(file)) {
    const buf = await getBuffer(`https://www2.census.gov/geo/tiger/TIGER${year}/CD/${name}`);
    writeFileSync(file, buf);
  }
  return new Uint8Array(readFileSync(file));
}

async function readState(year: 2025 | 2026, fips: string): Promise<Feature<Geometry, Record<string, unknown>>[]> {
  const z = unzipSync(await zipFor(year, fips));
  const shp = Object.entries(z).find(([k]) => k.endsWith('.shp'))?.[1];
  const dbf = Object.entries(z).find(([k]) => k.endsWith('.dbf'))?.[1];
  if (!shp || !dbf) throw new Error(`Missing shp/dbf for ${fips} ${year}`);
  const fc = (await shapefile.read(shp, dbf)) as FeatureCollection<Geometry, Record<string, unknown>>;
  return fc.features;
}

/** Iterative Douglas-Peucker; always keeps the first and last point of an arc. */
function douglasPeucker(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a]!;
    const [bx, by] = pts[b]!;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]!);
  return out.length >= 2 ? out : [pts[0]!, pts[pts.length - 1]!];
}

const districtCode = (cd: string) => (cd === '00' ? 'AL' : String(Number(cd)));
const isVoting = (cd: string) => cd !== 'ZZ' && cd !== '98' && cd !== '99';

interface Roster { terms: { type: string; state: string; district?: number }[] }

async function main() {
  const roster = await getJson<Roster[]>('https://unitedstates.github.io/congress-legislators/legislators-current.json');
  const repsByState = new Map<string, number>();
  for (const l of roster) {
    const t = l.terms[l.terms.length - 1]!;
    if (t.type === 'rep') repsByState.set(t.state, (repsByState.get(t.state) ?? 0) + 1);
  }

  const features: Feature<Geometry, { id: string; state: string; district: string }>[] = [];
  const perState = new Map<string, number>();
  for (const [fips, usps] of Object.entries(FIPS_TO_USPS)) {
    const feats = await readState(2026, fips);
    for (const f of feats) {
      const cd = String(f.properties['CD120FP']);
      if (!isVoting(cd)) continue;
      const district = districtCode(cd);
      features.push({ type: 'Feature', geometry: f.geometry, properties: { id: `house-${usps}-${district}`, state: usps, district } });
      perState.set(usps, (perState.get(usps) ?? 0) + 1);
    }
    process.stdout.write(`${usps}:${perState.get(usps)} `);
  }
  console.log();
  const total = features.length;
  if (total !== 435) throw new Error(`Expected 435 voting districts, found ${total}`);
  // Cross-check with the sitting-member roster: a state can have vacancies, never more members than districts.
  for (const [usps, n] of perState) {
    const reps = repsByState.get(usps) ?? 0;
    if (reps > n) throw new Error(`${usps}: roster has ${reps} members but only ${n} districts`);
  }

  // Build shared arcs first, then simplify each arc once, so neighbouring districts keep matching borders.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo = topology({ districts: { type: 'FeatureCollection', features } as any });
  const eps = Number(process.env['EPSILON'] ?? 0.002);
  topo.arcs = topo.arcs.map((arc) => douglasPeucker(arc as [number, number][], eps));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slim = quantize(topo as any, 1e5);
  mkdirSync('public/data', { recursive: true });
  const out = JSON.stringify(slim);
  writeFileSync('public/data/districts.json', out);
  console.log(`districts=${total} bytes=${out.length}`);

  if (verify) {
    // Land area of a district barely changes between annual releases unless its lines were redrawn.
    const rows: { state: string; maxChange: number }[] = [];
    for (const [fips, usps] of Object.entries(FIPS_TO_USPS)) {
      const area = (fs: Feature<Geometry, Record<string, unknown>>[], key: string) =>
        new Map(fs.filter((f) => isVoting(String(f.properties[key]))).map((f) => [String(f.properties[key]), Number(f.properties['ALAND'])]));
      const a = area(await readState(2025, fips), 'CD119FP');
      const b = area(await readState(2026, fips), 'CD120FP');
      let max = 0;
      for (const [k, v] of b) max = Math.max(max, Math.abs(v - (a.get(k) ?? 0)) / Math.max(1, a.get(k) ?? v));
      rows.push({ state: usps, maxChange: max });
    }
    rows.sort((x, y) => y.maxChange - x.maxChange);
    console.log('Largest single-district land-area change, TIGER 2025 (119th) to TIGER 2026 (120th):');
    console.log(rows.map((r) => `${r.state} ${(r.maxChange * 100).toFixed(1)}%`).join('  '));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
