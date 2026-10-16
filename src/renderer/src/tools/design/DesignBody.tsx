// The design workbench in the panel's Artifacts tool and in an `artifact` main tab (docs/doperpowers/plans/2026-10-16-
// p3-e1-design-workbench.md, M3; the ledger's X32 and §7): `DesignWorkbench` over the tab's replica and view (the state L's
// registry made for this tab), the X32 header registered under the scope the surface gives, the world registered as the
// tab's Mark-up surface while it is on screen, the boards in the design's governing design system (D's chain, as the
// deck's: its own system, its Space's default, the owner's, else the bundled floor), and `onShown` once every board has
// drawn while the body is visible. Comments and history (M4) and export (M5) join here later.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DesignWorkbench } from '@artifacts/design/editor/DesignWorkbench';
import type { DeckSession } from '@artifacts/slides/editor/session';
import type { ArtifactEditorProps } from '../../artifacts/registry';
import { useLibraryList, useLibraryRow } from '../../library/store';
import { useRegionMarkupSurface } from '../../markup/surface';
import { useEditorHost } from '../../panel/editor-host';
import { chooseDeckSystem } from '../presentation/commands';
import { useDeckSystem } from '../presentation/governing';
import { designHeader, type DesignHeaderCommands } from './header';
import type { DesignTabState } from './tab-state';

export type DesignEditorBodyProps = ArtifactEditorProps<DesignTabState>;

export function DesignPanel(props: DesignEditorBodyProps) {
  return <DesignBody {...props} compact />;
}
export function DesignMain(props: DesignEditorBodyProps) {
  return <DesignBody {...props} compact={false} />;
}

const NO_SESSION = () => () => {};
/** The panel open beside the world (the header shows it pressed); null before the design opens. */
function useRail(session: DeckSession | null) {
  return useSyncExternalStore(session?.subscribe ?? NO_SESSION, () => session?.snapshot().rail ?? null);
}

function DesignBody({ artifactId, state, scope, visible, onShown, compact }: DesignEditorBodyProps & { compact: boolean }) {
  const snapshot = useSyncExternalStore(state.subscribe, state.snapshot);
  const row = useLibraryRow(artifactId).value;
  const title = row?.title ?? 'Design';
  useEffect(() => state.setTitle(title), [state, title]);
  const session = snapshot.session;
  const rail = useRail(session);
  const commands = useMemo<DesignHeaderCommands | undefined>(() => (session ? { fitAll: state.fitAll, toggleRail: (r) => session.toggleRail(r) } : undefined), [session, state]);
  useEditorHost(scope, designHeader({ title, document: snapshot.document, saving: snapshot.saving, closeGuard: state.closeGuard, rail, unresolved: snapshot.unresolved }, commands));

  const placement = useMemo(() => (row ? { ...(row.designSystemId && { designSystemId: row.designSystemId }), ...(row.spaceId && { spaceId: row.spaceId }) } : null), [row]);
  const system = useDeckSystem(placement);
  const systemRows = useLibraryList({ kind: 'design_system' }).value?.rows;
  const theme = useMemo(
    () => ({ systems: (systemRows ?? []).map((s) => ({ id: s.id, name: s.title })), chosen: row?.designSystemId ?? null, choose: (id: string | null) => chooseDeckSystem(artifactId, id) }),
    [systemRows, row?.designSystemId, artifactId],
  );
  const assetUrl = useCallback((ref: string) => state.host.assetUrl(artifactId, ref), [state, artifactId]);
  const uploadAsset = useCallback(async (file: File) => (await state.host.uploadAsset(artifactId, new Uint8Array(await file.arrayBuffer()), { name: file.name, mime: file.type })).ref, [state, artifactId]);
  // a picture pasted from another artifact: a MAWS asset is copied by the store (bytes and mime unchanged)
  const importAsset = useCallback(async (source: string, ref: string) => (await state.host.copyAsset(source, ref, artifactId)).ref, [state, artifactId]);

  // the world is the tab's Mark-up surface while it is on screen
  const stage = useRef<HTMLElement | null>(null);
  const [stageShown, setStageShown] = useState(false);
  const onStage = useCallback((element: HTMLElement | null) => {
    stage.current = element;
    setStageShown(element !== null);
  }, []);
  useRegionMarkupSurface(stage, `“${title}”`, visible && stageShown);

  // the owner's view (L's `onShown`, then markViewed): once per showing, once every board is drawn while visible
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (!visible || !drawn) return;
    if (state.markShown()) onShown();
  }, [visible, drawn, state, onShown]);
  const onDrawn = useCallback(
    (boards: number) => {
      session?.markDrawn(boards);
      setDrawn(true);
    },
    [session],
  );

  if (snapshot.failed !== null) return <Notice>{`This design could not be opened: ${snapshot.failed}`}</Notice>;
  if (!snapshot.handle || !session) return <Notice>Opening the design…</Notice>;
  return (
    <div className="h-full" data-design-artifact={artifactId} data-design-surface={scope.surface}>
      <DesignWorkbench
        session={session}
        view={state.view}
        assetUrl={assetUrl}
        system={system}
        readOnly={snapshot.document?.readOnly ?? false}
        compact={compact}
        uploadAsset={uploadAsset}
        artifactId={artifactId}
        importAsset={importAsset}
        theme={theme}
        onStage={onStage}
        onDrawn={onDrawn}
      />
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex h-full items-center justify-center p-6 text-center text-ui text-fg-muted">
      {children}
    </div>
  );
}
