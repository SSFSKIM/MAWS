// The Design System page in the app (Decision Log 16 and 17 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md):
// the renderer-side body that mounts the portable page and registers what only the app has, the tab's header (X32) and
// its Mark-up surface. The editor L's `registerArtifactEditor` mounts (./editor.tsx) gives it the system's open handle,
// the host and the app's handlers.
//
// The header (X32, final rule of G's M3): the system's name, the saved state of its replica, "Check against law",
// "Set as my default" (settings 14; disabled when it is already the default, or without a handler), "Delete design
// system…" (with a handler) and the export "Export for Claude". A registration outlives this body, so its actions read
// the tab's state, never this component's: the check's request goes through a store keyed by the tab, the export
// through the host, the default and the delete through the given handlers. Every edit writes through to the replica, so
// there is nothing unsaved to guard on close. Hidden (`visible` false), the body reports nothing shown and offers no
// Mark-up surface.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { DesignSystemPage } from '@artifacts/design-system/page/DesignSystemPage';
import type { AskAdopt } from '@artifacts/design-system/page/Law';
import { usePageState } from '@artifacts/design-system/page/use-system';
import { useRegionMarkupSurface } from '../../markup/surface';
import { useEditorHost, useEditorHostScope, type EditorHostScope, type SavedState } from '../../panel/editor-host';
import { toast } from '../../stores/notices';
import { DESIGN_SYSTEM_COPY } from './copy';

// "Check against law" asks the tab's page to bring its check into view: a serial per tab, outside any component.
const useCheckRequests = create<{ serials: Readonly<Record<string, number>> }>()(() => ({ serials: {} }));
const keyOf = (scope: EditorHostScope | null, artifactId: string) => (scope ? `${scope.surface}:${scope.tabId}` : `artifact:${artifactId}`);
function requestCheck(key: string): void {
  useCheckRequests.setState((s) => ({ serials: { ...s.serials, [key]: (s.serials[key] ?? 0) + 1 } }));
}

/** The header's saved state from the replica's (A's `DocumentState`). */
export function savedStateOf(state: DocumentState): SavedState {
  if (state.readOnly) return 'readonly';
  if (state.phase !== 'live') return 'reconnecting';
  return state.unsaved > 0 ? 'saving' : 'saved';
}

function exportForClaude(host: Pick<ArtifactHost, 'export'>, artifactId: string): void {
  host.export(artifactId, 'claude').then(
    ({ path }) => toast({ level: 'info', text: DESIGN_SYSTEM_COPY.exported(path), actions: [], dismissible: true }),
    (error: unknown) => toast({ level: 'danger', text: DESIGN_SYSTEM_COPY.exportFailed(error instanceof Error ? error.message : String(error)), actions: [], dismissible: true }),
  );
}

export interface DesignSystemBodyProps {
  artifactId: string;
  /** The system's replica, opened by the tab (L's `createState` in M6) and closed with it. */
  handle: DocumentHandle;
  host: Pick<ArtifactHost, 'assetUrl' | 'export'>;
  /** "Set as my default": makes this system the owner's default (settings 14). Absent, the action is disabled. */
  onSetDefault?: () => void;
  /** This system is the owner's default already: "Set as my default" is disabled. */
  isDefault?: boolean;
  /** "Delete design system…": the editor's delete sheet. Absent, no such action. */
  onDelete?: () => void;
  /** A system with no law offers "Ask the agent to adopt it" through this. */
  askAdopt?: AskAdopt;
  /** Whether the body is on screen (L's `visible`); true when absent. */
  visible?: boolean;
  /** Called once the system's content is on screen (L's `onShown`). */
  onShown?: () => void;
  /** The artifact's title (the library's), which the header, Mark-up and the page show (Decision Log 29); the system's
   * name when absent. */
  title?: string;
}

export function DesignSystemBody(props: DesignSystemBodyProps) {
  const { artifactId, handle, host, onSetDefault, isDefault = false, onDelete, askAdopt, visible = true, onShown, title } = props;
  const scope = useEditorHostScope();
  const key = keyOf(scope, artifactId);
  const reveal = useCheckRequests((s) => s.serials[key] ?? 0);
  const saved = useSyncExternalStore(
    (listener) => handle.subscribe(listener),
    () => savedStateOf(handle.state()),
  );
  const name = usePageState(handle.doc).system.meta?.name ?? null;
  const shownTitle = title ?? name ?? DESIGN_SYSTEM_COPY.untitled;

  useEditorHost(scope, {
    title: shownTitle,
    saved,
    actions: [
      { id: 'design-system.check', label: DESIGN_SYSTEM_COPY.check, onSelect: () => requestCheck(key) },
      { id: 'design-system.set-default', label: DESIGN_SYSTEM_COPY.setDefault, onSelect: () => onSetDefault?.(), disabled: !onSetDefault || isDefault },
      ...(onDelete ? [{ id: 'design-system.delete', label: DESIGN_SYSTEM_COPY.deleteAction, onSelect: () => onDelete() }] : []),
    ],
    exports: [{ id: 'design-system.export-claude', label: DESIGN_SYSTEM_COPY.exportClaude, onSelect: () => exportForClaude(host, artifactId) }],
  });

  const surface = useRef<HTMLDivElement>(null);
  useRegionMarkupSurface(surface, shownTitle, visible);

  const shown = name !== null && visible;
  useEffect(() => {
    if (shown) onShown?.();
  }, [shown, onShown]);

  return (
    <div ref={surface} className="h-full min-h-0 overflow-auto bg-bg">
      <DesignSystemPage artifactId={artifactId} handle={handle} host={host} readOnly={saved === 'readonly'} revealCheck={reveal} askAdopt={askAdopt} title={title} />
    </div>
  );
}
