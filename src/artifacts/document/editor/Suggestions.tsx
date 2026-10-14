// D14: a suggestion replica rendered over the base, never edited or accepted locally. The service copies accepted
// content with the suggester's binding; the editor supplies the binding's item-id ranges, grouped by top-level block.
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { ArtifactHost, DocumentHandle } from '../../host';
import { decodeMap, type Doc, type SuggestionRange } from '../../yjs';
import { ContentType, Item, createDiffRenderer, type DiffRenderer } from '../../yjs/document';
import { resolvedPositionsToRelativePositions } from '../../yjs/prosemirror';
import { attributedRuns, changeList, renderDiff } from '../history';
import { coreExtensionOptions } from '../ids';
import { tabBody } from '../tabs';
import { editorExtensions } from './extensions';
import type { EditorHost } from './host-types';

export type SuggestionHost = Pick<ArtifactHost, 'open' | 'attributions' | 'acceptSuggestion' | 'rejectSuggestion'>;
export interface SuggestionsProps {
  artifactId: string;
  tabId: string;
  base: DocumentHandle;
  host: SuggestionHost;
  editorHost: EditorHost;
  onPending(pending: boolean): void;
  pageScope?: ComponentType<{ children: ReactNode }>;
}
interface View {
  handle: DocumentHandle;
  renderer: DiffRenderer;
  serial: number;
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

export function Suggestions({ artifactId, tabId, base, host, editorHost, onPending, pageScope }: SuggestionsProps) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let closed = false;
    let serial = 0;
    let handle: DocumentHandle | null = null;
    let current: DiffRenderer | null = null;
    const renderers = new Set<DiffRenderer>();
    setView(null);
    const refresh = async () => {
      const asked = ++serial;
      // The renderer tracks coverage as the base flows into the proposal replica. With no proposals ordinary
      // typing needs neither attribution IPC nor a full ProseMirror rendering of the tab (M9's scale gate).
      if (current?.attributed.isEmpty()) {
        setView(null);
        onPending(false);
        return;
      }
      try {
        const bytes = await host.attributions(artifactId, 0, Number.MAX_SAFE_INTEGER, { doc: 'suggestions' });
        if (closed || asked !== serial || !handle) return;
        const renderer = createDiffRenderer(base.doc, handle.doc, { attributions: decodeMap(bytes) });
        renderer.suggestionMode = true; // no edit or settle may ever flow from this review into the base
        // A settles by withdrawing originals. The pinned renderer's constructor includes those tombstones in its
        // deletion diff, unlike its live update handler: a deletion is proposed only for content the base held.
        // Match that handler when rebuilding with fresh attribution; never show a withdrawn insert as a deletion.
        renderer.inserts.forEach((range, client) => renderer.deletes.delete(client, range.clock, range.len));
        renderers.add(renderer);
        const previous = current;
        current = renderer;
        const body = tabBody(handle.doc, tabId);
        const pending = !renderer.attributed.isEmpty() && body !== undefined && changeList(renderDiff(body, renderer)).length > 0;
        setError(null);
        setView(pending ? { handle, renderer, serial: asked } : null);
        onPending(pending);
        // Unmounted Tiptap views are destroyed on their deferred teardown, before the old renderer is released.
        setTimeout(() => {
          if (previous && renderers.delete(previous)) previous.destroy();
        }, 10);
      } catch (cause) {
        if (!closed && asked === serial) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void host.open(artifactId, { doc: 'suggestions' }).then((opened) => {
      if (closed) return opened.close();
      handle = opened;
      opened.doc.on('update', refresh);
      base.doc.on('update', refresh);
      void refresh();
    }).catch((cause: unknown) => { if (!closed) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => {
      closed = true;
      handle?.doc.off('update', refresh);
      base.doc.off('update', refresh);
      for (const renderer of renderers) renderer.destroy();
      renderers.clear();
      handle?.close();
      onPending(false);
    };
  }, [artifactId, tabId, base, host, onPending, retry]);
  return <>
    {error && <div className="doc-banner" role="alert">Suggestions could not be loaded: {error}<button type="button" className="doc-tool" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}
    {view && <Review key={`${artifactId}:${tabId}:${view.serial}`} view={view} artifactId={artifactId} tabId={tabId} host={host} editorHost={editorHost} pageScope={pageScope} />}
  </>;
}

function Review({ view, artifactId, tabId, host, editorHost, pageScope: Scope }: { view: View; artifactId: string; tabId: string; host: SuggestionHost; editorHost: EditorHost; pageScope: SuggestionsProps['pageScope'] }) {
  const body = tabBody(view.handle.doc, tabId)!;
  const editor = useEditor({
    coreExtensionOptions,
    extensions: editorExtensions({
      collaboration: { ytype: body, awareness: null, user: null, hold: null, onRestored: null, version: { ytype: body, renderer: view.renderer } },
      comments: { doc: view.handle.doc, tabId, onComment: () => false },
      env: { artifactId, host: editorHost },
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
    if (!block || busy) return;
    setBusy(true);
    setError(null);
    try { await host[action](artifactId, block.ranges); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const sheet = <div className="ds-doc"><div className="ds-doc-page"><EditorContent editor={editor} /></div></div>;
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
      <button type="button" className="doc-tool" aria-label={`Accept suggestion ${index + 1}`} disabled={busy || !block?.ranges.length || view.handle.state().readOnly} onClick={() => void settle('acceptSuggestion')}>Accept</button>
      <button type="button" className="doc-tool" aria-label={`Reject suggestion ${index + 1}`} disabled={busy || !block?.ranges.length || view.handle.state().readOnly} onClick={() => void settle('rejectSuggestion')}>Reject</button>
    </div>
    {error && <div className="doc-banner" role="alert">{error}</div>}
    {block && block.ranges.length === 0 && <div className="doc-banner" role="status">This change cannot be resolved to a review range.</div>}
    <div className="doc-page-frame"><div className="doc-page-scope">{Scope ? <Scope>{sheet}</Scope> : sheet}</div></div>
  </section>;
}
