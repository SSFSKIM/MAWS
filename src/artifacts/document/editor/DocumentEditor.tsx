// The document editor (D1's `editor/`, D3; M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the tab strip,
// the formatting toolbar, find, and the page, a Tiptap editor bound to the active tab's body of an open replica. The
// handle is opened and owned by the caller (the tab's store handle, M8), so this component only binds and draws. One
// editor per active tab: switching tabs mounts a fresh editor on the other body, its undo history its own.
//
// The page carries `.ds-doc` and reads only the design system's `--ds-*` tokens, each falling back to the app's (D3):
// until D's `<DesignSystemScope>` wraps it, the document is MAWS's own look following the app theme. The chrome around
// the page (tabs, toolbar, find, the comments rail) is the app's, in its tokens.
//
// Comments (M4, D9): Comment (the toolbar, Mod-Alt-M) writes the thread and the mark and hands the passage to the
// `comments` surface, which opens P2's card for it (the renderer's; passed in so this directory stays portable) and is
// drawn over the page with the editor's reach (locate a passage, record what was sent, discard what was not, resolve,
// reopen). The threads rail beside the page lists every tab's threads, the editor's active one selected; a click on a
// highlighted passage activates its thread and opens the rail on it.
//
// History (M5, D10): with a `history` api, the History action (and Mod-Alt-Shift-H) opens the version history rail in
// the same place; a version shown from it replaces the page's content in place, read-only (the editor's `editable`
// follows the preview, Decision Log 22), with the preview's bar in place of the toolbar and the version's pinned
// tokens on the page. "See N new changes", the "Restored from …" banner and Show editors (a right-click over a
// selection) come with it. M9 (the scale gate): the version is drawn by an editor of its own, read-only, bound to the
// version's doc from its creation, while the live editor stays bound to the tab, hidden: entering and leaving history
// never re-binds (and re-renders) the live tab, and leaving keeps its undo. Awareness (D11): the other replicas' cursors and an agent's editing blocks.
// P4-A2 (X35): the agent's batch drawn as it is written, the live editor's provisional layer (provisional.ts), its growth
// bumping the comment overlay's `layoutKey` once a frame.
// P3-F1: the rail beside the page in a body 720 px wide or more, a drawer over the page's right side below (rail-layout.ts).
// P4-B4 ("Opening at a place"): a reveal asked from outside (a link's fragment, `show_pane`'s `at`) selects the block's
// tab (or the tab named), puts the caret at the block's start and scrolls it into view once that tab's editor has bound
// (the thread-showing path's retry), and opens the history rail previewing a version named by its id; a place the
// document does not have changes nothing, as a plain open. Without a version, a preview shown gives way to the live page.
// P4-B1 (the P4 spec §4.3): the shown tab's open threads are cards in a margin beside the page (comments/MarginThreads.tsx,
// inside the page's scroll box), activated only by the human; the threads list is the All comments panel (`rail`
// 'comments'), mutually exclusive with the margin; `rail` 'margin' says a margin thread is active with no rail open
// (D5). The compose card (the surface's overlay) is hosted in the margin's stack while the margin draws, over the
// frame otherwise. View › Comments (Expand, Minimize, Hide) comes from the host (`commentsView`).
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model'; // P3-E
import { NodeSelection, Selection } from '@tiptap/pm/state'; // P4-B4
import type { ArtifactLocation } from '@shared/artifacts/link'; // P4-B4
import { EditorContent, useEditor } from '@tiptap/react';
import 'katex/dist/katex.min.css';
import { useCallback /* P4-B1 */, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { JointHold, TypingPause, type VersionView } from '../collab';
import { isBindingTransaction, type Carry, type Doc } from '../../yjs'; // P3-E: Doc
import { ySyncPluginKey } from '../../yjs/prosemirror';
import { coreExtensionOptions } from '../ids';
import { nanoid8 } from '../schema';
import { addTab, listTabs, tabBody, tabOfBlock, TAB_LIMIT_REFUSAL } from '../tabs'; // P4-B4: listTabs, tabOfBlock
import { discardThread, getThread, reopen, reply, resolve } from '../threads'; // P4-B1: isBlockAnchor moved to comments/locate.ts
import type { ExtraChange } from '../history'; // P3-E
import { activeThread, COMMENTS_ORIGIN, commentBlock /* P3-E */, commentSelection, liveRanges, type CommentsOptions /* P3-E */ } from './comments/plugins';
import type { CommentAuthor, CommentOverlayProps, DocumentComments } from './comments/surface';
import { blockPos, passageRect } from './comments/locate'; // P4-B1
import { MarginThreads, type PageMove } from './comments/MarginThreads'; // P4-B1
import type { ActivationCause } from './comments/plugins'; // P4-B1
import type { CommentsView } from '../../comments/view'; // P4-B1
import type { MarginTier } from '../../comments/margin-tiers'; // P4-B1
import { CommentsPanel } from './comments/CommentsPanel'; // P4-B1: the threads rail became the All comments panel
import { useOpenThreadCount } from './comments/use-threads';
import { editorExtensions } from './extensions';
import { FindBar } from './Find';
import type { HistoryApi } from './history/api';
import type { HistoryController, HistorySnapshot, PinnedScope, Preview } from './history/controller';
import { HistoryBar } from './history/HistoryBar';
import { HistoryRail, type VersionExports } from './history/HistoryRail';
import { goToChange, setCarried, setExtra /* P3-E */ } from './history/paint';
import { ShowEditorsMenu, useShowEditors } from './history/ShowEditors';
import { useHistoryController, useHistorySnapshot } from './history/use-history';
import { cssColor, type DocumentHandle, type EditorHost } from './host-types';
import { usePageGround } from './page-ground';
import { displayedDocument, type ViewEnvironment } from './nodes/views'; // P3-E: displayedDocument
import { Tabs } from './Tabs';
import { useTabs } from './tabs-store';
import type { MentionSource } from './MentionPicker';
import { Toolbar, type SectionControls } from './Toolbar';
import { DOCUMENT_LIMITS } from '@shared/maws/document-tools';
import { Suggestions, type SuggestionHost } from './Suggestions';
import { useReadOnly } from './read-only';
import { useRailLayout } from './rail-layout'; // P3-F1
import type { ProvisionalLayers } from '../../provisional'; // P4-A2 (X35)
import { useProvisionalLayers } from './provisional'; // P4-A2 (X35)
import './chrome.css';
import './theme.css';

export interface DocumentEditorProps {
  artifactId: string;
  handle: DocumentHandle;
  host: EditorHost;
  /** Draws a diagram; mermaid, loaded on first use, by default. */
  renderDiagram?: ViewEnvironment['renderDiagram'];
  /** Receives the active tab's editor, and null when it goes (the harness's and the tests' reach). */
  onEditor?: (editor: Editor | null) => void;
  /** Where a comment goes (P2's card); without it, commenting is not offered. */
  comments?: DocumentComments;
  /** The document's versions and history actions (M5); without it, version history is not offered. */
  history?: HistoryApi;
  /** The host's export formats for each retained version's history card. */
  versionExports?: VersionExports;
  /** The host service that opens and settles the artifact’s proposal replica (D14). */
  suggestions?: SuggestionHost;
  /**
   * The rail beside the page, when the caller holds it (M8: the X32 header toggles History and Comments from outside the
   * body, and the rail stays open across a remount); the editor's own toggles then ask through `onRailChange`. Without
   * it the editor holds its rail itself.
   */
  rail?: DocumentRail;
  onRailChange?(rail: DocumentRail): void;
  /** P4-B1 (the P4 spec §4.3): View › Comments, Expand, Minimize or Hide, when the host persists it; Expand without it. */
  commentsView?: CommentsView;
  onCommentsViewChange?(view: CommentsView): void;
  /** A new value opens the history rail on its Save version form (the header's Save version); the value at mount is not new. */
  saveVersionRequest?: number;
  /**
   * What the page is drawn in: the governing design system's scope (D's `<DesignSystemScope>`); the page alone without.
   * F (S-RESTYLE): while a version is shown, `pinned` is the system it pinned with its own overrides, to draw it in; the
   * scope alone draws them (the page declares a version's tokens itself only when it has no scope).
   */
  pageScope?: ComponentType<{ children: ReactNode; pinned?: PinnedScope }>;
  /** The page's element as it appears and goes (the shell's Mark-up surface). */
  onPage?(element: HTMLElement | null): void;
  /**
   * Whether a version is shown in place of the live document (the header says read-only meanwhile). P3-F (8.2, F7):
   * and what is shown, so the header's Export exports it.
   */
  onPreviewChange?(previewing: boolean, shown: DocumentShown): void;
  /** Who and what Insert › Mention can name (people, sessions, artifacts); without it, a mention names the owner. */
  mentions?: MentionSource;
  // P3-E start (E2 M3; E's Decision Log 19): a dashboard's charts drawn by E (absent: B's placeholder), and the document
  // the editor shows told as it changes: the live one, a previewed version's with its revision, the suggestion replica's
  renderChart?: ViewEnvironment['renderChart'];
  onDisplayedDocument?(doc: Doc, revision?: number): void;
  /** E2 M4 (E's Decision Log 28): the quote of a selected block commented whole (a dashboard's chart); absent, text only. */
  blockCommentQuote?(node: PMNode): string | undefined;
  // P3-E end
  /** P4-B4: a place to show, asked from outside the editor; each serial is handled once, then told to `onRevealed`. */
  reveal?: DocumentReveal | null;
  onRevealed?(serial: number): void;
}

/** P4-B4: a place in the document to show (a document's tab or block, a retained version by its id), a new serial per ask. */
export interface DocumentReveal {
  serial: number;
  location?: ArtifactLocation;
}

/** P4-B1: 'margin' says a margin thread is active with no rail open (D5): the header's Comments toggles the panel against it. */
export type DocumentRail = 'comments' | 'history' | 'margin' | null;
/**
 * P3-F (8.2, F7; the deck's DeckShown, L233): what the editor shows, for an export of it: one retained version its
 * history previews, two versions compared, or (null) the live document, its changes since the last view and a
 * suggestion review included.
 */
export type DocumentShown = { versionId: number } | 'compare' | null;
type Rail = DocumentRail;
const NO_CARRIES: ReadonlyMap<string, Carry['kind']> = new Map();
const NO_EXTRAS: readonly ExtraChange[] = []; // P3-E

// P3-F1: the input types the owner types text into (an unknown type reads as 'text')
const TEXT_ENTRY_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);
// P3-F1: a text-entry control (a text field, a text area, an editable region) with text in it
function holdsTypedText(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return element.value !== '';
  if (element instanceof HTMLInputElement) return TEXT_ENTRY_TYPES.has(element.type) && element.value !== '';
  return element instanceof HTMLElement && element.isContentEditable && (element.textContent ?? '') !== '';
}

