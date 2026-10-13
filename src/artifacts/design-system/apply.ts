// The apply-and-restyle API (D8 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md; the ledger's X28): how a
// document, a deck or a page renders in a design system. A consumer names its system by reference, a live system
// (`{id}`), a retained state of one (`{id, versionSeq}`, X29's pin) or the bundled floor (`{builtin: 'maws'}`), and
// wraps the part that draws in the system (B's page element, C's slide, never the editor's chrome: Decision Log 13) in
// `<DesignSystemScope>`. The scope's `<style>` follows a live system, so every consumer restyles in the same frame with
// no write to its own artifact; a version ref is read once and never followed. Overrides per the brief come last.
// Portable (§4.10): the store is reached only through `ArtifactHost`, which the app provides once through
// `DesignSystemHostContext`.
//
//   <DesignSystemHostContext.Provider value={artifactHost}>            (once, near the root)
//     <DesignSystemScope system={governingSystem(artifact, defaults)} medium="document"
//                        overrides={dsOverrides} className="doc-page">
//       <div className="ds-doc">…</div>                                (the page reads var(--ds-*) and .ds-type-*)
//     </DesignSystemScope>
import { createContext, createElement, useContext, useEffect, useLayoutEffect, useState, type JSX, type ReactNode } from 'react';
import type { ArtifactHost } from '../host';
import { applyV2, newDoc } from '../yjs';
import { tokenProperties, type Medium } from './css';
import { holdScopeStyle, scopeIdOf, type ViewLease } from './scope-style';
import type { DesignSystemRef } from './governing';
import type { TokenSet } from './tokens';
import { builtinView, liveView, snapshotOfDoc, staticView, type DesignSystemView, type TokenOverrides } from './view';

export { officeTheme, officeThemeXml, type OfficeTheme } from './office';
export type { DesignSystemView, TokenOverrides } from './view';

export { governingSystem, type DesignSystemRef } from './governing';
type SystemRef = DesignSystemRef | { builtin: 'maws' };

/** The system is not there: no such artifact, a deleted one, no retained state at that seq, or not a design system. */
export class DesignSystemMissing extends Error {
  constructor(ref: SystemRef, cause?: unknown) {
    super(`no design system at ${'builtin' in ref ? ref.builtin : `${ref.id}${ref.versionSeq === undefined ? '' : `@${ref.versionSeq}`}`}`, { cause });
    this.name = 'DesignSystemMissing';
  }
}

const synced = (handle: Awaited<ReturnType<ArtifactHost['open']>>) =>
  handle.state().synced
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const stop = handle.subscribe((state) => {
          if (!state.synced) return;
          stop();
          resolve();
        });
      });

/**
 * Opens a system for reading. A live ref opens the system's replica through the host and follows it until `close`; a
 * version ref reads the pinned state once (`ArtifactHost.versionState`) and never subscribes; the floor reads the
 * bundled house tokens with no store at all. Rejects with `DesignSystemMissing` when the system is not there.
 */
export async function openDesignSystem(host: ArtifactHost, ref: DesignSystemRef | { builtin: 'maws' }): Promise<DesignSystemView> {
  if ('builtin' in ref) return builtinView();
  const toUrl = (asset: string) => host.assetUrl(ref.id, asset);
  if (ref.versionSeq !== undefined) {
    let bytes: Uint8Array;
    try {
      bytes = await host.versionState(ref.id, { seq: ref.versionSeq });
    } catch (error) {
      throw new DesignSystemMissing(ref, error);
    }
    const doc = newDoc();
    try {
      applyV2(doc, bytes);
      const snapshot = snapshotOfDoc(doc);
      if (!snapshot) throw new DesignSystemMissing(ref);
      return staticView(snapshot, toUrl);
    } finally {
      doc.destroy();
    }
  }
  let handle: Awaited<ReturnType<ArtifactHost['open']>>;
  try {
    handle = await host.open(ref.id);
  } catch (error) {
    throw new DesignSystemMissing(ref, error);
  }
  await synced(handle);
  if (!snapshotOfDoc(handle.doc)) {
    handle.close();
    throw new DesignSystemMissing(ref);
  }
  return liveView(handle.doc, toUrl, () => handle.close());
}

// --- Shared views ----------------------------------------------------------------------------------------------------

/** The host the hooks and scopes open systems through: the app provides it once. Without one, only the floor renders. */
export const DesignSystemHostContext = createContext<ArtifactHost | null>(null);

