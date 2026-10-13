// The editor mount registry (docs/doperpowers/plans/2026-10-12-p3-l-library.md, Decision Log 7; the P3 interface ledger
// §7; parent Decision Log 39): which component edits each artifact kind, wherever an artifact is shown. B, C, D and E
// register their kind's editor here; the panel's Artifacts tool (its record view) and the `artifact` main tab mount the
// kind's `Panel` or `Main` with the artifact, the state the editor keeps for that tab, the tab's X32 scope, under
// which the editor registers its own header (`useEditorHost`), and `onShown`, which the editor calls once the
// artifact's content is on screen so the surface records the owner's view.
//
// X32's lifetime rule (the ledger's §5): an editor's `closeGuard` and actions outlive its mounted body, so they must read
// state the tab owns, never a body's component state. `createState` makes that state when a surface starts showing an
// artifact, and `dispose` ends it when the surface stops (the tab closes, the panel goes Back or shows another
// artifact); a body unmounting because its tab went inactive keeps it. The mounting surface asks for it through
// `holdArtifactEditorState` and gives it back through `releaseArtifactEditorState`; a main tab's is given back here
// when the tab leaves the main area by any path, as the editor host clears the tab's header registration.
import type { ComponentType } from 'react';
import { create } from 'zustand';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { EditorHostScope } from '../panel/editor-host';
import { useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';

export interface ArtifactEditorProps<S = unknown> {
  artifactId: string;
  state: S; // what the editor's createState made for this tab (undefined without one)
  scope: EditorHostScope; // the tab the editor registers its X32 header under
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

function end(key: string): void {
  const hold = holds.get(key);
  if (!hold) return;
  holds.delete(key);
  try {
    hold.editor.dispose?.(hold.state);
  } catch (error) {
    console.error(`[artifacts] disposing the ${hold.kind} editor's state for ${key} failed`, error);
  }
}

// The scope's state for this artifact and editor: the one held when the scope already shows them, else a new one made by
// the editor's createState after the scope's previous one (another artifact, or a replaced editor) is disposed. Safe to
// call while rendering: asking again returns what is held.
export function holdArtifactEditorState<S>(scope: EditorHostScope, artifactId: string, kind: ArtifactKind, editor: ArtifactEditor<S>): ArtifactEditorHold<S> {
  const key = keyOf(scope);
  const held = holds.get(key);
  if (held && held.artifactId === artifactId && held.kind === kind && held.editor === editor) return held as ArtifactEditorHold<S>;
  end(key);
  const hold: ArtifactEditorHold<S> = { artifactId, kind, editor, state: editor.createState?.({ artifactId, kind, surface: scope.surface }) as S };
  holds.set(key, hold as ArtifactEditorHold);
  return hold;
}

// What the scope holds now, if anything: a surface that cannot confirm the artifact for a moment (its host unreachable)
// keeps showing the editor it was showing from this.
export const heldArtifactEditorState = (scope: EditorHostScope): ArtifactEditorHold | null => holds.get(keyOf(scope)) ?? null;

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
  useEditors.setState({ editors: {} });
}