/** A request to show a thread's passage: a new serial for each ask, so asking twice shows twice. */
interface Showing {
  threadId: string;
  serial: number;
}
/** P4-B4: a block to put the caret at, in the tab that holds it, once its editor has bound. */
interface Revealing {
  blockId: string;
  serial: number;
}

const NO_DRAFTS: ReadonlyMap<string, string> = new Map(); // P4-B1

export function DocumentEditor(props: DocumentEditorProps) {
  const { doc } = props.handle;
  const tabs = useTabs(doc);
  const readOnly = useReadOnly(props.handle); // a store a newer MAWS wrote: nothing here writes the document
  const [selected, setSelected] = useState<string | null>(null);
  const [ownRail, setOwnRail] = useState<Rail>(null);
  const held = props.rail !== undefined;
  const rail = held ? (props.rail ?? null) : ownRail;
  const [saving, setSaving] = useState(false);
  const [pendingSuggestions, setPendingSuggestions] = useState(false);
  const hold = useMemo(() => new JointHold(props.handle), [props.handle]); // the live editor's, the suggestion replica's too
  const typing = useMemo(() => new TypingPause(hold), [hold]); // the review waits for the person's pause
  const provisional = useProvisionalLayers(props.handle); // P4-A2 (X35): per handle, so a tab switch keeps the layers that stand
  const [showing, setShowing] = useState<Showing | null>(null);
  const [revealing, setRevealing] = useState<Revealing | null>(null); // P4-B4
  const endRevealing = useCallback(() => setRevealing(null), []); // P4-B4
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  // P4-B1: the margin draws unless the view hides it, the panel is open or a version shows; its tier (off under a
  // 720 px body) is the margin's own reading, told back here
  const commentsView = props.commentsView ?? 'expand';
  const [marginTier, setMarginTier] = useState<MarginTier['kind']>('off');
  const active = tabs.find((tab) => tab.id === selected) ?? tabs[0] ?? null;
  const shownEditor = useRef<Editor | null>(null);
  const focusAfterBind = useRef(false);
  const bindEditor = useCallback((editor: Editor | null) => {
    shownEditor.current = editor;
    props.onEditor?.(editor);
    if (editor && focusAfterBind.current) {
      focusAfterBind.current = false;
      // The collaboration binding initializes after this callback. Focus only once the current page is ready.
      requestAnimationFrame(() => {
        if (shownEditor.current === editor && !editor.isDestroyed) editor.view.focus();
      });
    }
  }, [props.onEditor]);
  const selectSection = (id: string, focusPage = false) => {
    if (focusPage && id === active?.id && shownEditor.current) shownEditor.current.view.focus();
    else if (focusPage) focusAfterBind.current = true;
    setSelected(id);
  };
  const newSection: SectionControls = {
    disabled: readOnly || tabs.length >= DOCUMENT_LIMITS.tabs,
    reason: tabs.length >= DOCUMENT_LIMITS.tabs ? TAB_LIMIT_REFUSAL : undefined,
    add: () => {
      const current = listTabs(doc);
      if (props.handle.state().readOnly || current.length >= DOCUMENT_LIMITS.tabs) return;
      setSelected(addTab(doc, { title: `Tab ${current.length + 1}`, ...(active ? { after: active.id } : {}) }));
    },
  };
  const { host } = props;
  const author = useMemo<CommentAuthor>(() => ({ actor: host.identity().actor, now: () => Date.now() }), [host]);
  // P4-B1 (X36's draft rule: a hidden card keeps its draft, one draft per thread): the threads' reply drafts, the
  // document's, held here so the margin and the panel draw the same one and neither unmounting loses it
  const [replyDrafts, setReplyDrafts] = useState(() => ({ doc, drafts: NO_DRAFTS }));
  const drafts = replyDrafts.doc === doc ? replyDrafts.drafts : NO_DRAFTS;
  const onDraftChange = useCallback(
    (threadId: string, text: string) =>
      setReplyDrafts((now) => {
        const current = now.doc === doc ? now.drafts : NO_DRAFTS;
        if ((current.get(threadId) ?? '') === text) return now;
        const next = new Map(current);
        if (text === '') next.delete(threadId);
        else next.set(threadId, text);
        return { doc, drafts: next };
      }),
    [doc],
  );
  const history = useHistoryController(props.handle, props.history);
  const snapshot = useHistorySnapshot(history);
  const preview = snapshot?.preview ?? null;
  useEffect(() => history?.setLiveTab(active?.id ?? null), [history, active?.id]);
  // Leaving the history rail leaves history: the page shows the live document again (whoever closed the rail).
  const { onRailChange, saveVersionRequest, onPreviewChange } = props;
  const previewing = preview !== null || pendingSuggestions;
  const shownVersionId = preview?.target.kind === 'version' ? preview.target.versionId : null; // P3-F (F7)
  const comparing = preview?.target.kind === 'compare'; // P3-F (F7)
  useEffect(() => {
    onPreviewChange?.(previewing, comparing ? 'compare' : shownVersionId !== null ? { versionId: shownVersionId } : null); // P3-F (F7): what is shown
  }, [previewing, comparing, shownVersionId, onPreviewChange]);
  // P3-E start (E2 M3): the document shown, told as it changes (a preview with no tab to show tells nothing new)
  const [suggestionDoc, setSuggestionDoc] = useState<Doc | null>(null);
  const shownVersion = previewRevision(preview, snapshot?.versions ?? null);
  const shownDoc = preview ? (preview.view?.ytype.doc ?? null) : pendingSuggestions && suggestionDoc ? suggestionDoc : doc;
  const { onDisplayedDocument } = props;
  const shownRevision = preview ? shownVersion : undefined;
  useEffect(() => {
    if (shownDoc) onDisplayedDocument?.(shownDoc, shownRevision);
  }, [shownDoc, shownRevision, onDisplayedDocument]);
  // P3-E end
  const openRail = (next: Rail) => {
    if (!held) setOwnRail(next);
    onRailChange?.(next);
  };
  // P4-B1 (D5): a margin thread active with no rail open is the rail state 'margin' (so the panel and history are one
  // slot with it); the active thread clearing takes it back to none
  const marginOn = commentsView !== 'hide' && rail !== 'comments' && !previewing;
  const marginHosts = marginOn && marginTier !== 'off';
  useEffect(() => {
    if (activeThreadId !== null && rail === null && marginHosts) openRail('margin');
    else if (activeThreadId === null && rail === 'margin') openRail(null);
    // openRail is a plain closure over the props, read at the effect's run
  }, [activeThreadId, rail, marginHosts]);
  useEffect(() => {
    if (rail !== 'history') {
      history?.close();
      setSaving(false);
    }
  }, [rail, history]);
  // Save version asked from outside: the history rail on its form. A request already made when the editor mounted is
  // not new (the body remounts on a tab switch).
  const seenSaveRequest = useRef(saveVersionRequest);
  useEffect(() => {
    if (saveVersionRequest === seenSaveRequest.current) return;
    seenSaveRequest.current = saveVersionRequest;
    if (!history) return;
    setSaving(true);
    if (!held) setOwnRail('history');
    onRailChange?.('history');
  }, [saveVersionRequest, history, held, onRailChange]);
  // P4-B4: a reveal asked from outside, handled once its serial is new and the document has its tabs. A block names its
  // own tab; a version is previewed only once the history says the document retains it.
  const { reveal, onRevealed } = props;
  const revealed = useRef<number | null>(null);
  const hasTabs = tabs.length > 0;
  // whether the editor is still mounted when a version's check answers (the reveal itself is gone by then: it was taken)
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!reveal || !hasTabs || revealed.current === reveal.serial) return;
    revealed.current = reveal.serial;
    onRevealed?.(reveal.serial);
    const { tab, block, version } = reveal.location ?? {};
    const blockTab = block === undefined ? null : tabOfBlock(doc, block);
    const tabId = blockTab ?? (tab !== undefined && listTabs(doc).some((t) => t.id === tab) ? tab : null);
    if (tabId !== null) setSelected(tabId);
    if (blockTab !== null) setRevealing({ blockId: block!, serial: reveal.serial });
    if (version === undefined || !history) {
      if (tabId !== null) history?.close(); // a place in the live document: the live page shows
      return;
    }
    const asked = reveal.serial;
    void history.hasVersion(version).then(
      (retained) => {
        if (!retained || !mounted.current || revealed.current !== asked) return; // gone, or a later reveal took over
        if (!held) setOwnRail('history');
        onRailChange?.('history');
        void history.select(version);
      },
      () => {}, // the list unread: a plain open
    );
  }, [reveal, onRevealed, hasTabs, doc, history, held, onRailChange]);
  // P3-F1: the rail beside the page in a wide body, a drawer over the page's right side in a narrow one (rail-layout.ts)
  const body = useRef<HTMLDivElement>(null);
  const railShown = rail === 'comments' || (rail === 'history' && Boolean(history && snapshot));
  const railLayout = useRailLayout(body, railShown);
  const drawer = railShown && railLayout.mode === 'drawer';
  // Escape inside the drawer closes it, and the keyboard goes back to the page; one the rail's own control took is its
  // own, and one in a text field holding text (a reply or a version name being written) is the field's, so the draft is
  // not lost. A checkbox, a radio or a button holds no draft, whatever its value.
  const focusShownPage = () => {
    const pages = body.current?.querySelectorAll<HTMLElement>('.doc-page-frame .ProseMirror') ?? [];
    [...pages].find((page) => page.checkVisibility())?.focus({ preventScroll: true }); // the page shown (the live one, a review's)
  };
  // F (L241): History closing ends its preview, and the preview's page with the focus in it; the page shown once the
  // preview has gone takes the keyboard instead
  const focusAfterPreview = useRef(false);
  useEffect(() => {
    if (preview || !focusAfterPreview.current) return;
    focusAfterPreview.current = false;
    focusShownPage();
  }, [preview]);
  const onBodyKeyDown = (event: KeyboardEvent) => {
    const { target } = event;
    if (!drawer || event.key !== 'Escape' || event.defaultPrevented || !(target instanceof Element) || !target.closest('.doc-rail')) return;
    if (holdsTypedText(target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (rail === 'history' && preview) focusAfterPreview.current = true; // F (L241)
    else focusShownPage();
    openRail(null);
  };
  return (
    <div className="doc-editor" data-document-editor="">
      {!preview && tabs.length > 1 && <Tabs doc={doc} tabs={tabs} active={active?.id ?? null} readOnly={readOnly} onSelect={selectSection} />}
      {snapshot?.banner && (
        <div className="doc-banner" role="status" aria-label="Restored">
          <span>{snapshot.banner}</span>
          <button type="button" className="doc-tool" onClick={() => history?.dismissBanner()}>
            Dismiss
          </button>
        </div>
      )}
      <div ref={body} className="doc-editor-body" data-rail-layout={railShown ? railLayout.mode : undefined} style={railShown ? ({ '--doc-drawer-top': `${railLayout.top}px` } as CSSProperties) : undefined} onKeyDown={onBodyKeyDown}>
        {active && props.suggestions && (
          <div className="doc-tab-editor" style={{ display: preview ? 'none' : pendingSuggestions ? undefined : 'contents' }}>
            <Suggestions artifactId={props.artifactId} tabId={active.id} base={props.handle} hold={hold} typing={typing} host={props.suggestions} editorHost={props.host} onPending={setPendingSuggestions} pageScope={props.pageScope} renderChart={props.renderChart} onDisplayedDocument={setSuggestionDoc} /* P3-E */ />
          </div>
        )}
        <div className="doc-tab-editor" style={{ display: pendingSuggestions && !preview ? 'none' : undefined }} onKeyDown={() => typing.keystroke()}>
          {active ? (
            <TabEditor
              {...props}
              key={active.id}
              onEditor={bindEditor}
              tabId={active.id}
              newSection={newSection}
              tabTitle={tabs.length === 1 ? '' : active.title} // P4-B1 (tracker L275): one tab names no tab in a comment's label
              author={author}
              rail={rail}
              openRail={openRail}
              showing={showing}
              onShown={() => setShowing(null)}
              revealing={revealing}
              onRevealed={endRevealing}
              onActiveThread={setActiveThreadId}
              onPassageClick={(cause) => {
                // P4-B1: with the margin drawing, an activation is the margin's (D5 reports it above); without it (a
                // narrow body, Hide), a click or a chord opens the list, the caret never
                if (preview || marginHosts) return;
                if (cause !== 'caret') openRail('comments');
              }}
              marginView={marginOn ? commentsView : null}
              drafts={drafts} // P4-B1
              onDraftChange={onDraftChange} // P4-B1
              onMarginTier={setMarginTier}
              historyController={history}
              historySnapshot={snapshot}
              hold={hold}
              provisional={provisional}
              readOnly={readOnly}
              previewRevision={shownVersion} /* P3-E */
            />
          ) : (
            <div className="doc-editor-loading" role="status">
              Loading…
            </div>
          )}
        </div>
        {rail === 'comments' && (
          <CommentsPanel // P4-B1
            doc={doc}
            tabs={tabs}
            activeTab={active?.id ?? null}
            activeThread={activeThreadId}
            author={author}
            readOnly={readOnly}
            drafts={drafts} // P4-B1
            onDraftChange={onDraftChange} // P4-B1
            onShow={(thread) => {
              if (tabs.some((tab) => tab.id === thread.tabId)) setSelected(thread.tabId);
              setShowing({ threadId: thread.id, serial: (showing?.serial ?? 0) + 1 });
              // P4-B1 (the activation table): where the margin would host, the item chosen closes the panel and the
              // margin returns with that thread active (the shown thread's activation reports 'margin', D5); the drawer
              // stays open as before, and so does the panel for an orphan, which the margin cannot draw (Z3). The margin
              // is not drawn while the panel is, so the panel's own layout says whether it would host (the same 720 px)
              if (!thread.orphan && commentsView !== 'hide' && railLayout.mode === 'beside') openRail(null);
            }}
            onClose={() => openRail(null)}
          />
        )}
        {rail === 'history' && history && snapshot && (
          <HistoryRail controller={history} snapshot={snapshot} versionExports={props.versionExports} sessionTitle={props.history?.sessionTitle?.bind(props.history)} saving={saving} onSaving={setSaving} onClose={() => openRail(null)} />
        )}
      </div>
    </div>
  );
}

interface TabEditorProps extends DocumentEditorProps {
  tabId: string;
  tabTitle: string;
  newSection: SectionControls;
  author: CommentAuthor;
  rail: Rail;
  openRail(rail: Rail): void;
  historyController: HistoryController | null;
  historySnapshot: HistorySnapshot | null;
  /** The composition hold: the base replica's, and the suggestion replica's beside it. */
  hold: JointHold;
  /** P4-A2 (X35): the agent's streaming edits over this handle, drawn by the live editor. */
  provisional: ProvisionalLayers;
  /** The store is read-only: the page is not editable. */
  readOnly: boolean;
  showing: Showing | null;
  onShown(): void;
  /** P4-B4: a block to put the caret at once this tab's editor holds it; `onRevealed` once it is there. */
  revealing: Revealing | null;
  onRevealed(): void;
  /** The editor's active thread, as it changes (the rail selects it). */
  onActiveThread(threadId: string | null): void;
  /** A click, the caret or a chord activated a passage's thread (P4-B1: with its cause). */
  onPassageClick(cause: ActivationCause): void;
  /** P4-B1: the margin's view while it draws (Expand or Minimize), null while it does not (Hide, the panel open, a preview). */
  marginView: Exclude<CommentsView, 'hide'> | null;
  onMarginTier(kind: MarginTier['kind']): void;
  /** P4-B1: the threads' reply drafts, the editor's (X36's draft rule). */
  drafts: ReadonlyMap<string, string>;
  onDraftChange(threadId: string, text: string): void;
  /** P3-E: the previewed version's revision, its charts' displayed one. */
  previewRevision?: number;
}

function TabEditor({ tabId, tabTitle, newSection, artifactId, handle, host, renderDiagram, onEditor, comments, author, rail, openRail, historyController, historySnapshot, hold, provisional, readOnly, showing, onShown, revealing, onRevealed /* P4-B4 */, onActiveThread, onPassageClick, marginView, onMarginTier, drafts, onDraftChange /* P4-B1 */, commentsView, onCommentsViewChange /* P4-B1 */, pageScope, onPage, mentions, renderChart, previewRevision: shownRevision, blockCommentQuote /* P3-E */ }: TabEditorProps) {
  const [findOpen, setFindOpen] = useState(false);
  const preview = historySnapshot?.preview ?? null;
  const openCount = useOpenThreadCount(handle.doc);
  // What Comment reads when it runs (a keystroke or a click after any render), kept current after each render.
  const latest = useRef({ comments, author, tabTitle, onPassageClick, blockCommentQuote /* P3-E */ });
  useLayoutEffect(() => {
    latest.current = { comments, author, tabTitle, onPassageClick, blockCommentQuote /* P3-E */ };
  });
  const commentRef = useRef<() => boolean>(() => false);
  // P4-B1: ⌃⌘ E then C enters the active thread's card: the margin fills this while it draws
  const enterRef = useRef<(threadId: string) => void>(() => {});
  // P4-A2 (X35): the layer's growth moves the passages the comment overlay places, so it bumps the page frame's
  // `layoutKey` through the frame's own `moved` (one bump per animation frame). The editor is built before the frame
  // mounts and outlives its renders, so the extension calls through this ref, which the frame fills while it shows.
  // P4-B1: `moved` also runs the margin's layout pass (`relayoutRef`) in that frame callback, so the cards follow the growth.
  const growRef = useRef<() => void>(detached);

  const editor = useEditor(
    {
      coreExtensionOptions,
      extensions: editorExtensions({
        collaboration: {
          ytype: tabBody(handle.doc, tabId) ?? null,
          awareness: handle.awareness,
          user: { name: host.identity().name, color: cssColor(host.identity().color) },
          hold,
          onRestored: (listener) => handle.onRestored(listener),
        },
        comments: { doc: handle.doc, tabId, onComment: () => commentRef.current(), onActivate: (_id, cause) => latest.current.onPassageClick(cause), onEnter: (id) => enterRef.current(id) /* P4-B1 */, blockQuote: (node) => latest.current.blockCommentQuote?.(node), artifactId /* P3-E */ },
        env: { artifactId, host, ...(renderDiagram ? { renderDiagram } : {}), ...(renderChart ? { renderChart, displayed: displayedDocument(handle.doc) } : {}) /* P3-E */ },
        provisional: { layers: provisional, onGrow: () => growRef.current() }, // P4-A2 (X35)
      }),
      editorProps: { attributes: { 'aria-label': 'Document', class: 'doc-content', 'data-editor': 'live' } },
      shouldRerenderOnTransaction: false,
      editable: !readOnly,
    },
    [tabId, handle, host, artifactId, hold, provisional],
  );
  // the store turning read-only (or writable again, after a reconnect) does not re-create the editor
  useEffect(() => {
    if (!editor.isDestroyed && editor.isEditable === readOnly) editor.setEditable(!readOnly);
  }, [editor, readOnly]);
  // the preview's own editor while a version shows (null until it exists); the live one is never put on a version
  const [previewEditor, setPreviewEditor] = useState<Editor | null>(null);
  const shown = preview && previewEditor ? previewEditor : editor;
  // the editor showed something else: every other preview's docs can go, once a closed preview's editor is gone too
  useEffect(() => {
    if (preview) return;
    const timer = setTimeout(() => historyController?.applied(null), PREVIEW_GONE_MS);
    return () => clearTimeout(timer);
  }, [preview, historyController]);

  // Comment the selection: the thread and the mark, the passage drawn active, then the surface opens its card.
  useLayoutEffect(() => {
    commentRef.current = () => {
      const { comments: surface, author: by, tabTitle: title } = latest.current;
      if (!surface || editor.isDestroyed || !editor.isEditable) return false;
      // P4-B1 (C7, X36's one draft per artifact): a comment being written takes the new one's place
      const draft = surface.draft?.();
      if (draft) {
        editor.commands.setActiveThread(draft);
        surface.focusDraft?.();
        return true;
      }
      const threadId = nanoid8();
      const comment = { threadId, tabId, by: by.actor, at: by.now() };
      // P3-E: a selected block the comments' `blockQuote` names is commented whole; otherwise B's passage
      const { blockQuote } = (editor.extensionManager.extensions.find((extension) => extension.name === 'comments')?.options ?? {}) as Partial<CommentsOptions>;
      const made = (blockQuote && commentBlock(editor, handle.doc, comment, blockQuote)) || commentSelection(editor, handle.doc, comment);
      if (!made) return false;
      editor.commands.setActiveThread(threadId);
      surface.opened({ threadId, tabId, tabTitle: title, quote: made.quote });
      return true;
    };
  }, [editor, handle, tabId]);

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  // The active thread (a card's, a shown one's, a clicked passage's) as the rail selects it.
  useEffect(() => {
    const report = () => onActiveThread(activeThread(editor.state));
    report();
    editor.on('transaction', report);
    return () => {
      editor.off('transaction', report);
    };
  }, [editor, onActiveThread]);

  // Show a thread the rail asked for, once its passage is in this tab's editor (a switched tab binds a moment later).
  useEffect(() => {
    if (!showing) return;
    const show = () => {
      const range = liveRanges(editor.state.doc).get(showing.threadId)?.[0];
      // P3-E: a block thread's block, selected whole
      const block = range ? -1 : blockPos(editor, handle.doc, showing.threadId);
      if (!range && block < 0) return false;
      (range ? editor.chain().setTextSelection(range) : editor.chain().setNodeSelection(block)).setActiveThread(showing.threadId).scrollIntoView().run();
      onShown();
      return true;
    };
    if (show()) return;
    const retry = () => {
      if (show()) editor.off('transaction', retry);
    };
    editor.on('transaction', retry);
    return () => {
      editor.off('transaction', retry);
    };
  }, [showing, editor, onShown, handle]);

  // P4-B4: put the caret at a revealed block's start and scroll it into view, once it is in this tab's editor (a switched
  // tab binds a moment later). The keyboard stays where it was: a reveal the agent asked must not take it from the owner.
  // So the block's own DOM is scrolled to: ProseMirror scrolls a transaction's selection only when the DOM selection is
  // in the editor, which needs its focus (prosemirror-view's `editorOwnsSelection`).
  useEffect(() => {
    if (!revealing) return;
    // the block's position and its start (a leaf block selected whole), or null while this editor does not hold it
    const startOf = (): { pos: number; selection: Selection } | null => {
      const { doc } = editor.state;
      let at = -1;
      doc.descendants((node, pos) => {
        if (at >= 0) return false;
        if (node.attrs.id === revealing.blockId) at = pos;
        return at < 0;
      });
      if (at < 0) return null;
      return { pos: at, selection: doc.nodeAt(at)!.isLeaf ? NodeSelection.create(doc, at) : Selection.near(doc.resolve(at + 1)) };
    };
    const reveal = ({ pos, selection }: { pos: number; selection: Selection }) => {
      editor.view.dispatch(editor.state.tr.setSelection(selection));
      const block = editor.view.nodeDOM(pos);
      if (block instanceof Element) block.scrollIntoView({ block: 'center' });
      onRevealed();
    };
    const now = startOf();
    if (now) return reveal(now);
    const retry = () => {
      const found = startOf();
      if (!found) return;
      editor.off('transaction', retry); // before the reveal's own transaction
      reveal(found);
    };
    editor.on('transaction', retry);
    return () => {
      editor.off('transaction', retry);
    };
  }, [revealing, editor, onRevealed]);

  const toggleHistory = () => openRail(rail === 'history' ? null : 'history');
  // P3-F: Find (Mod-F, the toolbar's) opens the bar, its field taking the keyboard as it mounts; with the bar open, the
  // field takes it again, the query selected
  const findField = useRef<HTMLInputElement>(null);
  const openFind = () => {
    setFindOpen(true);
    findField.current?.focus();
    findField.current?.select();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      openFind();
    } else if (mod && event.altKey && event.shiftKey && event.code === 'KeyH' && historyController) {
      event.preventDefault(); // Google Docs' chord for version history
      toggleHistory();
    }
  };

  return (
    <div className="doc-tab-editor" data-comments-view={commentsView /* P4-B1: Hide draws the passages plain (chrome.css) */} onKeyDown={onKeyDown}>
      {preview?.view && (
        <PreviewEditor
          view={preview.view}
          carried={preview.carried ?? NO_CARRIES}
          focus={preview.focus}
          handle={handle}
          tabId={tabId}
          artifactId={artifactId}
          host={host}
          renderDiagram={renderDiagram}
          controller={historyController}
          onEditor={setPreviewEditor}
          renderChart={renderChart} /* P3-E */
          revision={shownRevision}
          extras={preview.extras}
        />
      )}
      {preview && historyController ? (
        <HistoryBar editor={shown} preview={preview} controller={historyController} onBack={() => historyController.close()} />
      ) : (
        <Toolbar
          highlightScope={pageScope}
          editor={editor}
          artifactId={artifactId}
          host={host}
          onFind={openFind}
          comments={{ comment: comments ? () => commentRef.current() : null, railOpen: rail === 'comments', openCount, toggleRail: () => openRail(rail === 'comments' ? null : 'comments'), ...(onCommentsViewChange && { view: { value: commentsView ?? 'expand', set: onCommentsViewChange } }) /* P4-B1 */ }}
          history={historyController ? { open: rail === 'history', toggle: toggleHistory } : undefined}
          mentions={mentions}
          newSection={newSection}
        />
      )}
      {findOpen && <FindBar ref={findField} editor={shown} onClose={() => setFindOpen(false)} />}
      <PageFrame
        editor={shown}
        live={editor}
        previewEditor={preview ? previewEditor : null}
        handle={handle}
        author={author}
        comments={comments}
        tabId={tabId}
        preview={preview}
        history={historyController}
        pill={preview ? null : (historySnapshot?.pill ?? null)}
        pageScope={pageScope}
        onPage={onPage}
        marginView={marginView}
        onMarginTier={onMarginTier}
        drafts={drafts} // P4-B1
        onDraftChange={onDraftChange} // P4-B1
        readOnly={readOnly}
        onComment={comments ? () => commentRef.current() : null}
        enterRef={enterRef}
        growRef={growRef} // P4-A2
        onNewChanges={() => {
          openRail('history');
          void historyController?.openNewChanges();
        }}
      />
    </div>
  );
}

