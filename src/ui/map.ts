import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import statesTopo from 'us-atlas/states-10m.json';
import type { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon, Position } from 'geojson';
import { USPS_BY_NAME } from '../data/states';
import type { Party, Race } from '../data/schema';

export interface StateColor {
  fill: string;
  label: string;
  title: string;
}

let map: maplibregl.Map | null = null;
let ready = false;
let pending: (() => void)[] = [];
const markers = new Map<string, { el: HTMLElement; marker: maplibregl.Marker }>();
let onPick: (usps: string) => void = () => {};
let lastColors = new Map<string, StateColor>();

export const mapEl = document.createElement('div');
mapEl.className = 'mapview';
mapEl.setAttribute('role', 'application');
mapEl.setAttribute('aria-label', 'Interactive U.S. map. A list view with the same information is available.');

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function ringCentroid(ring: Position[]): { x: number; y: number; area: number } {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j]!;
    const [x1, y1] = ring[i]!;
    const f = x0! * y1! - x1! * y0!;
    a += f;
    cx += (x0! + x1!) * f;
    cy += (y0! + y1!) * f;
  }
  a *= 0.5;
  if (a === 0) return { x: ring[0]![0]!, y: ring[0]![1]!, area: 0 };
  return { x: cx / (6 * a), y: cy / (6 * a), area: Math.abs(a) };
}

function labelPoint(g: Geometry): [number, number] {
  const polys: Position[][][] = g.type === 'Polygon' ? [(g as Polygon).coordinates] : g.type === 'MultiPolygon' ? (g as MultiPolygon).coordinates : [];
  let best = { x: 0, y: 0, area: -1 };
  for (const p of polys) {
    const c = ringCentroid(p[0]!);
    if (c.area > best.area) best = c;
  }
  return [best.x, best.y];
}

function geo(): FeatureCollection {
  const topo = statesTopo as unknown as Topology;
  const fc = feature(topo, topo.objects['states'] as GeometryCollection) as FeatureCollection;
  const features: Feature[] = [];
  for (const f of fc.features) {
    const name = (f.properties as { name?: string } | null)?.name ?? '';
    const usps = USPS_BY_NAME[name];
    if (!usps) continue; // territories and DC are not part of this product
    features.push({ ...f, id: undefined, properties: { name, usps } });
  }
  return { type: 'FeatureCollection', features };
}

export function initMap(handlers: { onPick: (usps: string) => void }): void {
  if (map) return;
  onPick = handlers.onPick;
  const data = geo();
  map = new maplibregl.Map({
    container: mapEl,
    style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': css('--map-bg') } }] },
    center: [-96, 38.5],
    zoom: 3,
    minZoom: 1.8,
    maxZoom: 8,
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: false,
    fadeDuration: document.documentElement.dataset['tier'] === 'lite' ? 0 : 150,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Boundaries: U.S. Census Bureau via us-atlas' }), 'bottom-right');
  map.on('load', () => {
    const m = map!;
    m.addSource('states', { type: 'geojson', data, promoteId: 'usps' });
    m.addLayer({
      id: 'states-fill',
      type: 'fill',
      source: 'states',
      paint: {
        'fill-color': ['coalesce', ['feature-state', 'fill'], css('--no-race')],
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.82, 1],
      },
    });
    m.addLayer({
      id: 'states-line',
      type: 'line',
      source: 'states',
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], css('--ink'), css('--map-line')],
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 0.8],
      },
    });
    let hovered: string | null = null;
    m.on('mousemove', 'states-fill', (e) => {
      const id = e.features?.[0]?.properties?.['usps'] as string | undefined;
      if (!id) return;
      m.getCanvas().style.cursor = 'pointer';
      if (hovered && hovered !== id) m.setFeatureState({ source: 'states', id: hovered }, { hover: false });
      hovered = id;
      m.setFeatureState({ source: 'states', id }, { hover: true });
    });
    m.on('mouseleave', 'states-fill', () => {
      m.getCanvas().style.cursor = '';
      if (hovered) m.setFeatureState({ source: 'states', id: hovered }, { hover: false });
      hovered = null;
    });
    m.on('click', 'states-fill', (e) => {
      const id = e.features?.[0]?.properties?.['usps'] as string | undefined;
      if (id) onPick(id);
    });
    for (const f of data.features) {
      const usps = (f.properties as { usps: string }).usps;
      const el = document.createElement('div');
      el.className = 'state-label';
      el.setAttribute('aria-hidden', 'true');
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(labelPoint(f.geometry)).addTo(m);
      markers.set(usps, { el, marker });
    }
    ready = true;
    for (const fn of pending) fn();
    pending = [];
  });
}

function whenReady(fn: () => void): void {
  if (ready) fn();
  else pending.push(fn);
}

export function resizeMap(): void {
  map?.resize();
}

export function paintMap(colors: Map<string, StateColor>, selectedState: string | null): void {
  lastColors = colors;
  whenReady(() => {
    const m = map!;
    for (const [usps, { el }] of markers) {
      const c = colors.get(usps);
      m.setFeatureState({ source: 'states', id: usps }, { fill: c?.fill ?? css('--no-race'), selected: usps === selectedState });
      el.textContent = c?.label ?? '';
      el.title = c?.title ?? '';
      el.style.display = c?.label ? '' : 'none';
    }
  });
}

export function applyMapTheme(): void {
  whenReady(() => {
    const m = map!;
    m.setPaintProperty('bg', 'background-color', css('--map-bg'));
    m.setPaintProperty('states-line', 'line-color', ['case', ['boolean', ['feature-state', 'selected'], false], css('--ink'), css('--map-line')]);
    m.setPaintProperty('states-fill', 'fill-color', ['coalesce', ['feature-state', 'fill'], css('--no-race')]);
    paintMap(lastColors, null);
  });
}

const VIEWS: Record<string, { center: [number, number]; zoom: number }> = {
  lower48: { center: [-96, 38.5], zoom: 3 },
  alaska: { center: [-152, 64], zoom: 3.2 },
  hawaii: { center: [-157, 20.5], zoom: 5.5 },
};

export function flyToView(name: keyof typeof VIEWS): void {
  whenReady(() => {
    const v = VIEWS[name]!;
    const lite = document.documentElement.dataset['tier'] === 'lite';
    if (lite) map!.jumpTo(v);
    else map!.flyTo({ ...v, duration: 700, essential: false });
  });
}

export const partyFill = (p: Party | null, css2: (n: string) => string = css): string =>
  p === 'D' ? css2('--d') : p === 'R' ? css2('--r') : p === 'O' ? css2('--o') : css2('--uncalled');

export function colorVar(name: string): string {
  return css(name);
}

export function raceHasState(races: Race[], usps: string): Race | undefined {
  return races.find((r) => r.state === usps);
}
