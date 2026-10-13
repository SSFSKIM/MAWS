// The Design System page in the app (Decision Log 16 and 17 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md):
// the renderer-side body that mounts the portable page and registers what only the app has, the tab's header (X32) and
// its Mark-up surface. It is the component L's `registerArtifactEditor` mounts in M6; until then the caller gives it
// the system's open handle and the host.
//
// The header (X32, final rule of G's M3): the system's name, the saved state of its replica, "Check against law",
// "Set as my default" (its handler M6's, through settings 14; shown disabled until then) and the export "Export for
// Claude". A registration outlives this body, so its actions read the tab's state, never this component's: the check's
// request goes through a store keyed by the tab, the export through the host, the default through the given handler.
// Every edit writes through to the replica, so there is nothing unsaved to guard on close.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { DesignSystemPage } from '@artifacts/design-system/page/DesignSystemPage';
import { usePageState } from '@artifacts/design-system/page/use-system';
import { useRegionMarkupSurface } from '../../markup/surface';
import { useEditorHost, useEditorHostScope, type EditorHostScope, type SavedState } from '../../panel/editor-host';
import { toast } from '../../stores/notices';

export const DESIGN_SYSTEM_COPY = {
  untitled: 'Design system',
  check: 'Check against law',
  setDefault: 'Set as my default',
  exportClaude: 'Export for Claude',
  exported: (path: string) => `Exported for Claude to ${path}`,
  exportFailed: (reason: string) => `Could not export for Claude: ${reason}`,
} as const;

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
  /** "Set as my default": makes this system the owner's default (M6, settings 14). Absent, the action is disabled. */
  onSetDefault?: () => void;
  /** Called once the system's content is on screen (L's `onShown`). */
  onShown?: () => void;
}

export function DesignSystemBody(props: DesignSystemBodyProps) {
  const { artifactId, handle, host, onSetDefault, onShown } = props;
  const scope = useEditorHostScope();
  const key = keyOf(scope, artifactId);
  const reveal = useCheckRequests((s) => s.serials[key] ?? 0);
  const saved = useSyncExternalStore(
    (listener) => handle.subscribe(listener),
    () => savedStateOf(handle.state()),
  );
  const name = usePageState(handle.doc).system.meta?.name ?? null;

  useEditorHost(scope, {
    title: name ?? DESIGN_SYSTEM_COPY.untitled,
    saved,
    actions: [
      { id: 'design-system.check', label: DESIGN_SYSTEM_COPY.check, onSelect: () => requestCheck(key) },
      { id: 'design-system.set-default', label: DESIGN_SYSTEM_COPY.setDefault, onSelect: () => onSetDefault?.(), disabled: !onSetDefault },
    ],
    exports: [{ id: 'design-system.export-claude', label: DESIGN_SYSTEM_COPY.exportClaude, onSelect: () => exportForClaude(host, artifactId) }],
  });

  const surface = useRef<HTMLDivElement>(null);
  useRegionMarkupSurface(surface, name ?? DESIGN_SYSTEM_COPY.untitled, true);

  const shown = name !== null;
  useEffect(() => {
    if (shown) onShown?.();
  }, [shown, onShown]);

  return (
    <div ref={surface} className="h-full min-h-0 overflow-auto bg-bg">
      <DesignSystemPage artifactId={artifactId} handle={handle} host={host} readOnly={saved === 'readonly'} revealCheck={reveal} />
    </div>
  );
}
