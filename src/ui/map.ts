import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import statesTopo from 'us-atlas/states-10m.json';
import type { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon, Position } from 'geojson';
import { USPS_BY_NAME } from '../data/states';
import type { Party } from '../data/schema';

export interface StateColor {
  fill: string;
  label: string;
  title: string;
}

/** "states" colors the 50 states (Senate, Governor). "districts" colors the 435 House districts. */
export type MapMode = 'states' | 'districts';

let map: maplibregl.Map | null = null;
let ready = false;
let pending: (() => void)[] = [];
const stateMarkers = new Map<string, { el: HTMLElement; marker: maplibregl.Marker }>();
const districtPool: { el: HTMLElement; marker: maplibregl.Marker }[] = [];
const districtPoints = new Map<string, [number, number]>();
let districtsLoaded: Promise<void> | null = null;
let onPick: (key: string) => void = () => {};
let mode: MapMode = 'states';
let lastColors = new Map<string, StateColor>();
let lastSelected: string | null = null;
let paintedDistricts = new Set<string>();
let paintedStates = new Set<string>();

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

function statesGeo(): FeatureCollection {
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

const isLite = () => document.documentElement.dataset['tier'] === 'lite';

export function initMap(handlers: { onPick: (key: string) => void }): void {
  if (map) return;
  onPick = handlers.onPick;
  maplibregl.setWorkerUrl(new URL('vendor/maplibre/maplibre-gl-worker.mjs', document.baseURI).href);
  const data = statesGeo();
  map = new maplibregl.Map({
    container: mapEl,
    style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': css('--map-bg') } }] },
    center: [-96, 38.5],
    zoom: 3,
    minZoom: 1.8,
    maxZoom: 10,
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: false,
    fadeDuration: isLite() ? 0 : 150,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Boundaries: U.S. Census Bureau (states via us-atlas; House districts: TIGER 2026, 120th Congress)' }), 'bottom-right');
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
      stateMarkers.set(usps, { el, marker });
    }
    m.on('moveend', updateDistrictLabels);
    ready = true;
    for (const fn of pending) fn();
    pending = [];
  });
}

function whenReady(fn: () => void): void {
  if (ready) fn();
  else pending.push(fn);
}

/** Fetch and add the House district layer the first time it is needed. */
function ensureDistricts(): Promise<void> {
  if (districtsLoaded) return districtsLoaded;
  districtsLoaded = new Promise<void>((resolve, reject) => {
    whenReady(() => {
      fetch(`${import.meta.env.BASE_URL}data/districts.json`)
        .then((r) => r.json())
        .then((topo: Topology) => {
          const m = map!;
          const fc = feature(topo, topo.objects['districts'] as GeometryCollection) as FeatureCollection;
          for (const f of fc.features) districtPoints.set((f.properties as { id: string }).id, labelPoint(f.geometry));
          m.addSource('districts', { type: 'geojson', data: fc, promoteId: 'id' });
          m.addLayer(
            {
              id: 'districts-fill',
              type: 'fill',
              source: 'districts',
              layout: { visibility: mode === 'districts' ? 'visible' : 'none' },
              paint: {
                'fill-color': ['coalesce', ['feature-state', 'fill'], css('--no-race')],
                'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 1],
              },
            },
            'states-line',
          );
          m.addLayer(
            {
              id: 'districts-line',
              type: 'line',
              source: 'districts',
              layout: { visibility: mode === 'districts' ? 'visible' : 'none' },
              paint: {
                'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], css('--ink'), css('--map-line')],
                'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 0.35],
              },
            },
            'states-line',
          );
          let hov: string | null = null;
          m.on('mousemove', 'districts-fill', (e) => {
            const id = e.features?.[0]?.properties?.['id'] as string | undefined;
            if (!id) return;
            m.getCanvas().style.cursor = 'pointer';
            if (hov && hov !== id) m.setFeatureState({ source: 'districts', id: hov }, { hover: false });
            hov = id;
            m.setFeatureState({ source: 'districts', id }, { hover: true });
          });
          m.on('mouseleave', 'districts-fill', () => {
            m.getCanvas().style.cursor = '';
            if (hov) m.setFeatureState({ source: 'districts', id: hov }, { hover: false });
            hov = null;
          });
          m.on('click', 'districts-fill', (e) => {
            const id = e.features?.[0]?.properties?.['id'] as string | undefined;
            if (id) onPick(id);
          });
          resolve();
        })
        .catch(reject);
    });
  });
  return districtsLoaded;
}

export function resizeMap(): void {
  map?.resize();
}

