export type ActionFn = (el: HTMLElement, ev: Event) => void;
const registry = new Map<string, ActionFn>();

export function registerActions(actions: Record<string, ActionFn>): void {
  for (const [k, fn] of Object.entries(actions)) registry.set(k, fn);
}

/** One delegated listener set for the whole app. Elements opt in with data-action. */
export function installActionDelegation(root: HTMLElement): void {
  const dispatch = (ev: Event) => {
    const target = ev.target as HTMLElement | null;
    const el = target?.closest<HTMLElement>('[data-action]');
    if (!el || !root.contains(el)) return;
    const wanted = el.dataset['on'] ?? 'click';
    if (wanted !== ev.type) return;
    const fn = registry.get(el.dataset['action']!);
    if (fn) fn(el, ev);
  };
  for (const t of ['click', 'change', 'input', 'submit']) root.addEventListener(t, dispatch);
}
