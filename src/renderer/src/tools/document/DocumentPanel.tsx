// The document editor in the panel's Artifacts tool (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D13),
// and the body it shares with the `artifact` main tab (DocumentMain): `DocumentEditor` over the tab's replica (the
// state L's registry made for this tab), the X32 header registered under the scope the surface gives, the page
// registered as a Mark-up surface, comments going to the session the main area shows, the history rail on A's IPC,
// the page in the governing design system's scope when D's is provided, `onShown` once the document is on screen.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DocumentEditor, type DocumentRail } from '@artifacts/document/editor/DocumentEditor';
import type { Editor } from '@tiptap/core';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactKind } from '@shared/artifacts/entity'; // P3-E
import type { Doc } from '@artifacts/yjs'; // P3-E
import type { ViewEnvironment } from '@artifacts/document/editor/nodes/views'; // P3-E
import type { EditorHostAction } from '../../panel/editor-host'; // P3-E
import type { ArtifactEditorProps } from '../../artifacts/registry';
import { useRegionMarkupSurface } from '../../markup/surface';
import { useEditorHost } from '../../panel/editor-host';
import { shownSession } from '../../panel/host';
import { useLayout } from '../../stores/layout';
import { useDocumentComments } from './comments';
import { documentDesignSystem, PageSystemProvider, SystemPage, useDocumentOverrides, useSystemFor } from './design-system'; // P3-D: useSystemFor
import { documentHeader, type DocumentHeaderCommands } from './header';
import type { DocumentTabState } from './tab-state';

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
}
// P3-E end

export function DocumentPanel(props: DocumentEditorProps & DocumentShellAdditions /* P3-E */) {
  return <DocumentBody {...props} surface="panel" />;
}

const NO_SESSION = '' as AppSessionId;

export function DocumentBody({ artifactId, state, scope, visible, onShown, surface, renderChart, artifactKind, additionalActions, onDisplayedDocument /* P3-E */ }: DocumentEditorProps & DocumentShellAdditions & { surface: 'panel' | 'main' }) {
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
    { title, document: snapshot.document, saving: snapshot.saving, previewing: snapshot.previewing, unresolved: snapshot.unresolved, rail: snapshot.rail, history: true, suggestions: snapshot.suggestions, exporting: snapshot.exporting },
    commands,
  );
  useEditorHost(scope, additionalActions?.length ? { ...header, actions: [...(header.actions ?? []), ...additionalActions] } : header); // P3-E: a dashboard's actions after B's

  // Comments go to the session the main area shows (its Side thread, or its conversation); none shown, none offered.
  const appSessionId = useLayout((s) => shownSession(s.main));
  const comments = useDocumentComments({ artifactId, appSessionId: appSessionId ?? NO_SESSION, title, mode: surface === 'main' ? 'tab' : 'panel', visible, holdReplica: state.hold, ...(artifactKind !== undefined && { artifactKind }) /* P3-E */ });

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
  const [drawn, setDrawn] = useState(false);
  const onEditor = useCallback((editor: Editor | null) => setDrawn(editor !== null), []);
  useEffect(() => {
    if (!visible || !drawn || state.shown()) return;
    const frame = requestAnimationFrame(() => {
      if (state.markShown()) onShown();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, drawn, state, onShown]);
  const onRailChange = useCallback((rail: DocumentRail) => state.setRail(rail), [state]);
  const onPreviewChange = useCallback((previewing: boolean) => state.setPreviewing(previewing), [state]);

  if (snapshot.failed !== null) return <Notice>{`This document could not be opened: ${snapshot.failed}`}</Notice>;
  if (!snapshot.ready || !snapshot.handle) return <Notice>Opening the document…</Notice>;
  if (snapshot.noContent) return <Notice>This document has no content yet: it was created before MAWS gave every new document its first page.</Notice>;
  return (
    <SystemScope placement={snapshot.placement} handle={snapshot.handle}>
      <DocumentEditor
        artifactId={artifactId}
        handle={snapshot.handle}
        host={state.host}
        comments={appSessionId === null ? undefined : comments}
        history={state.history}
        suggestions={state.host}
        rail={snapshot.rail}
        onRailChange={onRailChange}
        saveVersionRequest={snapshot.saveVersionRequest}
        pageScope={SystemPage}
        onPage={onPage}
        onPreviewChange={onPreviewChange}
        onEditor={onEditor}
        mentions={state.mentions}
        renderChart={renderChart} /* P3-E */
        onDisplayedDocument={onDisplayedDocument}
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