// The page's scroll box and, over it, the comment surface's overlay with the editor's reach. The overlay re-renders at
// most once a frame as the passages move (an edit, a scroll, a resize); the page does not. P4-B1: while the margin hosts
// the comments, that frame callback tells the margin what moved and renders nothing (a resize re-lays it in that frame,
// edits alone owe it a pass once they pause).
interface PageFrameProps {
  /** The editor on screen: the preview's while a version shows, else the live one. */
  editor: Editor;
  live: Editor;
  previewEditor: Editor | null;
  handle: DocumentHandle;
  author: CommentAuthor;
  comments: DocumentComments | undefined;
  tabId: string;
  preview: Preview | null;
  history: HistoryController | null;
  pill: HistorySnapshot['pill'];
  pageScope: DocumentEditorProps['pageScope'];
  onPage: DocumentEditorProps['onPage'];
  // P4-B1: the margin beside the page while it draws (MarginThreads), the tier it reads told back, the Comment command
  // for its Add button, and the chord's enter filled by it
  marginView: Exclude<CommentsView, 'hide'> | null;
  onMarginTier(kind: MarginTier['kind']): void;
  /** P4-B1: the threads' reply drafts, the editor's (X36's draft rule). */
  drafts: ReadonlyMap<string, string>;
  onDraftChange(threadId: string, text: string): void;
  readOnly: boolean;
  onComment: (() => boolean) | null;
  enterRef: { current: (threadId: string) => void };
  /** P4-A2 (X35): filled with `moved` while the overlay or the margin is drawn, for the provisional layer's growth. */
  growRef: { current: () => void };
  onNewChanges(): void;
}

