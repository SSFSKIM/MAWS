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

/** One hold of a scope's style: its own loan of a view. */
interface Hold {
  loan: ViewLease;
}
interface Entry {
  element: HTMLStyleElement;
  holds: Hold[];
  /** The hold whose view the style follows, and the end of following it. */
  following: { hold: Hold; stop(): void } | null;
}
const entries = new Map<string, Entry>();

/** The scope id of a (system, medium, overrides) combination: the same for every consumer of it, in any render. */
export function scopeIdOf(system: string, medium: Medium, overrides: TokenOverrides | undefined): string {
  return `ds-${stableHash(JSON.stringify([system, medium, safeOverrides(overrides)]))}`;
}

/** The selector a scope's properties are set on. */
export const scopeSelector = (scopeId: string): string => `[data-ds-scope="${scopeId}"]`;

/**
 * Holds the style of `scopeId` and returns the release. Each hold borrows its own view (`lease()`); the style follows
 * one holder's view at a time, written when that view is there and rewritten on each of its changes. When the holder
 * it follows lets go (its tab closed, its replica gone), the style follows the next holder's view at once, so a scope's
 * life never depends on whichever holder came first. The last release removes the element. A view that fails to
 * arrive leaves the style empty.
 */
export function holdScopeStyle(scopeId: string, medium: Medium, overrides: TokenOverrides | undefined, lease: () => ViewLease): () => void {
  let entry = entries.get(scopeId);
  if (!entry) {
    const element = document.createElement('style');
    element.dataset.dsScopeStyle = scopeId;
    document.head.appendChild(element);
    entry = { element, holds: [], following: null };
    entries.set(scopeId, entry);
  }
  const current = entry;
  const follow = () => {
    current.following?.stop();
    current.following = null;
    const hold = current.holds[0];
    if (!hold) return;
    let ended = false;
    let unsubscribe: (() => void) | null = null;
    const show = (view: DesignSystemView) => {
      if (ended) return;
      const write = () => {
        current.element.textContent = view.css(scopeSelector(scopeId), medium, overrides);
      };
      write();
      unsubscribe = view.subscribe(write);
    };
    current.following = {
      hold,
      stop: () => {
        ended = true;
        unsubscribe?.();
      },
    };
    // A view at hand is written at once (the page's own, so its previews style their first frame); one arriving, when
    // it arrives.
    if (hold.loan.view instanceof Promise) hold.loan.view.then(show, () => {});
    else show(hold.loan.view);
  };
  const hold: Hold = { loan: lease() };
  current.holds.push(hold);
  if (!current.following) follow();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    current.holds = current.holds.filter((other) => other !== hold);
    if (current.following?.hold === hold) follow();
    hold.loan.release();
    if (current.holds.length) return;
    current.following?.stop();
    current.element.remove();
    if (entries.get(scopeId) === current) entries.delete(scopeId);
  };
}
