// The scopes' stylesheets (D8): one `<style>` per (system, medium, overrides) in the document's head, shared by every
// scope that shows that combination and removed when the last one goes. A live system rewrites its style on every
// change, so every consumer restyles in the same frame and nothing is written to a consumer's artifact. Portable: it
// needs only a DOM document.
import type { Medium } from './css';
import { safeOverrides, type DesignSystemView, type TokenOverrides } from './view';

/** A view on loan: the view, or its arrival, and the return of the loan. */
export interface ViewLease {
  view: DesignSystemView | Promise<DesignSystemView>;
  release(): void;
}

interface Entry {
  refs: number;
  element: HTMLStyleElement;
  end(): void;
}
const entries = new Map<string, Entry>();

// FNV-1a over the key, twice with different offsets: a 64-bit id, so two combinations never share a scope in practice.
function fnv(text: string, offset: number): string {
  let hash = offset;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** The scope id of a (system, medium, overrides) combination: the same for every consumer of it, in any render. */
export function scopeIdOf(system: string, medium: Medium, overrides: TokenOverrides | undefined): string {
  const key = JSON.stringify([system, medium, safeOverrides(overrides)]);
  return `ds-${fnv(key, 0x811c9dc5)}${fnv(key, 0x050c5d1f)}`;
}

/** The selector a scope's properties are set on. */
export const scopeSelector = (scopeId: string): string => `[data-ds-scope="${scopeId}"]`;

/**
 * Holds the style of `scopeId`, creating it on first hold from the view `lease()` lends, and returns the release. The
 * style is written when the view is there and rewritten on each of its changes; the last release removes the element,
 * stops listening and returns the loan. A view that fails to arrive leaves the style empty.
 */
export function holdScopeStyle(scopeId: string, medium: Medium, overrides: TokenOverrides | undefined, lease: () => ViewLease): () => void {
  let entry = entries.get(scopeId);
  if (!entry) {
    const element = document.createElement('style');
    element.dataset.dsScopeStyle = scopeId;
    document.head.appendChild(element);
    const loan = lease();
    let ended = false;
    let unsubscribe: (() => void) | null = null;
    const show = (view: DesignSystemView) => {
      if (ended) return;
      const write = () => {
        element.textContent = view.css(scopeSelector(scopeId), medium, overrides);
      };
      write();
      unsubscribe = view.subscribe(write);
    };
    // A view at hand is written at once (the page's own, so its previews style their first frame); one arriving, when
    // it arrives.
    if (loan.view instanceof Promise) loan.view.then(show, () => {});
    else show(loan.view);
    entry = {
      refs: 0,
      element,
      end: () => {
        ended = true;
        unsubscribe?.();
        element.remove();
        loan.release();
      },
    };
    entries.set(scopeId, entry);
  }
  entry.refs += 1;
  const held = entry;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.refs -= 1;
    if (held.refs > 0) return;
    held.end();
    if (entries.get(scopeId) === held) entries.delete(scopeId);
  };
}