function PageFrame({ editor, live, previewEditor, handle, author, comments, tabId, preview, history, pill, pageScope: Scope, onPage, marginView, onMarginTier, drafts, onDraftChange /* P4-B1 */, readOnly, onComment, enterRef, growRef /* P4-A2 */, onNewChanges }: PageFrameProps) {
  const editors = useShowEditors(live, history, tabId, preview === null);
  const frame = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(0);
  const pending = useRef<number | null>(null);
  // P4-B1: the margin (MarginThreads fills it) is told in the frame callback what moved the passages: the frame's size
  // (a pass at once) or edits alone (a pass owed until they pause, the follow-up wave); the frame-level overlay's key is
  // bumped only while that overlay is drawn
  const relayoutRef = useRef<(move: PageMove) => void>(() => {});
  const resizedSince = useRef(false); // P4-B1: the frame resized since the last callback
  const overlayDrawn = useRef(false);
  // P4-B1: the frame callbacks run, written on the page (`data-frames`, no render) beside the margin's `data-relayouts`,
  // so the scale gate reads the margin's passes per frame (D13: at most one); an agent's edit and the layer's growth
  // run callbacks of their own, not only the owner's keystrokes
  const page = useRef<HTMLDivElement>(null);
  const frames = useRef(0);
  const moved = useMemo(
    () => () => {
      if (pending.current !== null) return;
      pending.current = requestAnimationFrame(() => {
        pending.current = null;
        frames.current += 1; // P4-B1
        page.current?.setAttribute('data-frames', String(frames.current)); // P4-B1
        const move: PageMove = resizedSince.current ? 'resize' : 'edit'; // P4-B1
        resizedSince.current = false;
        relayoutRef.current(move); // P4-B1
        if (overlayDrawn.current) setLayout((n) => n + 1); // P4-B1: only while the frame-level overlay is drawn
      });
    },
    [],
  );
  // P4-B1: the frame's own resize (the window, the panel): the human's, so the margin re-lays in that frame
  const resized = useMemo(
    () => () => {
      resizedSince.current = true;
      moved();
    },
    [moved],
  );
  // P4-B1: a scroll moves the passages under the frame-level overlay alone (the margin scrolls with the page and never
  // re-lays on it, R4), so it has a key of its own, coalesced the same way
  const [scroll, setScroll] = useState(0);
  const scrollPending = useRef<number | null>(null);
  const scrolled = useMemo(
    () => () => {
      if (scrollPending.current !== null) return;
      scrollPending.current = requestAnimationFrame(() => {
        scrollPending.current = null;
        setScroll((n) => n + 1);
      });
    },
    [],
  );
  useEffect(
    () => () => {
      if (scrollPending.current !== null) cancelAnimationFrame(scrollPending.current);
    },
    [],
  );
  // P4-B1: the thread the surface's compose card is on (its entry in the margin's stack), and the tier the margin reads
  const [hosting, setHosting] = useState<string | null>(null);
  const [tier, setTier] = useState<MarginTier>({ kind: 'off' });
  const onTier = useCallback(
    (next: MarginTier) => {
      setTier(next);
      onMarginTier(next.kind);
    },
    [onMarginTier],
  );
  const margin = marginView !== null && previewEditor === null;
  const marginHosts = margin && tier.kind !== 'off';
  overlayDrawn.current = Boolean(comments) && !marginHosts; // P4-B1
  useEffect(() => {
    if (!comments && !margin) return; // P4-B1: && !margin (the margin follows edits with or without a surface)
    editor.on('update', moved);
    const box = frame.current;
    const observer = typeof ResizeObserver === 'undefined' || !box ? null : new ResizeObserver(resized); // P4-B1: resized
    if (box) observer?.observe(box);
    return () => {
      editor.off('update', moved);
      observer?.disconnect();
      if (pending.current !== null) cancelAnimationFrame(pending.current);
      pending.current = null;
    };
  }, [editor, comments, margin /* P4-B1 */, moved, resized]);
  // P4-A2 (X35): the provisional layer grows the page without an editor update; with neither the overlay nor the margin
  // (P4-B1: its layout pass runs in `moved`'s frame callback) nothing reads the layout
  useLayoutEffect(() => {
    if (!comments && !margin) return;
    growRef.current = moved;
    return () => {
      growRef.current = detached;
    };
  }, [growRef, comments, margin /* P4-B1 */, moved]);

  const reach = useMemo<Omit<CommentOverlayProps, 'layoutKey' | 'placement'>>(() => {
    const { doc } = handle;
    // read when the overlay writes, not when it was drawn: the store may have turned read-only since
    const writable = () => !handle.state().readOnly;
    return {
      doc,
      locate: (threadId) => passageRect(editor, frame.current, threadId, doc /* P3-E */),
      hosting: setHosting, // P4-B1
      setActive: (threadId) => void (!editor.isDestroyed && editor.commands.setActiveThread(threadId)),
      resolve: (threadId) => {
        if (writable() && getThread(doc, threadId)) resolve(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN);
      },
      reopen: (threadId) => {
        if (writable() && getThread(doc, threadId)) reopen(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN);
      },
      record: (threadId, body) => {
        if (writable() && getThread(doc, threadId)) reply(doc, threadId, { id: `${threadId}:${nanoid8()}`, by: author.actor, at: author.now(), body }, COMMENTS_ORIGIN);
      },
      discard: (threadId) => void (writable() && discardThread(doc, threadId, COMMENTS_ORIGIN)),
      focus: () => void (!editor.isDestroyed && editor.commands.focus()),
    };
  }, [editor, handle, author]);

  // a version is drawn with the design-system tokens it pinned (and its own overrides): by the page's scope when there is
  // one (F, S-RESTYLE: the scope resolves them, a bundled family under its face's private name, which a declaration on
  // the page would shadow), else declared on the page itself
  const tokens = preview ? (preview.tokens as CSSProperties) : undefined;
  const declared = Scope ? undefined : tokens;
  const ground = usePageGround(page, tokens);
  useLayoutEffect(() => {
    onPage?.(page.current);
    return () => onPage?.(null);
  }, [onPage]);
  // P4-B1: the margin's compose card is in flow, so its key carries neither the scroll nor the passages' moves
  const marginKey = editor.instanceId;
  const sheet = (
    <div ref={page} className="ds-doc" style={declared} data-ground={ground} data-preview={preview ? '' : undefined} onScroll={comments && !marginHosts ? scrolled : undefined}>
      <div className="ds-doc-page">
        <div className="doc-live" hidden={previewEditor !== null}>
          <EditorContent editor={live} />
        </div>
        {previewEditor && <PreviewMount editor={previewEditor} />}
      </div>
      {margin && marginView !== null && (
        <MarginThreads
          editor={live}
          doc={handle.doc}
          tabId={tabId}
          author={author}
          readOnly={readOnly}
          view={marginView}
          relayoutRef={relayoutRef} // P4-B1
          hosting={hosting}
          overlay={comments && marginHosts ? () => comments.overlay({ ...reach, layoutKey: marginKey, placement: 'margin' }) : null}
          onComment={onComment}
          onTier={onTier}
          enterRef={enterRef}
          drafts={drafts} // P4-B1
          onDraftChange={onDraftChange} // P4-B1
        />
      )}
    </div>
  );
  return (
    <div ref={frame} className="doc-page-frame" onContextMenu={editors.onContextMenu}>
      <div className="doc-page-scope">{Scope ? <Scope pinned={preview?.pinned ?? undefined}>{sheet}</Scope> : sheet}</div>
      {comments && !marginHosts && comments.overlay({ ...reach, layoutKey: `${editor.instanceId}:${layout}:${scroll}` })}
      {pill && (
        <div className="doc-pill" data-markup-occluder>
          <button type="button" className="doc-pill-open" onClick={onNewChanges}>
            {pill.count === null ? 'See new changes' : `See ${pill.count} new ${pill.count === 1 ? 'change' : 'changes'}`}
          </button>
          {pill.failed !== null && (
            <button type="button" className="doc-pill-retry" aria-label="Count the new changes again" title={`Counting failed: ${pill.failed}`} onClick={() => void history?.recount()}>
              ↻
            </button>
          )}
          <button type="button" className="doc-pill-dismiss" aria-label="Dismiss new changes" onClick={() => history?.dismissPill()}>
            ×
          </button>
        </div>
      )}
      {editors.open && <ShowEditorsMenu open={editors.open} onShow={editors.show} onClose={editors.close} />}
    </div>
  );
}

