import type { Party } from './data/schema';
import type { Pick } from './domain/makeup';
import type { PollSettings } from './domain/polling';
import type { Scope } from './domain/scope';
import { canWrite } from './domain/lifecycle';

/** Deliberate product limits, per election. */
export const LIMITS = { prediction: 1500, forecast: 70 } as const;

export interface SavedSeat {
  raceId: string;
  label: string;
  party: Party | null;
  pickName: string | null;
  origin: Pick['origin'] | null;
  /** Polling summary as it stood when saved, so the map is reproducible. */
  polling: { status: string; marginText: string; included: number; method: string } | null;
}

export interface SavedMap {
  id: string;
  /** prediction = working draft/version; forecast = named, frozen snapshot. */
  kind: 'prediction' | 'forecast';
  name: string;
  notes: string;
  createdAt: string;
  dataAsOf: string;
  scopeText: string;
  scope: Scope;
  pollSettings: PollSettings;
  methodText: string;
  picks: Pick[];
  seats: SavedSeat[];
  aggregate: {
    senate: { holdover: Record<Party, number>; called: Record<Party, number>; total: Record<Party, number>; uncalled: number };
    house: { holdover: Record<Party, number>; called: Record<Party, number>; total: Record<Party, number>; uncalled: number };
    governor: { holdover: Record<Party, number>; called: Record<Party, number>; total: Record<Party, number>; uncalled: number };
  };
}

export interface MapStore {
  put(map: SavedMap): Promise<void>;
  list(): Promise<SavedMap[]>;
  get(id: string): Promise<SavedMap | undefined>;
  remove(id: string): Promise<void>;
}

export function createMemoryStore(): MapStore {
  const m = new Map<string, SavedMap>();
  return {
    async put(x) { m.set(x.id, x); },
    async list() { return [...m.values()]; },
    async get(id) { return m.get(id); },
    async remove(id) { m.delete(id); },
  };
}

const DB = 'elecia';
const STORE = 'maps';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

export function createIdbStore(): { store: MapStore; persistent: boolean } {
  if (typeof indexedDB === 'undefined') return { store: createMemoryStore(), persistent: false };
  return {
    persistent: true,
    store: {
      async put(x) { await tx('readwrite', (s) => s.put(x)); },
      async list() { return (await tx('readonly', (s) => s.getAll())) as SavedMap[]; },
      async get(id) { return (await tx('readonly', (s) => s.get(id))) as SavedMap | undefined; },
      async remove(id) { await tx('readwrite', (s) => s.delete(id)); },
    },
  };
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/** Enforces the lifecycle gate and the per-election limits. */
export async function saveMap(store: MapStore, map: SavedMap, nowMs: number): Promise<SaveResult> {
  if (!canWrite(nowMs)) return { ok: false, error: 'Predictions are closed, so new maps cannot be saved. Your saved maps stay viewable.' };
  const existing = await store.list();
  const count = existing.filter((m) => m.kind === map.kind).length;
  const limit = LIMITS[map.kind];
  if (count >= limit) {
    return {
      ok: false,
      error:
        map.kind === 'forecast'
          ? `You have reached the limit of ${limit} forecast maps for this election. Delete one to make room.`
          : `You have reached the limit of ${limit} prediction maps for this election. Delete one to make room.`,
    };
  }
  await store.put(map);
  return { ok: true };
}

// ---- Small settings/working state in localStorage (guarded) ----
const KEY = 'elecia:v1';

export interface Working {
  forecast: Record<string, Pick>;
  endorse: Record<string, Pick>;
  deferred: { forecast: string[]; endorse: string[] };
  pollSettings: PollSettings;
  scope: Scope;
  tourSeen: boolean;
  /** How many items were shown since each deferred item was set aside, keyed `${mode}:${raceId}`. */
  counters?: Record<string, number>;
}

export function loadWorking(fallback: Working): Working {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Working>;
    return {
      forecast: p.forecast ?? {},
      endorse: p.endorse ?? {},
      deferred: p.deferred ?? { forecast: [], endorse: [] },
      pollSettings: p.pollSettings ?? fallback.pollSettings,
      scope: p.scope ?? fallback.scope,
      tourSeen: p.tourSeen ?? false,
      counters: p.counters ?? {},
    };
  } catch {
    return fallback;
  }
}

export function saveWorking(w: Working): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
    return true;
  } catch {
    return false;
  }
}
