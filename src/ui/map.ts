/**
 * Map facade. It owns the map element and forwards calls to the real implementation, which pulls in
 * MapLibre (about 250 KB compressed) only when a page actually shows a map. Calls made before the
 * implementation has loaded run in order once it arrives.
 */
export interface StateColor {
  fill: string;
  label: string;
  title: string;
}

/** "states" colors the 50 states (Senate, Governor). "districts" colors the 435 House districts. */
export type MapMode = 'states' | 'districts';

export const mapEl = document.createElement('div');
mapEl.className = 'mapview';
mapEl.setAttribute('role', 'application');
mapEl.setAttribute('aria-label', 'Interactive U.S. map. A list view with the same information is available.');

type Impl = typeof import('./map-impl');
let impl: Promise<Impl> | null = null;
let pickHandler: (key: string) => void = () => {};
let inited = false;

function load(): Promise<Impl> {
  if (!impl) {
    impl = import('./map-impl').then((m) => {
      if (!inited) {
        inited = true;
        m.initMap({ onPick: (k) => pickHandler(k) });
      }
      return m;
    });
  }
  return impl;
}

export function setMapPickHandler(fn: (key: string) => void): void {
  pickHandler = fn;
}

export function resizeMap(): void {
  void load().then((m) => m.resizeMap());
}

export function paintMap(mode: MapMode, colors: Map<string, StateColor>, selected: string | null): void {
  void load().then((m) => m.paintMap(mode, colors, selected));
}

export function applyMapTheme(): void {
  if (impl) void impl.then((m) => m.applyMapTheme());
}

export function flyToView(name: 'lower48' | 'alaska' | 'hawaii'): void {
  void load().then((m) => m.flyToView(name));
}

export function colorVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}
