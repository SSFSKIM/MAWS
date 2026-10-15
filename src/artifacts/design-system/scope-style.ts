// The scopes' stylesheets (D8): one `<style>` per (system, medium, overrides) in the document's head, shared by every
// scope that shows that combination and removed when the last one goes. A live system rewrites its style on every
// change, so every consumer restyles in the same frame and nothing is written to a consumer's artifact. Portable: it
// needs only a DOM document.
import type { Medium } from './css';
import { stableHash } from './hash';
import { safeOverrides, type DesignSystemView, type TokenOverrides } from './view';

/** A view on loan: the view, or its arrival, and the return of the loan. */
export interface ViewLease {
  view: DesignSystemView | Promise<DesignSystemView>;
  release(): void;
}

/** One view a scope's style observes, however many holds lent it, and the end of observing it. */
interface Watch {
  holds: number;
  view: DesignSystemView | null; // null until a view on its way arrives
  stop(): void;
}
interface Entry {
  element: HTMLStyleElement;
  /** By the view lent (or its arrival): two holds of one view observe it once. */
  watches: Map<DesignSystemView | Promise<DesignSystemView>, Watch>;
}
const entries = new Map<string, Entry>();

/** The scope id of a (system, medium, overrides) combination: the same for every consumer of it, in any render. */
export function scopeIdOf(system: string, medium: Medium, overrides: TokenOverrides | undefined): string {
  return `ds-${stableHash(JSON.stringify([system, medium, safeOverrides(overrides)]))}`;
}

/** The selector a scope's properties are set on. */
export const scopeSelector = (scopeId: string): string => `[data-ds-scope="${scopeId}"]`;

/**
 * Holds the style of `scopeId` and returns the release. Each hold borrows a view (`lease()`), and the style observes
 * every distinct view its holds lent: whichever changes rewrites it at once, so two replicas of one system shown at
 * once (a page in the panel and in a main tab) each restyle the shared scope in their own update, whatever the other's
 * connection. A view already at hand is written at once (the page's own, so its previews style their first frame); one
 * on its way, when it arrives. Releasing a hold returns its loan; the last hold of a view stops observing it and the
 * style is rewritten from a view still held; the last hold of all removes the element. A view that fails to arrive
 * leaves the style to the others, or empty.
 */
export function holdScopeStyle(scopeId: string, medium: Medium, overrides: TokenOverrides | undefined, lease: () => ViewLease): () => void {
  let entry = entries.get(scopeId);
  if (!entry) {
    const element = document.createElement('style');
    element.dataset.dsScopeStyle = scopeId;
    document.head.appendChild(element);
    entry = { element, watches: new Map() };
    entries.set(scopeId, entry);
  }
  const current = entry;
  const write = (view: DesignSystemView) => {
    current.element.textContent = view.css(scopeSelector(scopeId), medium, overrides);
  };
  const loan = lease();
  let watch = current.watches.get(loan.view);
  if (!watch) {
    let ended = false;
    let unsubscribe: (() => void) | null = null;
    const created: Watch = {
      holds: 0,
      view: null,
      stop: () => {
        ended = true;
        unsubscribe?.();
      },
    };
    const show = (view: DesignSystemView) => {
      if (ended) return;
      created.view = view;
      write(view);
      unsubscribe = view.subscribe(() => write(view));
    };
    current.watches.set(loan.view, created);
    if (loan.view instanceof Promise) loan.view.then(show, () => {});
    else show(loan.view);
    watch = created;
  }
  const held = watch;
  held.holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.holds -= 1;
    if (held.holds === 0) {
      held.stop();
      current.watches.delete(loan.view);
      const remaining = [...current.watches.values()].find((other) => other.view !== null);
      if (remaining) write(remaining.view!);
    }
    loan.release();
    if (current.watches.size) return;
    current.element.remove();
    if (entries.get(scopeId) === current) entries.delete(scopeId);
  };
}
