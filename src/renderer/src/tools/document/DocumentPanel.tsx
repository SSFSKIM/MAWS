// The document editor in the panel's Artifacts tool (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D13),
// and the body it shares with the `artifact` main tab (DocumentMain): `DocumentEditor` over the tab's replica (the
// state L's registry made for this tab), the X32 header registered under the scope the surface gives, the page
// registered as a Mark-up surface, comments going to the session the main area shows (P3-F1: with none shown, the
// artifact's own context), the history rail on A's IPC, the page in the governing design system's scope when D's is
// provided, `onShown` once the document is on screen. P4-B4: an open's place (a link's fragment, `show_pane`'s `at`)
// reaches the editor as its `reveal`, the open request for this artifact on this surface, taken once the editor has it.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DocumentEditor, type DocumentRail, type DocumentShown } from '@artifacts/document/editor/DocumentEditor'; // P3-F (F7): DocumentShown
import type { Editor } from '@tiptap/core';
import type { ArtifactKind } from '@shared/artifacts/entity'; // P3-E
import type { Doc } from '@artifacts/yjs'; // P3-E
import type { Node as PMNode } from '@tiptap/pm/model'; // P3-E
import type { ViewEnvironment } from '@artifacts/document/editor/nodes/views'; // P3-E
import type { EditorHostAction } from '../../panel/editor-host'; // P3-E
import { takeCarriedView, useArtifactViewCapture, type ArtifactEditorProps } from '../../artifacts/registry'; // P4-B3 M5: the view carry
import { useRegionMarkupSurface } from '../../markup/surface';
import { useEditorHost } from '../../panel/editor-host';
import { useSendToAction } from '../../delivery/header'; // P4-B5
import { takeOpenRequest, useOpenRequest } from '../artifacts/viewers/requests'; // P4-B4
import { useArtifactCommentTarget } from './comment-session'; // P3-F1
import { forgetCardActivation, useDocumentComments } from './comments'; // P4-B3: forgetCardActivation
import { documentDesignSystem, PageSystemProvider, SystemPage, useDocumentOverrides, useSystemFor } from './design-system'; // P3-D: useSystemFor
import { documentExports, documentHeader, type DocumentHeaderCommands } from './header';
import { useLibraryRow, useLibrarySpaces } from '../../library/store';
import { returnedTo } from './history-api'; // P4 (tracker L274)
import { setCommentsView } from './comments-view'; // P4-B1
import { useSettings } from '../../stores/settings'; // P4-B1
import type { CommentsView } from '@artifacts/comments/view'; // P4-B1
import type { DocumentTabState } from './tab-state';
import { captureDocumentView, keepUndoManager, liveBody, restoreDocumentViewWhenDrawn, type DocumentView } from './view-carry'; // P4-B3 M5

export type DocumentEditorProps = ArtifactEditorProps<DocumentTabState>;

// P3-E start (E2 M3; ledger X26 as amended, E's Decision Log 19): what a dashboard adds to B's shell, each optional and
// absent for a document: its charts' renderer, its kind (the comment card's and the notices' wording), the header actions
// it adds after B's (Datasets), and the document the editor shows as it changes (the live one, a version's, the
// suggestion replica's).
interface DocumentShellAdditions {
  renderChart?: ViewEnvironment['renderChart'];
  artifactKind?: ArtifactKind;
  additionalActions?: readonly EditorHostAction[];
  onDisplayedDocument?(doc: Doc, revision?: number): void;
  /** E2 M4 (E's Decision Log 28): the quote of a selected block commented whole (a chart's view and caption). */
  blockCommentQuote?(node: PMNode): string | undefined;
}
// P3-E end

export function DocumentPanel(props: DocumentEditorProps & DocumentShellAdditions /* P3-E */) {
  return <DocumentBody {...props} surface="panel" />;
}

const NO_TARGET = { context: { kind: 'none' } } as const; // P3-F1: unused while the target is unread (no comments offered)