// P4-B1: `passageRect` and `blockPos` moved to comments/locate.ts (the margin reads them too)

// The preview's own editor (M9): read-only, bound to the version's view from its creation (the binding's microtask),
// put on another view when the preview changes (a comparison, Show changes), its moved and retyped blocks labelled and
// the change ↑ ↓ asked for reached once it draws, the controller told what is shown. It never touches the live editor.
//
// Its view is drawn detached (`element` a no-op placer) and put in the page by `PreviewMount`, not `EditorContent`:
// EditorContent's unmount clears the node views, which makes ProseMirror redraw the whole document (32,000 nodes of
// garbage at 200 pages, and a leave's time) a millisecond before the editor is destroyed; a plain mount just takes it out.
const PREVIEW_GONE_MS = 10; // past Tiptap's deferred destruction of an unmounted editor (1 ms)
const detached = (): void => {};

function PreviewMount({ editor }: { editor: Editor }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (editor.isDestroyed || !box.current) return;
    const dom = editor.view.dom;
    box.current.appendChild(dom);
    return () => dom.remove();
  }, [editor]);
  return <div ref={box} className="doc-preview" />;
}

interface PreviewEditorProps {
  view: VersionView;
  carried: ReadonlyMap<string, Carry['kind']>;
  focus: Preview['focus']; // P3-E: an unbound extra's too
  handle: DocumentHandle;
  tabId: string;
  artifactId: string;
  host: EditorHost;
  renderDiagram: DocumentEditorProps['renderDiagram'];
  controller: HistoryController | null;
  onEditor(editor: Editor | null): void;
  renderChart?: DocumentEditorProps['renderChart']; // P3-E
  revision?: number; // P3-E: the version's
  extras?: readonly ExtraChange[]; // P3-E (E2 M4): the comparison's extra changes, the shown tab's merged into its list
}

