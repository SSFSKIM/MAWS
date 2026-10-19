// D14: a suggestion replica rendered over the base, never edited or accepted locally. The service copies accepted
// content with the suggester's binding; the editor supplies the binding's item-id ranges, grouped by top-level block.
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { ArtifactHost, DocumentHandle } from '../../host';
import type { JointHold, TypingPause } from '../collab';
import { decodeMap, type Doc, type SuggestionRange } from '../../yjs';
import { ContentType, Item, baseBehind, createDiffRenderer, proposesOver, withoutBaseFeed, type DiffRenderer, type Transaction } from '../../yjs/document';
import { resolvedPositionsToRelativePositions } from '../../yjs/prosemirror';
import { attributedRuns, changeList, renderDiff } from '../history';
import { coreExtensionOptions } from '../ids';
import { tabBody } from '../tabs';
import { editorExtensions } from './extensions';
import { displayedDocument, type ViewEnvironment } from './nodes/views'; // P3-E
import type { EditorHost } from './host-types';
import { usePageGround } from './page-ground';
import { useReadOnly } from './read-only';

/** How long a difference must hold, with the base caught up, before the review replaces the live editor. */
const SETTLE_MS = 250;

export type SuggestionHost = Pick<ArtifactHost, 'open' | 'attributions' | 'acceptSuggestion' | 'rejectSuggestion'>;
export interface SuggestionsProps {
  artifactId: string;
  tabId: string;
  base: DocumentHandle;
  /** The live editor's composition hold, which the suggestion replica joins so it never runs ahead of the base. */
  hold?: JointHold;
  /** The person's typing in the live editor: the review replaces the live editor only at a pause (Decision Log 51). */
  typing?: TypingPause;
  host: SuggestionHost;
  editorHost: EditorHost;
  onPending(pending: boolean): void;
  pageScope?: ComponentType<{ children: ReactNode }>;
  // P3-E start (E2 M3): a dashboard's charts in the review, drawn from the suggestion replica's doc, which is told while
  // the review shows
  renderChart?: ViewEnvironment['renderChart'];
  onDisplayedDocument?(doc: Doc): void;
  // P3-E end
}
interface View {
  handle: DocumentHandle;
  renderer: DiffRenderer;
  serial: number;
  /** The document tab the review was read for. */
  tabId: string;
}
interface BlockSuggestion {
  from: number;
  label: string;
  ranges: SuggestionRange[];
}

/** A whole inserted node needs its own item (not its text); existing nodes need the changed child chains. */
function suggestedBlocks(editor: Editor, doc: Doc): BlockSuggestion[] {
  const blocks = new Map<string, BlockSuggestion>();
  let coveredUntil = -1;
  for (const run of attributedRuns(editor.state.doc)) {
    if (run.from < coveredUntil) continue;
    const start = editor.state.doc.resolve(run.from);
    const top = start.depth > 0 ? start.before(1) : run.from;
    const topNode = editor.state.doc.nodeAt(top);
    const identity = String(topNode?.attrs.id ?? `position:${top}`);
    const block = blocks.get(identity) ?? { from: top, label: topNode?.textContent.slice(0, 80) || run.where, ranges: [] };
    blocks.set(identity, block);
    const [a, b] = resolvedPositionsToRelativePositions(editor.view, [start, editor.state.doc.resolve(run.node ? run.from : Math.max(run.from, run.to - 1))]);
    if (!a?.item || !b?.item) continue;
    let range: SuggestionRange = { start: a.item, end: b.item };
    if (run.kind === 'attrs') {
      // PM maps the node, not its attribute. Resolve that mapped node's attribute chain (A accepts one chain per
      // range); including its older values lets Reject restore the original value as well as remove the proposal.
      if (!run.attr) continue;
      const item = doc.store.getItem(a.item);
      const content = item instanceof Item ? item.content : null;
      if (!(content instanceof ContentType)) continue;
      const attr = content.type._map.get(run.attr);
      if (!attr) continue;
      let first = attr;
      while (first.left) first = first.left;
      range = { start: first.id, end: attr.id };
    }
    const key = JSON.stringify(range);
    if (!block.ranges.some((kept) => JSON.stringify(kept) === key)) block.ranges.push(range);
    if (run.node && (run.kind === 'ins' || run.kind === 'del')) coveredUntil = run.to;
  }
  return [...blocks.values()];
}

