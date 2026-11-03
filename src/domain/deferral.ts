/**
 * One-by-one queue with "Come back later".
 * A deferred item returns after RESURFACE_AFTER other items have been shown.
 * If fewer than that many items remain, it returns as soon as the rest are done.
 */
export const RESURFACE_AFTER = 20;

export interface QueueState {
  /** Items not yet decided, in presentation order. */
  pending: string[];
  /** Deferred items with how many items have been shown since they were deferred. */
  deferred: { id: string; shownSince: number }[];
  /** Items decided (called/endorsed). */
  done: string[];
}

export function createQueue(ids: readonly string[], alreadyDone: readonly string[] = []): QueueState {
  const doneSet = new Set(alreadyDone);
  return {
    pending: ids.filter((id) => !doneSet.has(id)),
    deferred: [],
    done: ids.filter((id) => doneSet.has(id)),
  };
}

/** The item to show now, or null if the queue is empty. */
export function current(q: QueueState): string | null {
  const ripe = q.deferred.find((d) => d.shownSince >= RESURFACE_AFTER);
  if (ripe) return ripe.id;
  if (q.pending.length > 0) return q.pending[0] ?? null;
  // Nothing fresh left: circle back to the longest-waiting deferred item.
  const oldest = [...q.deferred].sort((a, b) => b.shownSince - a.shownSince)[0];
  return oldest ? oldest.id : null;
}

function bump(q: QueueState, shownId: string): QueueState {
  return {
    ...q,
    deferred: q.deferred.map((d) => (d.id === shownId ? d : { ...d, shownSince: d.shownSince + 1 })),
  };
}

function remove(q: QueueState, id: string): QueueState {
  return {
    ...q,
    pending: q.pending.filter((x) => x !== id),
    deferred: q.deferred.filter((d) => d.id !== id),
  };
}

/** The user made a decision on `id`. */
export function decide(q: QueueState, id: string): QueueState {
  const next = bump(remove(q, id), id);
  return { ...next, done: q.done.includes(id) ? next.done : [...next.done, id] };
}

/** The user chose "Come back later" on `id`. */
export function defer(q: QueueState, id: string): QueueState {
  const stripped = remove(q, id);
  const bumped = bump(stripped, id);
  // A fresh deferral starts its count at 0. Re-deferring something that already
  // came back also restarts at 0, so it is never nagged twice in a row.
  return { ...bumped, deferred: [...bumped.deferred, { id, shownSince: 0 }] };
}

export function deferredIds(q: QueueState): string[] {
  return q.deferred.map((d) => d.id);
}

/** Revisit a deferred item right now, on purpose. */
export function revisit(q: QueueState, id: string): QueueState {
  if (!q.deferred.some((d) => d.id === id)) return q;
  return { ...q, deferred: q.deferred.map((d) => (d.id === id ? { ...d, shownSince: RESURFACE_AFTER } : d)) };
}

/** Undo a decision so the item becomes pending again at the front. */
export function reopen(q: QueueState, id: string): QueueState {
  return { ...q, pending: [id, ...q.pending.filter((x) => x !== id)], done: q.done.filter((x) => x !== id) };
}
