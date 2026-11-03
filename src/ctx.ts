import type { CallsFile, Dataset, Party, Race } from './data/schema';
import { evaluatePolls, DEFAULT_POLL_SETTINGS, type PollOutcome } from './domain/polling';
import { partyOfPick, type Pick } from './domain/makeup';
import { resolveScope, type Scope } from './domain/scope';
import { canWrite, phaseAt, type Phase } from './domain/lifecycle';
import { now } from './domain/clock';
import { createIdbStore, loadWorking, saveWorking, type MapStore, type Working } from './storage';

export type Mode = 'forecast' | 'endorse';

const emptyWorking: Working = {
  forecast: {},
  endorse: {},
  deferred: { forecast: [], endorse: [] },
  pollSettings: DEFAULT_POLL_SETTINGS,
  scope: { include: [], exclude: [] },
  tourSeen: false,
};

const idb = createIdbStore();

export const ctx = {
  data: null as unknown as Dataset,
  calls: { updatedAt: '', calls: [] } as CallsFile,
  working: structuredClone(emptyWorking) as Working,
  store: idb.store as MapStore,
  storePersistent: idb.persistent,
  localOk: true,
};

export function initWorking(): void {
  ctx.working = loadWorking(structuredClone(emptyWorking));
}

type Listener = () => void;
const listeners = new Set<Listener>();
export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit(): void {
  for (const l of [...listeners]) l();
}

export function persist(): void {
  ctx.localOk = saveWorking(ctx.working);
}

export function phase(): Phase {
  return phaseAt(now());
}
export function writable(): boolean {
  return canWrite(now());
}

export function esc(s: string | number | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function raceById(id: string): Race | undefined {
  return ctx.data.races.find((r) => r.id === id);
}

const outcomeCache = new Map<string, PollOutcome>();
let outcomeKey = '';
export function outcomeFor(race: Race): PollOutcome {
  const minute = Math.floor(now() / 60_000);
  const key = JSON.stringify(ctx.working.pollSettings) + '|' + minute + '|' + ctx.data.meta.generatedAt;
  if (key !== outcomeKey) {
    outcomeCache.clear();
    outcomeKey = key;
  }
  let o = outcomeCache.get(race.id);
  if (!o) {
    const polls = ctx.data.polls.filter((p) => p.raceId === race.id);
    o = evaluatePolls(polls, race.candidates, ctx.working.pollSettings, now());
    outcomeCache.set(race.id, o);
  }
  return o;
}

export function scopeRaces(scope: Scope = ctx.working.scope): Race[] {
  const out = resolveScope(scope, ctx.data, ctx.working.pollSettings, now());
  return out.sort((a, b) => (a.chamber === b.chamber ? a.stateName.localeCompare(b.stateName) : a.chamber === 'senate' ? -1 : 1));
}

export function picksFor(mode: Mode): Map<string, Pick> {
  return new Map(Object.entries(ctx.working[mode]));
}

export function setPick(mode: Mode, race: Race, candidateId: string | null, partyOverride?: Party, origin: Pick['origin'] = 'user'): boolean {
  if (!writable()) return false;
  const party = partyOverride ?? partyOfPick(race, candidateId);
  ctx.working[mode][race.id] = { raceId: race.id, candidateId, party, origin, madeAt: new Date(now()).toISOString() };
  const d = ctx.working.deferred[mode];
  ctx.working.deferred[mode] = d.filter((id) => id !== race.id);
  persist();
  return true;
}

export function clearPick(mode: Mode, raceId: string): boolean {
  if (!writable()) return false;
  delete ctx.working[mode][raceId];
  persist();
  return true;
}

export function toast(msg: string): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  window.setTimeout(() => el.classList.remove('show'), 3800);
}

export const PARTY_NAME: Record<Party, string> = { D: 'Democratic', R: 'Republican', O: 'Other' };
export const LOCAL_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'your local time';
  }
})();