function setMode(next: MapMode): void {
  mode = next;
  const m = map!;
  m.setLayoutProperty('states-fill', 'visibility', next === 'states' ? 'visible' : 'none');
  if (m.getLayer('districts-fill')) {
    m.setLayoutProperty('districts-fill', 'visibility', next === 'districts' ? 'visible' : 'none');
    m.setLayoutProperty('districts-line', 'visibility', next === 'districts' ? 'visible' : 'none');
  }
  for (const { el } of stateMarkers.values()) el.style.display = next === 'states' ? '' : 'none';
  m.setPaintProperty('states-line', 'line-width', next === 'districts' ? 1.6 : ['case', ['boolean', ['feature-state', 'selected'], false], 3, 0.8]);
}

/** HTML labels for the districts currently on screen (capped), so the map is not color-only. */
function updateDistrictLabels(): void {
  if (!map || mode !== 'districts' || !map.getLayer('districts-fill')) {
    for (const p of districtPool) p.el.style.display = 'none';
    return;
  }
  const zoomOk = map.getZoom() >= 4.8;
  const visible = zoomOk ? [...new Set(map.queryRenderedFeatures({ layers: ['districts-fill'] }).map((f) => String(f.properties?.['id'])))] : [];
  const ids = visible.slice(0, 160);
  ids.forEach((id, i) => {
    let slot = districtPool[i];
    if (!slot) {
      const el = document.createElement('div');
      el.className = 'state-label district-label';
      el.setAttribute('aria-hidden', 'true');
      slot = { el, marker: new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([0, 0]).addTo(map!) };
      districtPool.push(slot);
    }
    const pt = districtPoints.get(id);
    const c = lastColors.get(id);
    if (!pt || !c || !c.label) { slot.el.style.display = 'none'; return; }
    slot.marker.setLngLat(pt);
    slot.el.textContent = c.label;
    slot.el.title = c.title;
    slot.el.style.display = '';
  });
  for (let i = ids.length; i < districtPool.length; i++) districtPool[i]!.el.style.display = 'none';
}

/**
 * Paint the map. Keys are state codes in "states" mode and race ids (house-TX-22) in "districts" mode.
 * Anything not in `colors` shows as "no race".
 */
export function paintMap(next: MapMode, colors: Map<string, StateColor>, selected: string | null): void {
  lastColors = colors;
  lastSelected = selected;
  const run = () => {
    const m = map!;
    setMode(next);
    if (next === 'states') {
      for (const [usps, { el }] of stateMarkers) {
        const c = colors.get(usps);
        m.setFeatureState({ source: 'states', id: usps }, { fill: c?.fill ?? css('--no-race'), selected: usps === selected });
        el.textContent = c?.label ?? '';
        el.title = c?.title ?? '';
        el.style.display = c?.label ? '' : 'none';
      }
      paintedStates = new Set(stateMarkers.keys());
    } else {
      for (const id of paintedDistricts) if (!colors.has(id)) m.setFeatureState({ source: 'districts', id }, { fill: css('--no-race'), selected: false });
      for (const [id, c] of colors) m.setFeatureState({ source: 'districts', id }, { fill: c.fill, selected: id === selected });
      paintedDistricts = new Set(colors.keys());
      updateDistrictLabels();
    }
  };
  if (next === 'districts') void ensureDistricts().then(() => whenReady(run)).catch(() => {});
  else whenReady(run);
  void paintedStates;
}

export function applyMapTheme(): void {
  whenReady(() => {
    const m = map!;
    m.setPaintProperty('bg', 'background-color', css('--map-bg'));
    const lineColor = ['case', ['boolean', ['feature-state', 'selected'], false], css('--ink'), css('--map-line')] as maplibregl.ExpressionSpecification;
    m.setPaintProperty('states-line', 'line-color', lineColor);
    m.setPaintProperty('states-fill', 'fill-color', ['coalesce', ['feature-state', 'fill'], css('--no-race')]);
    if (m.getLayer('districts-fill')) {
      m.setPaintProperty('districts-line', 'line-color', lineColor);
      m.setPaintProperty('districts-fill', 'fill-color', ['coalesce', ['feature-state', 'fill'], css('--no-race')]);
    }
    paintMap(mode, lastColors, lastSelected);
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
    if (isLite()) map!.jumpTo(v);
    else map!.flyTo({ ...v, duration: 700, essential: false });
  });
}

/** Zoom to a state's bounding box (used when a district or state is opened from a list). */
export function flyToPoint(lngLat: [number, number], zoom: number): void {
  whenReady(() => {
    if (isLite()) map!.jumpTo({ center: lngLat, zoom });
    else map!.flyTo({ center: lngLat, zoom, duration: 600, essential: false });
  });
}

export function districtPoint(id: string): [number, number] | undefined {
  return districtPoints.get(id);
}

export const partyFill = (p: Party | null, css2: (n: string) => string = css): string =>
  p === 'D' ? css2('--d') : p === 'R' ? css2('--r') : p === 'O' ? css2('--o') : css2('--uncalled');

export function colorVar(name: string): string {
  return css(name);
}
