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
import type { Medium } from './css';
import { holdScopeStyle, scopeIdOf, type ViewLease } from './scope-style';
import type { DesignSystemRef } from './governing';
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

type Handle = Awaited<ReturnType<ArtifactHost['open']>>;

/** Resolves once the replica has synced; rejects when `signal` aborts first, its listener gone either way. */
function synced(handle: Handle, signal: AbortSignal | undefined): Promise<void> {
  if (handle.state().synced) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let done = false;
    let stop: (() => void) | null = null;
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      stop?.();
      signal?.removeEventListener('abort', aborted);
      settle();
    };
    const aborted = () => finish(() => reject(signal!.reason));
    stop = handle.subscribe((state) => {
      if (state.synced) finish(resolve);
    });
    if (done) stop();
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

/**
 * Opens a system for reading. A live ref opens the system's replica through the host and follows it until `close`; a
 * version ref reads the pinned state once (`ArtifactHost.versionState`) and never subscribes; the floor reads the
 * bundled house tokens with no store at all. Rejects with `DesignSystemMissing` when the system is not there.
 */
export function openDesignSystem(host: ArtifactHost, ref: DesignSystemRef | { builtin: 'maws' }): Promise<DesignSystemView> {
  return openSystem(host, ref, undefined);
}

/**
 * `openDesignSystem`, cancellable: when `signal` aborts before the view is ready, a handle already open is closed at
 * once (its sync listener gone), one still opening is closed when it arrives, and the promise rejects.
 */
async function openSystem(host: ArtifactHost, ref: SystemRef, signal: AbortSignal | undefined): Promise<DesignSystemView> {
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
  let handle: Handle;
  try {
    handle = await host.open(ref.id);
  } catch (error) {
    throw new DesignSystemMissing(ref, error);
  }
  try {
    signal?.throwIfAborted();
    await synced(handle, signal);
  } catch (error) {
    handle.close();
    throw error;
  }
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
  /** Cancels an open still under way: the last lease returned before the view was ready. */
  cancel: AbortController;
}
const NO_HOST = {};
const sharedViews = new WeakMap<object, Map<string, Shared>>();

function lend(host: ArtifactHost | null, key: string): ViewLease {
  const ref = refOfKey(key);
  const byKey = sharedViews.get(host ?? NO_HOST) ?? sharedViews.set(host ?? NO_HOST, new Map()).get(host ?? NO_HOST)!;
  let shared = byKey.get(key);
  if (!shared) {
    const cancel = new AbortController();
    const view = 'builtin' in ref ? builtinView() : host ? openSystem(host, ref, cancel.signal) : Promise.reject(new DesignSystemMissing(ref));
    if (view instanceof Promise) view.catch(() => byKey.get(key) === shared && byKey.delete(key)); // a failed open is tried again by the next lease
    shared = { view, refs: 0, cancel };
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
      held.cancel.abort(); // an open under way closes its handle now, not when it syncs
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
  const { tokens, law, name, origin = null } = view;
  return { tokens, law, name, origin, css: (scope, medium, overrides) => view.css(scope, medium, overrides), subscribe: (listener) => view.subscribe(listener), close: () => {} };
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

// --- Export helpers ---------------------------------------------------------------------------------------------------

// P3-C (M3 fix wave 1): `resolveDsVars` and its literal resolver live in the React-free `./literals`, re-exported here.
export { resolveDsVars } from './literals';
