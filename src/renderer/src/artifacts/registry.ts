// The editor mount registry (docs/doperpowers/plans/2026-10-12-p3-l-library.md, Decision Log 7; the P3 interface ledger
// §7; parent Decision Log 39): which component edits each artifact kind, wherever an artifact is shown. B, C, D and E
// register their kind's editor here; the panel's Artifacts tool (its record view) and the `artifact` main tab mount the
// kind's `Panel` or `Main` with the artifact, the state the editor keeps for that tab, the tab's X32 scope, under
// which the editor registers its own header (`useEditorHost`), whether the body is on screen (`visible`), and
// `onShown`, which the editor calls once the artifact's content is on screen so the surface records the owner's view.
//
// X32's lifetime rule (the ledger's §5): an editor's `closeGuard` and actions outlive its mounted body, so they must read
// state the tab owns, never a body's component state. `createState` makes that state when a surface starts showing an
// artifact, and `dispose` ends it when the surface stops (the tab closes, the panel goes Back or shows another
// artifact); a body unmounting because its tab went inactive keeps it. The stops the owner makes ask the editor's
// `closeGuard` first (closing the tab, and the panel's Back and re-target), so a replica with unacknowledged edits is not
// dropped by a move the owner did not confirm; `dispose` itself asks nothing (a tab its session took away is disposed
// unasked). The mounting surface asks for it through
// `holdArtifactEditorState` and gives it back through `releaseArtifactEditorState`; a main tab's is given back here
// when the tab leaves the main area by any path, as the editor host clears the tab's header registration. P4-B3: a move
// between the panel and a main tab hands the state over instead (stage, then adopt; below), so nothing is disposed.
import { useLayoutEffect, useRef, useSyncExternalStore, type ComponentType } from 'react';
import { create } from 'zustand';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { EditorHostScope } from '../panel/editor-host';
import { useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';

export interface ArtifactEditorProps<S = unknown> {
  artifactId: string;
  state: S; // what the editor's createState made for this tab (undefined without one)
  scope: EditorHostScope; // the tab the editor registers its X32 header under
  // The body is on screen: the panel tab is selected with the panel open, or the main tab is active with the main region
  // shown (not behind a maximized or floating panel). A body that floats things over its content (the comment card)
  // hides them while false.
  visible: boolean;
  // The editor calls it when the artifact's content is first on screen (loaded, not while it loads); idempotent. The
  // surface records the owner's view (`artifacts.markViewed`) once per showing on the first call (Decision Log 15).
  onShown(): void;
}

export interface ArtifactEditorTarget {
  artifactId: string;
  kind: ArtifactKind;
  surface: EditorHostScope['surface'];
}

export interface ArtifactEditor<S = unknown> {
  Panel: ComponentType<ArtifactEditorProps<S>>; // the panel tool's record view
  Main?: ComponentType<ArtifactEditorProps<S>>; // an `artifact` main tab; `Panel` when absent
  createState?(target: ArtifactEditorTarget): S;
  dispose?(state: S): void;
  // P4-B3 (its Decision Log 19): the state was handed to a tab on another surface by a move (`adoptStagedArtifactEditorState`);
  // a state that keeps the surface it was made for follows it here.
  moved?(state: S, target: ArtifactEditorTarget): void;
  // P4-B3 (its Decision Log 39): a move onto a surface already showing the artifact activates that view and closes the
  // source (`handArtifactViewOver`); what the source's view holds beyond the artifact itself (the document's unsent
  // comment) goes to the view kept as the source closes.
  handOver?(from: S, to: S): void;
}

// What `artifactEditorFor` answers: the registration with `Main` filled in.
export type RegisteredArtifactEditor<S = unknown> = ArtifactEditor<S> & { Main: ComponentType<ArtifactEditorProps<S>> };

const useEditors = create<{ editors: Partial<Record<ArtifactKind, RegisteredArtifactEditor>> }>()(() => ({ editors: {} }));

// The last registration of a kind wins; unregistering a registration another has replaced leaves the newer one.
export function registerArtifactEditor<S>(kind: ArtifactKind, editor: ArtifactEditor<S>): () => void {
  const registered = { ...editor, Main: editor.Main ?? editor.Panel } as unknown as RegisteredArtifactEditor;
  useEditors.setState((s) => ({ editors: { ...s.editors, [kind]: registered } }));
  return () => {
    if (useEditors.getState().editors[kind] !== registered) return;
    useEditors.setState((s) => {
      const editors = { ...s.editors };
      delete editors[kind];
      return { editors };
    });
  };
}

export const artifactEditorFor = (kind: ArtifactKind): RegisteredArtifactEditor | null => useEditors.getState().editors[kind] ?? null;

export const useArtifactEditor = (kind: ArtifactKind | null): RegisteredArtifactEditor | null =>
  useEditors((s) => (kind === null ? null : (s.editors[kind] ?? null)));

// ---- the state an editor keeps per tab ---------------------------------------------------------------------------------

// One per scope: the target it was made for, the editor that made it (whose dispose ends it) and the state. Its identity
// stands for one showing of one artifact in one tab, so a surface can key per-showing work on it (markViewed once).
export interface ArtifactEditorHold<S = unknown> {
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  readonly editor: ArtifactEditor<S>;
  readonly state: S;
}

const holds = new Map<string, ArtifactEditorHold>();
const keyOf = (scope: EditorHostScope): string => `${scope.surface}:${scope.tabId}`;

// P3-H (the P3 spec's Decision Log 93): every write to `holds` (a hold made, ended or cleared) is published to the
// renders reading a scope's hold through `useHeldArtifactEditorState`, so the React Compiler cannot keep one read before.
// The listeners hear it in a microtask, coalesced: a hold is made while a surface renders (`holdArtifactEditorState` is
// safe to call in render), where updating another component would be a render-phase update; a render reading meanwhile
// gets the map's current hold all the same.
const holdListeners = new Set<() => void>();
let publishing = false;
function published(): void {
  if (publishing) return;
  publishing = true;
  queueMicrotask(() => {
    publishing = false;
    holdListeners.forEach((listener) => listener());
  });
}
const subscribeHolds = (listener: () => void) => {
  holdListeners.add(listener);
  return () => void holdListeners.delete(listener);
};

function end(key: string): void {
  const hold = holds.get(key);
  if (!hold) return;
  holds.delete(key);
  carried.delete(key); // P4-B3 M5: a view carried to a showing that ended
  published();
  disposeHold(hold, key);
}

function disposeHold(hold: ArtifactEditorHold, key: string): void {
  try {
    hold.editor.dispose?.(hold.state);
  } catch (error) {
    console.error(`[artifacts] disposing the ${hold.kind} editor's state for ${key} failed`, error);
  }
}

// The scope's state for this artifact and editor: the one held when the scope already shows them, else one staged by a
// move for the same artifact, kind and editor (the fallback of the hand-off below), else a new one made by the editor's
// createState; the scope's previous one (another artifact, or a replaced editor) is disposed first. Safe to call while
// rendering: asking again returns what is held.
export function holdArtifactEditorState<S>(scope: EditorHostScope, artifactId: string, kind: ArtifactKind, editor: ArtifactEditor<S>): ArtifactEditorHold<S> {
  const key = keyOf(scope);
  const held = holds.get(key);
  if (held && held.artifactId === artifactId && held.kind === kind && held.editor === editor) return held as ArtifactEditorHold<S>;
  const waiting = staged.get(artifactId);
  if (waiting && waiting.kind === kind && waiting.editor === editor) {
    adoptStagedArtifactEditorState(artifactId, scope);
    return waiting as ArtifactEditorHold<S>;
  }
  end(key);
  const hold: ArtifactEditorHold<S> = { artifactId, kind, editor, state: editor.createState?.({ artifactId, kind, surface: scope.surface }) as S };
  holds.set(key, hold as ArtifactEditorHold);
  published();
  return hold;
}

// P4-B3 (its Decision Log 19): the hand-off. A move between the panel and a main tab carries the editor's state (the
// replica with every edit typed, acknowledged or not, the deck's slide, the design's viewport) instead of disposing it:
// the source stages its hold, detached from its scope and kept by artifact id, synchronously before it lets go (so its
// release ends nothing), and the target adopts it before React renders it. A hold asked for the same artifact, kind and
// editor in another scope takes a staged one as a fallback. Anything staged and not adopted by the end of the move's task
// is disposed, so a move that stopped half-way leaks nothing.
const staged = new Map<string, ArtifactEditorHold>();
const stagedViews = new Map<string, unknown>(); // P4-B3 M5: the source's view, captured as it staged (by artifact id)
let sweeping = false;

function sweepStaged(): void {
  if (sweeping) return;
  sweeping = true;
  setTimeout(() => {
    sweeping = false;
    const left = [...staged.values()];
    staged.clear();
    stagedViews.clear();
    for (const hold of left) disposeHold(hold, `staged:${hold.artifactId}`);
  }, 0);
}

// Detaches the scope's hold into the staging slot of its artifact; false when the scope holds nothing.
export function stageArtifactEditorState(scope: EditorHostScope): boolean {
  const key = keyOf(scope);
  const hold = holds.get(key);
  if (!hold) return false;
  holds.delete(key);
  carried.delete(key);
  published();
  const before = staged.get(hold.artifactId);
  if (before) disposeHold(before, `staged:${hold.artifactId}`);
  staged.set(hold.artifactId, hold);
  const view = captureView(key, hold);
  if (view === undefined) stagedViews.delete(hold.artifactId);
  else stagedViews.set(hold.artifactId, view);
  sweepStaged();
  return true;
}

// Binds the artifact's staged hold to `scope` (ending what the scope held before); false when none is staged.
export function adoptStagedArtifactEditorState(artifactId: string, scope: EditorHostScope): boolean {
  const hold = staged.get(artifactId);
  if (!hold) return false;
  staged.delete(artifactId);
  const view = stagedViews.get(artifactId);
  stagedViews.delete(artifactId);
  const key = keyOf(scope);
  end(key);
  holds.set(key, hold);
  if (view !== undefined) carried.set(key, view);
  published();
  try {
    hold.editor.moved?.(hold.state, { artifactId, kind: hold.kind, surface: scope.surface });
  } catch (error) {
    console.error(`[artifacts] moving the ${hold.kind} editor's state to ${key} failed`, error);
  }
  return true;
}

// P4-B3 (its Decision Log 39): a move onto a surface that already shows the artifact (T5, T8) activates that view and
// closes the source rather than handing the source's hold over, so what the source's view holds beyond the artifact's
// own state (the document's unsent comment) goes to the destination's state, in the same synchronous run as the
// source's close (after its guard was asked as a move's, `moving`), and the source's close has nothing of it to lose.
// The destination's state is the one its scope holds, made now when its body has not mounted yet. False, changing
// nothing, when the source holds nothing, its editor hands nothing over, or the destination holds another showing.
export function handArtifactViewOver(from: EditorHostScope, to: EditorHostScope): boolean {
  const source = holds.get(keyOf(from));
  if (!source?.editor.handOver) return false;
  const there = holds.get(keyOf(to));
  if (there && (there.artifactId !== source.artifactId || there.kind !== source.kind || there.editor !== source.editor)) return false;
  const target = holdArtifactEditorState(to, source.artifactId, source.kind, source.editor);
  try {
    source.editor.handOver(source.state, target.state);
    return true;
  } catch (error) {
    console.error(`[artifacts] handing the ${source.kind} editor's view from ${keyOf(from)} to ${keyOf(to)} over failed`, error);
    return false;
  }
}

// P4-B3 M5 (its Decision Log 25): the view carry. A hold carries the editor's state, not what its mounted body shows
// (a document's scroll and selection live only in the editor's view), so a body registers `captureView` under its
// scope while it is mounted, beside its X32 registration; a move captures it as the source stages its hold (the body
// still mounted), the memento travels with the hold, and the target's first mount takes it once (`takeCarriedView`),
// restoring after its content is drawn. A capture that throws carries nothing; the move goes on.
const captures = new Map<string, () => unknown>();
const carried = new Map<string, unknown>();

function captureView(key: string, hold: ArtifactEditorHold): unknown {
  try {
    return captures.get(key)?.();
  } catch (error) {
    console.error(`[artifacts] capturing the ${hold.kind} editor's view for ${key} failed`, error);
    return undefined;
  }
}

// Registers what the body in `scope` would need to come back to the same place; returns the removal (a stale removal,
// after another registration replaced it, leaves the newer one).
export function registerArtifactViewCapture(scope: EditorHostScope, capture: () => unknown): () => void {
  const key = keyOf(scope);
  captures.set(key, capture);
  return () => {
    if (captures.get(key) === capture) captures.delete(key);
  };
}

// The same, for a body: registered while it is mounted, calling the latest render's capture.
export function useArtifactViewCapture({ surface, tabId }: EditorHostScope, capture: () => unknown): void {
  const latest = useRef(capture);
  useLayoutEffect(() => {
    latest.current = capture;
  });
  useLayoutEffect(() => registerArtifactViewCapture({ surface, tabId }, () => latest.current()), [surface, tabId]);
}

// The view a move carried to `scope`, once (undefined when none): the target body's first mount restores it.
export function takeCarriedView(scope: EditorHostScope): unknown {
  const key = keyOf(scope);
  const view = carried.get(key);
  carried.delete(key);
  return view;
}

// What the scope holds now, if anything: a surface that cannot confirm the artifact for a moment (its host unreachable)
// keeps showing the editor it was showing from this.
export const heldArtifactEditorState = (scope: EditorHostScope): ArtifactEditorHold | null => holds.get(keyOf(scope)) ?? null;

// The same, for a render: re-rendered at every hold and release (P3-H, Decision Log 93).
export const useHeldArtifactEditorState = (scope: EditorHostScope): ArtifactEditorHold | null =>
  useSyncExternalStore(subscribeHolds, () => heldArtifactEditorState(scope));

// The surface stopped showing an artifact in this scope (the panel went Back or its tab went, a main tab shows a notice).
export function releaseArtifactEditorState(scope: EditorHostScope): void {
  end(keyOf(scope));
}

// Main tabs: a held state whose tab is in no pane of any project's tab set any more is disposed, whatever closed it; a
// tab moving between panes or sets keeps it.
const MAIN_PREFIX = 'main:';
useLayout.subscribe((state, before) => {
  if (state.main === before.main) return;
  const held = [...holds.keys()].filter((key) => key.startsWith(MAIN_PREFIX));
  if (held.length === 0) return;
  const open = new Set(allTabs(state.main).map((t) => t.id));
  for (const key of held) if (!open.has(key.slice(MAIN_PREFIX.length))) end(key);
});

// Tests: no editors and no held state (nothing disposed).
export function resetArtifactEditors(): void {
  holds.clear();
  staged.clear();
  stagedViews.clear();
  captures.clear();
  carried.clear();
  published();
  useEditors.setState({ editors: {} });
}