const refKey = (ref: SystemRef): string => ('builtin' in ref ? `builtin:${ref.builtin}` : ref.versionSeq === undefined ? `live:${ref.id}` : `version:${ref.id}@${ref.versionSeq}`);
function refOfKey(key: string): SystemRef {
  const [kind, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (kind === 'builtin') return { builtin: 'maws' };
  if (kind === 'live') return { id: rest };
  const at = rest.lastIndexOf('@');
  return { id: rest.slice(0, at), versionSeq: Number(rest.slice(at + 1)) };
}

// One open view per (host, system) however many hooks and scopes show it, closed with the last.
interface Shared {
  view: DesignSystemView | Promise<DesignSystemView>;
  refs: number;
}
const NO_HOST = {};
const sharedViews = new WeakMap<object, Map<string, Shared>>();

function lend(host: ArtifactHost | null, key: string): ViewLease {
  const ref = refOfKey(key);
  const byKey = sharedViews.get(host ?? NO_HOST) ?? sharedViews.set(host ?? NO_HOST, new Map()).get(host ?? NO_HOST)!;
  let shared = byKey.get(key);
  if (!shared) {
    const view = 'builtin' in ref ? builtinView() : host ? openDesignSystem(host, ref) : Promise.reject(new DesignSystemMissing(ref));
    if (view instanceof Promise) view.catch(() => byKey.get(key) === shared && byKey.delete(key)); // a failed open is tried again by the next lease
    shared = { view, refs: 0 };
    byKey.set(key, shared);
  }
  shared.refs += 1;
  const held = shared;
  let released = false;
  return {
    view: held.view,
    release: () => {
      if (released) return;
      released = true;
      held.refs -= 1;
      if (held.refs > 0) return;
      if (byKey.get(key) === held) byKey.delete(key);
      Promise.resolve(held.view).then((view) => view.close(), () => {});
    },
  };
}

type Status = 'loading' | 'ready' | 'missing';

/**
 * A system for reading in a render. The view returned is a snapshot: a new object on every change of a live system, so
 * a render that reads `view.tokens` re-runs (and the React Compiler's memos see the change). The hook owns the view;
 * its `close` does nothing.
 */
export function useDesignSystem(ref: DesignSystemRef | { builtin: 'maws' } | null): { view: DesignSystemView | null; status: Status } {
  const host = useContext(DesignSystemHostContext);
  const key = ref === null ? null : refKey(ref);
  const [shown, setShown] = useState<{ key: string; view: DesignSystemView | null; status: Status } | null>(null);
  useEffect(() => {
    if (key === null) return;
    const loan = lend(host, key);
    let active = true;
    let unsubscribe: (() => void) | null = null;
    Promise.resolve(loan.view).then(
      (view) => {
        if (!active) return;
        const show = () => setShown({ key, view: snapshotOf(view), status: 'ready' });
        show();
        unsubscribe = view.subscribe(show);
      },
      () => active && setShown({ key, view: null, status: 'missing' }),
    );
    return () => {
      active = false;
      unsubscribe?.();
      loan.release();
    };
  }, [host, key]);
  if (key === null) return { view: null, status: 'missing' };
  return shown?.key === key ? { view: shown.view, status: shown.status } : { view: null, status: 'loading' };
}

/** A view's current state as a fixed object that still renders and follows like the view; closing it does nothing. */
function snapshotOf(view: DesignSystemView): DesignSystemView {
  const { tokens, law, name } = view;
  return { tokens, law, name, css: (scope, medium, overrides) => view.css(scope, medium, overrides), subscribe: (listener) => view.subscribe(listener), close: () => {} };
}

/**
 * A `div` that renders its children in a system (D8): `data-ds-scope` names the combination of system, medium and
 * overrides, whose one `<style>` (the `--ds-*` properties, the `.ds-type-*` classes, the system's faces, then the
 * overrides) every scope of that combination shares; it follows a live system and is removed with the last scope. With
 * no system, a plain `div`. While the system loads, or when it is missing, the scope has no style: the consumer's
 * `var(--ds-*, …)` fallbacks show.
 */
export function DesignSystemScope(props: {
  system: DesignSystemRef | { builtin: 'maws' } | null;
  medium: Medium;
  overrides?: TokenOverrides;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const { system, medium, overrides, className, children } = props;
  const host = useContext(DesignSystemHostContext);
  const key = system === null ? null : refKey(system);
  const scopeId = key === null ? null : scopeIdOf(key, medium, overrides);
  useLayoutEffect(() => {
    if (key === null || scopeId === null) return;
    // The scope id stands for the system, the medium and the overrides' content: a new overrides object with the same
    // entries is the same scope, and keeps its style. Held before paint, so a system already open styles the first frame.
    return holdScopeStyle(scopeId, medium, overrides, () => lend(host, key));
  }, [host, scopeId]);
  return createElement('div', { 'data-ds-scope': scopeId ?? undefined, className }, children);
}

// --- Export helpers --------------------------------------------------------------------------------------------------

/**
 * CSS text with every `var(--ds-*)` the system defines replaced by its value at the medium's scale (the Claude-shaped
 * deck of §4.5, which carries no custom properties). A name the system does not define takes its fallback, resolved the
 * same way, else stays as written; any other `var()` stays, its fallback resolved.
 */
export function resolveDsVars(cssText: string, tokens: TokenSet, medium: Medium): string {
  const values = tokenProperties(tokens, medium);
  const resolve = (text: string): string => {
    let out = '';
    let i = 0;
    for (let at = text.indexOf('var(', i); at >= 0; at = text.indexOf('var(', i)) {
      let depth = 1;
      let end = at + 4;
      for (; end < text.length && depth > 0; end++) {
        if (text[end] === '(') depth++;
        else if (text[end] === ')') depth--;
      }
      if (depth > 0) break; // unclosed: left as written
      const inner = text.slice(at + 4, end - 1);
      const comma = inner.indexOf(',');
      const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
      const fallback = comma < 0 ? null : inner.slice(comma + 1);
      const value = name.startsWith('--ds-') ? values.get(name) : undefined;
      out += text.slice(i, at);
      if (value !== undefined) out += value;
      else if (fallback !== null && name.startsWith('--ds-')) out += resolve(fallback).trim();
      else out += fallback === null ? `var(${inner})` : `var(${name},${resolve(fallback)})`;
      i = end;
    }
    return out + text.slice(i);
  };
  return resolve(cssText);
}
