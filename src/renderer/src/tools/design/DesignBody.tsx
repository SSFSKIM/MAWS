// The design workbench in the panel's Artifacts tool and in an `artifact` main tab (docs/doperpowers/plans/2026-10-16-
// p3-e1-design-workbench.md, M3; the ledger's X32 and §7): `DesignWorkbench` over the tab's replica and view (the state L's
// registry made for this tab), the X32 header registered under the scope the surface gives, the world registered as the
// tab's Mark-up surface while it is on screen, the boards in the design's governing design system (D's chain, as the
// deck's: its own system, its Space's default, the owner's, else the bundled floor), and `onShown` once every board has
// drawn while the body is visible. M5: the header's Export (./exports.ts), each entry reading the tab's state when chosen.
// M4: comments go to the session the main area shows (P3-F: with none shown, the design's own context, as the deck's and
// the document's), through B's comment surface (P2's card with B's artifact target,
// the design kind and its board or element target), the replica held by the tab while the card's overlay writes; the
// header's Version history and Comments and its open-thread count; the history over the tab's history api read through
// the design model, its new-change pill counting the design's projection (C's `countChanges` hook, Decision Log 23).
// P4-B4: an open's place (a link's fragment, `show_pane`'s `at`) reaches the workbench as its `reveal`, the open request
// for this artifact on this surface, taken once the workbench has it.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DesignWorkbench } from '@artifacts/design/editor/DesignWorkbench';
import { countDesignChanges } from '@artifacts/design/history';
import type { DeckSession } from '@artifacts/slides/editor/session';
import type { ArtifactEditorProps } from '../../artifacts/registry';
import { useLibraryList, useLibraryRow } from '../../library/store';
import { useRegionMarkupSurface } from '../../markup/surface';
import { sendToSubject, useSendToAction } from '../../delivery/header'; // P4-B5
import { useEditorHost } from '../../panel/editor-host';
import { registerEditClaimant } from '../../keymap/edit-claimants'; // P4-B2 K6
import { keymapBinds } from '../../keymap/dispatcher'; // P4-B2 (D14)
import { takeOpenRequest, useOpenRequest } from '../artifacts/viewers/requests'; // P4-B4
import { useArtifactCommentTarget } from '../document/comment-session'; // P3-F (L230)
import { useDocumentComments } from '../document/comments';
import { chooseDeckSystem } from '../presentation/commands';
import { useDeckSystem } from '../presentation/governing';
import { designExports, designVersionExports, runDesignExport } from './exports';
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
const NO_TARGET = { context: { kind: 'none' } } as const; // P3-F (L230): unused while the target is unread (no comments offered)
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
  // M5: the Export menu follows what the tab shows (its selected board, the version its history previews); an entry
  // chosen reads the tab's state then, so what it exports is what is on screen at that moment
  const exportShown = useSyncExternalStore(state.view.subscribe, () => state.view.snapshot().shown);
  const exportBoard = useSyncExternalStore(state.view.subscribe, () => state.view.snapshot().frame);
  const activeBoard = useSyncExternalStore(session?.subscribe ?? NO_SESSION, () => session?.snapshot().currentSlide ?? null);
  const shownBoard = exportShown !== null && exportShown !== 'compare' ? exportShown.board : (exportBoard ?? activeBoard);
  const exports = useMemo(() => designExports({ shown: exportShown, board: shownBoard }, (entry) => void runDesignExport(artifactId, entry, state.exportContext())), [exportShown, shownBoard, state, artifactId]);
  const header = designHeader({ title, document: snapshot.document, saving: snapshot.saving, closeGuard: state.closeGuard, rail, unresolved: snapshot.unresolved, history: state.designHistory !== null, exports, previewing: exportShown !== null }, commands);
  const sendTo = useSendToAction(sendToSubject(artifactId, 'design', row?.title, exportShown, shownBoard)); // P4-B5: a PNG sent pictures the board Export would
  useEditorHost(scope, sendTo ? { ...header, actions: [...(header.actions ?? []), sendTo] } : header);

  // M4: comments go to the session the main area shows (its Side thread, or its conversation). P3-F (L230): with none
  // shown, to the design's own context, as the document's and the deck's (P3-F1); not offered only while that is unread
  const target = useArtifactCommentTarget(artifactId);
  // P4-B2 (D16): X36's draft rule and the tab state's card host id, as the deck's
  const comments = useDocumentComments({ artifactId, ...(target ?? NO_TARGET), title, mode: scope.surface === 'main' ? 'tab' : 'panel', visible, holdReplica: state.hold, artifactKind: 'design', draftRule: true, hostId: state.commentHostId });
  // M4: the history over the tab's api and replica, the pill counting the design's projection
  const handle = snapshot.handle;
  const history = useMemo(() => (state.designHistory && handle ? { api: state.designHistory, handle, countChanges: countDesignChanges } : undefined), [state.designHistory, handle]);

  const placement = useMemo(() => (row ? { ...(row.designSystemId && { designSystemId: row.designSystemId }), ...(row.spaceId && { spaceId: row.spaceId }) } : null), [row]);
  const system = useDeckSystem(placement);
  const systemRows = useLibraryList({ kind: 'design_system' }).value?.rows;
  const theme = useMemo(
    () => ({ systems: (systemRows ?? []).map((s) => ({ id: s.id, name: s.title })), chosen: row?.designSystemId ?? null, choose: (id: string | null) => chooseDeckSystem(artifactId, id) }),
    [systemRows, row?.designSystemId, artifactId],
  );
  const assetUrl = useCallback((ref: string) => state.host.assetUrl(artifactId, ref), [state, artifactId]);
  const assetUrlAt = useCallback((ref: string, revision: number) => state.host.assetUrl(artifactId, ref, revision), [state, artifactId]); // M4: a version's assets
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
  const reveal = useOpenRequest(artifactId, scope.surface); // P4-B4: an open's place (a link's board or version)

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
        onCanvases={state.setCanvases}
        comments={target === null ? undefined : comments /* P3-F (L230) */}
        history={history}
        versionExports={history ? (versionId) => designVersionExports(artifactId, versionId, state.exportContext(), history.api) : undefined}
        sessionTitle={state.sessionTitle}
        assetUrlAt={assetUrlAt}
        reveal={reveal} /* P4-B4 */
        onRevealed={takeOpenRequest}
        registerEditClaimant={registerEditClaimant} /* P4-B2 K6: the Edit menu's Undo and Redo on the design's stack */
        bindsKey={keymapBinds} /* P4-B2 (D14): the workbench's F6 steps aside for a key the owner bound */
        provisional={snapshot.provisional} /* P4-A2 G2.4: an agent's publish drawn as it streams */
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