export function DocumentBody({ artifactId, state, scope, visible, onShown, surface, renderChart, artifactKind, additionalActions, onDisplayedDocument, blockCommentQuote /* P3-E */ }: DocumentEditorProps & DocumentShellAdditions & { surface: 'panel' | 'main' }) {
  const snapshot = useSyncExternalStore(state.subscribe, state.snapshot);
  const title = snapshot.title || 'Document'; // until the artifact's row is read
  const commands = useMemo<DocumentHeaderCommands>(
    () => ({
      toggleRail: (rail) => state.toggleRail(rail),
      saveVersion: () => state.requestSaveVersion(),
      setSuggestions: (on) => void state.setSuggestions(on),
      export: (format, pageSize) => void state.export(format, pageSize),
      dismissExport: () => state.dismissExport(),
      closeGuard: state.closeGuard,
    }),
    [state],
  );
  const header = documentHeader(
    { title, document: snapshot.document, saving: snapshot.saving, previewing: snapshot.previewing, unresolved: snapshot.unresolved, rail: snapshot.rail, history: true, suggestions: snapshot.suggestions, exporting: snapshot.exporting, shown: snapshot.shown /* P3-F (F7) */ },
    commands,
  );
  // P4-B5: Send to, the shown version's when one is previewed (none while two are compared, as Export)
  const sendTo = useSendToAction(snapshot.title && snapshot.shown !== 'compare' ? { artifactId, kind: artifactKind ?? 'document', title: snapshot.title, ...(snapshot.shown && { versionId: snapshot.shown.versionId }) } : null);
  const actions = [...(header.actions ?? []), ...(additionalActions ?? []), ...(sendTo ? [sendTo] : [])]; // P3-E: a dashboard's actions after B's; P4-B5: Send to last
  const governing = useSystemFor(snapshot.placement);
  const systemRow = useLibraryRow(governing && 'id' in governing ? governing.id : null).value;
  const spaces = useLibrarySpaces().value;
  const home = snapshot.placement.spaceId ? spaces?.find((space) => space.id === snapshot.placement.spaceId)?.name : 'General';
  const systemName = governing && ('builtin' in governing ? 'MAWS' : systemRow?.title);
  const breadcrumb = snapshot.ready ? [home ?? 'Loading Space…', ...(systemName && snapshot.shown === null ? [`Design: ${systemName}`] : [])] : [];
  useEditorHost(scope, { ...header, breadcrumb, actions });

  // Comments go to the session the main area shows (its Side thread, or its conversation). P3-F1: with none shown, to
  // the artifact's own context (its session, a session its directory starts on Comment, or a card saying why not);
  // not offered only while that is unread.
  const target = useArtifactCommentTarget(artifactId);
  const comments = useDocumentComments({ artifactId, ...(target ?? NO_TARGET), title, mode: surface === 'main' ? 'tab' : 'panel', visible, holdReplica: state.hold, ...(artifactKind !== undefined && { artifactKind }) /* P3-E */, draftRule: true /* P4-B1: X36's draft rule, the document's (its Comment asks draft(), its tab's close guard reads it) */, hostId: state.commentHostId /* P4-B3 M6: a move keeps the composing card */ });

  // The page is the tab's Mark-up surface while it is on screen.
  const page = useRef<HTMLElement | null>(null);
  const [pageShown, setPageShown] = useState(false);
  const onPage = useCallback((element: HTMLElement | null) => {
    page.current = element;
    setPageShown(element !== null);
  }, []);
  useRegionMarkupSurface(page, `“${title}”`, visible && pageShown);

  // The owner's view (L's `onShown`, then `markViewed`): once per showing (the tab's state remembers it), only once the
  // synced document is drawn (an editor bound to its tab, a frame later) while the body is visible; a body that goes or
  // hides first cancels the frame.
  const [editor, setEditor] = useState<Editor | null>(null); // P4-B3 M5: the live editor (was only whether there is one)
  const drawn = editor !== null;
  useEffect(() => {
    if (!visible || !drawn || state.shown()) return;
    const frame = requestAnimationFrame(() => {
      if (state.markShown()) onShown();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, drawn, state, onShown]);
  // P4 (tracker L274; amends L's Decision Log 15 for the document's rail): a return to the document while its editor
  // stayed mounted (the panel closed and reopened, the main region shown again from behind the panel) is a look too,
  // the rail's (`returnedTo`): its "See N new changes" and its record of the view. A remount (a main tab made active
  // again) looks by itself; the surface's own view (`onShown`) stays once per showing.
  const away = useRef(false);
  useEffect(() => {
    if (!visible) away.current ||= state.shown();
    else if (away.current && drawn) {
      away.current = false;
      returnedTo(state.history);
    }
  }, [visible, drawn, state]);
  // P4-B3 M5 (view-carry.ts): the tab's undo history in every editor this body mounts, so ⌘Z after a remount (a tab
  // switch, a move) undoes what was typed before it; and where the owner was, captured for a move and restored once by
  // the first mount it moved to.
  useEffect(() => {
    const body = editor && liveBody(editor);
    const manager = body && state.undoManagerFor(body);
    return editor && manager ? keepUndoManager(editor, manager) : undefined;
  }, [editor, state]);
  useArtifactViewCapture(scope, () => {
    if (!editor) return undefined;
    forgetCardActivation(state.commentHostId); // Decision Log 37: the card activates its thread in the editor it moves to
    return captureDocumentView(editor, page.current) ?? undefined;
  });
  const carried = useRef<DocumentView | null | undefined>(undefined); // undefined: not taken yet
  const restoring = useRef<(() => void) | null>(null); // the carried restore's cancel, until it has settled or gone
  useEffect(() => {
    if (carried.current === undefined) carried.current = (takeCarriedView(scope) as DocumentView | undefined) ?? null;
  }, [scope]);
  useEffect(() => {
    const view = carried.current;
    if (!editor || !view) return;
    const cancel = restoreDocumentViewWhenDrawn(editor, () => page.current, view, () => (carried.current = null));
    restoring.current = cancel;
    return () => {
      cancel();
      restoring.current = null;
    };
  }, [editor]);
  const onRailChange = useCallback((rail: DocumentRail) => state.setRail(rail), [state]);
  // P4-B1 (the P4 spec §4.3; settings version 15): View › Comments, per user, read from the settings and written through
  // them (the editor is portable and takes the value and the setter)
  const commentsView = useSettings((s) => s.state?.settings.artifacts.commentsView ?? 'expand');
  const onCommentsViewChange = useCallback((view: CommentsView) => void setCommentsView(view), []);
  const onPreviewChange = useCallback((previewing: boolean, shown: DocumentShown) => state.setPreviewing(previewing, shown), [state]); // P3-F (F7): shown
  const reveal = useOpenRequest(artifactId, scope.surface); // P4-B4
  // P4-B4 (the B3 merge's review): a place asked after a move's hand-off (a link, show_pane's at) is newer than the view
  // the move carried: the carried restore (its scheduled frame, its scroll held while the page settles) gives way to it
  const placed = reveal?.location !== undefined;
  useEffect(() => {
    if (!placed) return;
    carried.current = null;
    restoring.current?.();
    restoring.current = null;
  }, [placed, reveal]);

  if (snapshot.failed !== null) return <Notice>{`This document could not be opened: ${snapshot.failed}`}</Notice>;
  if (!snapshot.ready || !snapshot.handle) return <Notice>Opening the document…</Notice>;
  if (snapshot.noContent) return <Notice>This document has no content yet: it was created before MAWS gave every new document its first page.</Notice>;
  return (
    <SystemScope placement={snapshot.placement} handle={snapshot.handle}>
      <DocumentEditor
        artifactId={artifactId}
        handle={snapshot.handle}
        host={state.host}
        comments={target === null ? undefined : comments /* P3-F1 */}
        history={state.history}
        versionExports={(versionId) => documentExports({ versionId }, snapshot.exporting?.phase === 'running', (format, pageSize) => void state.export(format, pageSize, versionId))}
        suggestions={state.host}
        rail={snapshot.rail}
        onRailChange={onRailChange}
        commentsView={commentsView} /* P4-B1 */
        onCommentsViewChange={onCommentsViewChange} /* P4-B1 */
        saveVersionRequest={snapshot.saveVersionRequest}
        pageScope={SystemPage}
        onPage={onPage}
        onPreviewChange={onPreviewChange}
        onEditor={setEditor}
        mentions={state.mentions}
        renderChart={renderChart} /* P3-E */
        onDisplayedDocument={onDisplayedDocument}
        blockCommentQuote={blockCommentQuote}
        reveal={reveal} /* P4-B4 */
        onRevealed={takeOpenRequest}
      />
    </SystemScope>
  );
}

// The governing system and the document's overrides, for the page's scope (SystemPage); nothing while D's apply API is
// not provided.
function SystemScope({ placement, handle, children }: { placement: { designSystemId?: string; spaceId?: string }; handle: NonNullable<ReturnType<DocumentTabState['snapshot']>['handle']>; children: ReactNode }) {
  const overrides = useDocumentOverrides(handle.doc);
  const system = documentDesignSystem();
  const governing = useSystemFor(placement); // P3-D: a hook (D's follows the defaults, the house and the live systems)
  const value = useMemo(() => (system && governing ? { system, governing, overrides } : null), [system, governing, overrides]); // P3-D: `governing`
  return <PageSystemProvider value={value}>{children}</PageSystemProvider>;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex h-full items-center justify-center p-6 text-center text-ui text-fg-muted">
      {children}
    </div>
  );
}