export function Suggestions({ artifactId, tabId, base, hold, typing, host, editorHost, onPending, pageScope, renderChart, onDisplayedDocument }: SuggestionsProps) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const readOnly = useReadOnly(base); // the store's, which the suggestion replica shares
  // P3-F: the replica is the artifact's, open across document-tab switches; each read reviews the tab shown then, and a
  // switch reads the new tab's review at once
  const tab = useRef(tabId);
  const switchTab = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (tab.current === tabId) return;
    tab.current = tabId;
    switchTab.current?.();
  }, [tabId]);
  useEffect(() => {
    let closed = false;
    let serial = 0;
    let handle: DocumentHandle | null = null;
    let leaveHold: (() => void) | null = null;
    let current: DiffRenderer | null = null;
    const renderers = new Set<DiffRenderer>();
    // Whether the last full refresh found proposals to review (true until the first has run). With none, ordinary
    // typing needs neither attribution IPC nor a full ProseMirror rendering of the tab (M9's scale gate): only a
    // transaction proposing something over the base refreshes. The renderer's coverage cannot say so: it keeps every
    // settled proposal's withdrawn inserts (M9 addendum fix wave).
    let listed = true;
    // whether the review is on screen in place of the live editor (across a tab switch, until the new tab's is read: a
    // proposal there is shown at once, not held for a settle window anew)
    let showing = false;
    let waiting: ReturnType<typeof setTimeout> | undefined; // a review held back until the person pauses
    let settling: { changes: string; since: number } | null = null; // the difference a review not yet shown last found
    setView(null);
    const refresh = async () => {
      const asked = ++serial;
      try {
        const bytes = await host.attributions(artifactId, 0, Number.MAX_SAFE_INTEGER, { doc: 'suggestions' });
        if (closed || asked !== serial || !handle) return;
        // the host feeds the base into the suggestion doc; the renderer's own feed would send every base update to the
        // host a second time, from the suggestion replica (M9 follow-up)
        const renderer = withoutBaseFeed(createDiffRenderer(base.doc, handle.doc, { attributions: decodeMap(bytes) }));
        renderer.suggestionMode = true; // no edit or settle may ever flow from this review into the base
        // A settles by withdrawing originals. The pinned renderer's constructor includes those tombstones in its
        // deletion diff, unlike its live update handler: a deletion is proposed only for content the base held.
        // Match that handler when rebuilding with fresh attribution; never show a withdrawn insert as a deletion.
        renderer.inserts.forEach((range, client) => renderer.deletes.delete(client, range.clock, range.len));
        renderers.add(renderer);
        const previous = current;
        current = renderer;
        const reviewed = tab.current;
        const body = tabBody(handle.doc, reviewed);
        const changes = !renderer.attributed.isEmpty() && body !== undefined ? changeList(renderDiff(body, renderer)) : [];
        const pending = changes.length > 0;
        // A review not yet shown (the first check's included: a replica that opens mid-composition already holds what the
        // base holds back) waits while the person types in the live editor, and is checked again at the pause. It also
        // waits until the base has caught up with what the suggestion doc holds of the base's clients and the difference
        // has held for the settle window: another replica's typing can reach this replica before the base (Decision Log
        // 51(a)), and is then gone from the difference once the base has it.
        let pause = 0;
        if (pending && !showing) {
          const key = JSON.stringify(changes);
          const now = Date.now();
          if (settling?.changes !== key || baseBehind(base.doc, handle.doc)) settling = { changes: key, since: now };
          pause = Math.max(typing?.remaining() ?? 0, settling.since + SETTLE_MS - now);
        } else settling = null;
        clearTimeout(waiting);
        if (pause > 0) waiting = setTimeout(() => void refresh(), pause);
        const shown = pending && pause === 0;
        listed = shown;
        showing = shown;
        setError(null);
        setView(shown ? { handle, renderer, serial: asked, tabId: reviewed } : null);
        onPending(shown);
        // Unmounted Tiptap views are destroyed on their deferred teardown, before the old renderer is released.
        setTimeout(() => {
          if (previous && renderers.delete(previous)) previous.destroy();
        }, 10);
      } catch (cause) {
        if (!closed && asked === serial) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    // A base change never adds a proposal; a suggestion replica's change refreshes when it proposes something.
    const onBase = () => void (listed && refresh());
    const onProposal = (_update: Uint8Array, _origin: unknown, _doc: Doc, tr: Transaction) => void ((listed || proposesOver(tr, base.doc)) && refresh());
    // the review shown was the other tab's: the live page shows until the new tab's is read
    switchTab.current = () => {
      setView(null);
      onPending(false);
      void refresh();
    };
    void host.open(artifactId, { doc: 'suggestions' }).then((opened) => {
      if (closed) return opened.close();
      handle = opened;
      leaveHold = hold?.join(opened) ?? null;
      opened.doc.on('update', onProposal);
      base.doc.on('update', onBase);
      void refresh();
    }).catch((cause: unknown) => { if (!closed) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => {
      closed = true;
      switchTab.current = null;
      clearTimeout(waiting);
      leaveHold?.();
      handle?.doc.off('update', onProposal);
      base.doc.off('update', onBase);
      for (const renderer of renderers) renderer.destroy();
      renderers.clear();
      handle?.close();
      onPending(false);
    };
  }, [artifactId, base, hold, host, onPending, retry]);
  const shownDoc = view?.handle.doc ?? null; // P3-E
  useEffect(() => {
    if (shownDoc) onDisplayedDocument?.(shownDoc);
  }, [shownDoc, onDisplayedDocument]);
  return <>
    {error && <div className="doc-banner" role="alert">Suggestions could not be loaded: {error}<button type="button" className="doc-tool" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}
    {view && <Review key={`${artifactId}:${view.tabId}:${view.serial}`} view={view} artifactId={artifactId} tabId={view.tabId} host={host} editorHost={editorHost} pageScope={pageScope} readOnly={readOnly} renderChart={renderChart} /* P3-E */ />}
  </>;
}

// `readOnly`: the store is read-only (the base's state, followed), so nothing is accepted or rejected.
function Review({ view, artifactId, tabId, host, editorHost, pageScope: Scope, readOnly, renderChart }: { view: View; artifactId: string; tabId: string; host: SuggestionHost; editorHost: EditorHost; pageScope: SuggestionsProps['pageScope']; readOnly: boolean; renderChart?: SuggestionsProps['renderChart'] /* P3-E */ }) {
  const body = tabBody(view.handle.doc, tabId)!;
  const editor = useEditor({
    coreExtensionOptions,
    extensions: editorExtensions({
      collaboration: { ytype: body, awareness: null, user: null, hold: null, onRestored: null, version: { ytype: body, renderer: view.renderer } },
      comments: { doc: view.handle.doc, tabId, onComment: () => false },
      env: { artifactId, host: editorHost, ...(renderChart ? { renderChart, displayed: displayedDocument(view.handle.doc) } : {}) /* P3-E */ },
    }),
    editable: false,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { 'aria-label': 'Suggested document', class: 'doc-content', 'data-editor': 'suggestions' } },
  });
  const blocks = useEditorState({ editor, selector: ({ editor: current }) => suggestedBlocks(current, view.handle.doc) });
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const index = Math.min(selected, Math.max(0, blocks.length - 1));
  const block = blocks[index];
  const settle = async (action: 'acceptSuggestion' | 'rejectSuggestion') => {
    if (!block || busy || readOnly) return;
    setBusy(true);
    setError(null);
    try { await host[action](artifactId, block.ranges); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const page = useRef<HTMLDivElement>(null);
  const ground = usePageGround(page, undefined); // P3-F: its code coloured for its ground, as the live page's
  const sheet = <div ref={page} className="ds-doc" data-ground={ground}><div className="ds-doc-page"><EditorContent editor={editor} /></div></div>;
  return <section className="doc-tab-editor" aria-label="Suggestion review">
    <div className="doc-toolbar doc-history-bar" role="toolbar" aria-label="Suggestion actions">
      <span className="doc-history-heading">Suggestions</span>
      <select className="doc-toolbar-select" style={{ maxWidth: '100%' }} aria-label="Suggested block" value={index} onChange={(event) => {
        const next = Number(event.target.value);
        setSelected(next);
        editor.commands.setTextSelection(Math.min(blocks[next].from + 1, editor.state.doc.content.size));
        editor.commands.scrollIntoView();
      }}>
        {blocks.map((entry, n) => <option key={entry.from} value={n}>{n + 1}. {entry.label}</option>)}
      </select>
      <button type="button" className="doc-tool" aria-label={`Accept suggestion ${index + 1}`} disabled={busy || !block?.ranges.length || readOnly} onClick={() => void settle('acceptSuggestion')}>Accept</button>
      <button type="button" className="doc-tool" aria-label={`Reject suggestion ${index + 1}`} disabled={busy || !block?.ranges.length || readOnly} onClick={() => void settle('rejectSuggestion')}>Reject</button>
    </div>
    {error && <div className="doc-banner" role="alert">{error}</div>}
    {block && block.ranges.length === 0 && <div className="doc-banner" role="status">This change cannot be resolved to a review range.</div>}
    <div className="doc-page-frame"><div className="doc-page-scope">{Scope ? <Scope>{sheet}</Scope> : sheet}</div></div>
  </section>;
}