function PreviewEditor({ view, carried, focus, handle, tabId, artifactId, host, renderDiagram, controller, onEditor, renderChart, revision, extras }: PreviewEditorProps) {
  // P3-E: this tab's extra changes, as a value that changes only when they do
  const tabExtras = useMemo(() => extras?.filter((extra) => extra.tabId === tabId && extra.blockId !== null) ?? NO_EXTRAS, [extras, tabId]);
  // P3-E: the version shown, for its charts; this editor is put on other versions without being made again, so it moves
  const [displayed] = useState(() => displayedDocument(view.ytype.doc!, revision));
  useLayoutEffect(() => displayed.set(view.ytype.doc!, revision), [displayed, view, revision]);
  const editor = useEditor(
    {
      coreExtensionOptions,
      extensions: editorExtensions({
        collaboration: { ytype: tabBody(handle.doc, tabId) ?? null, awareness: null, user: null, hold: null, onRestored: null, version: view },
        comments: { doc: handle.doc, tabId, onComment: () => false },
        env: { artifactId, host, ...(renderDiagram ? { renderDiagram } : {}), ...(renderChart ? { renderChart, displayed } : {}) /* P3-E */ },
      }),
      element: detached,
      editorProps: { attributes: { 'aria-label': 'Document', class: 'doc-content', 'data-editor': 'preview' } },
      shouldRerenderOnTransaction: false,
      editable: false,
    },
    [tabId, handle, host, artifactId],
  );
  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);
  useEffect(() => {
    if (editor.isDestroyed) return;
    const sync = () => ySyncPluginKey.getState(editor.state) as { ytype?: unknown; renderer?: unknown } | undefined;
    const bound = () => sync()?.ytype === view.ytype && (sync()?.renderer ?? null) === view.renderer;
    // a view other than the one the editor is on (or being bound to at its creation)
    if (sync()?.ytype != null && !bound()) editor.commands.showVersion(view);
    setCarried(editor, carried);
    if (extras) setExtra(editor, tabExtras); // P3-E: only with the hook, so B's preview dispatches nothing new
    const drawn = () => {
      if (focus !== null) goToChange(editor, typeof focus === 'number' ? focus : null); // P3-E: an extra's focus is the bar's
      controller?.applied(view);
    };
    if (bound()) return void drawn();
    const once = ({ transaction }: { transaction: { docChanged: boolean; getMeta(key: string): unknown } }) => {
      if (!isBindingTransaction(transaction) || !bound()) return;
      editor.off('transaction', once);
      drawn();
    };
    editor.on('transaction', once);
    return () => {
      editor.off('transaction', once);
    };
  }, [editor, view, carried, focus, controller, extras, tabExtras]);
  return null;
}

// P3-E (E2 M3): the revision of the version a preview shows (the later one of a comparison); none for the live state.
function previewRevision(preview: Preview | null, versions: readonly { id: number; seq: number }[] | null): number | undefined {
  const target = preview?.target;
  if (!target || target.kind === 'since') return undefined;
  const ids = target.kind === 'version' ? [target.versionId] : target.versionIds;
  const seqs = ids.map((id) => versions?.find((version) => version.id === id)?.seq).filter((seq): seq is number => seq !== undefined);
  return seqs.length > 0 ? Math.max(...seqs) : undefined;
}
