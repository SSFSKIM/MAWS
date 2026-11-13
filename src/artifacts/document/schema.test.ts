// The schema module (D2 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md) in Node: its node and mark set, the
// frozen comment mark, ids on every block, S1's parity check (a document with every stored node and mark goes
// through `pmnodeToDelta` → a Y.Doc → `ynodeToPmnode` unchanged), and what the document-repairing plugins answer.
import { Editor, type JSONContent } from '@tiptap/core';
import { EditorState, NodeSelection, Plugin, TextSelection, type Transaction } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { afterEach, describe, expect, it } from 'vitest';
import { newDoc, stateV2, applyV2 } from '../yjs';
import { pmnodeToDelta, ynodeToPmnode } from '../yjs/prosemirror';
import { everyKindJSON } from './fixtures';
import { coreExtensionOptions } from './ids';
import { ATTRIBUTION_MARKS, BLOCK_TYPES, attributedNodes, extensions, nanoid8, schemaFor } from './schema';

const schema = schemaFor();

describe('the schema module', () => {
  it('holds D2’s nodes, the four --attributed variants and nothing else', () => {
    expect(Object.keys(schema.nodes).sort()).toEqual(
      [
        'doc', 'paragraph', 'text', 'hardBreak', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem',
        'blockquote', 'codeBlock', 'table', 'tableRow', 'tableCell', 'tableHeader', 'image', 'horizontalRule', 'callout',
        'math', 'mathBlock', 'diagram', 'chart', 'pending', 'date', 'mention', 'dropdown',
        'blockquote--attributed', 'listItem--attributed', 'taskItem--attributed', 'callout--attributed',
      ].sort(),
    );
  });

  it('holds D2’s marks and nothing else', () => {
    expect(Object.keys(schema.marks).sort()).toEqual(
      ['bold', 'italic', 'underline', 'strike', 'code', 'link', 'highlight', 'comment', ...ATTRIBUTION_MARKS].sort(),
    );
  });

  it('freezes the comment mark at one attribute, overlapping and non-inclusive', () => {
    const comment = schema.marks.comment;
    expect(Object.keys(comment.spec.attrs ?? {})).toEqual(['threadId']);
    expect(comment.excludes(comment)).toBe(false);
    expect(comment.spec.inclusive).toBe(false);
  });

  it('allows a comment on a code block (S5 pitfall 5) and the attribution marks on every container', () => {
    expect(schema.nodes.codeBlock.allowsMarkType(schema.marks.comment)).toBe(true);
    for (const name of ['doc', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'codeBlock', 'table', 'tableRow', 'tableCell', 'tableHeader', 'callout']) {
      for (const mark of ATTRIBUTION_MARKS) expect(schema.nodes[name].allowsMarkType(schema.marks[mark]), `${mark} on ${name}`).toBe(true);
    }
  });

  it('leaves `code` excluding as Tiptap ships it (S1 pitfall 4: excludes changes the storage key)', () => {
    expect(schema.marks.code.excludes(schema.marks.bold)).toBe(true);
    expect(schema.marks.code.excludes(schema.marks.code)).toBe(true);
  });

  it('gives every block type and its --attributed variant an id, and keeps the D2 attributes', () => {
    for (const name of BLOCK_TYPES) expect(schema.nodes[name].spec.attrs, name).toHaveProperty('id');
    for (const name of ['blockquote', 'listItem', 'taskItem', 'callout']) expect(schema.nodes[`${name}--attributed`].spec.attrs).toHaveProperty('id');
    expect(schema.nodes.image.spec.attrs).not.toHaveProperty('id');
    const attrs = (name: string) => Object.keys(schema.nodes[name].spec.attrs ?? {}).filter((key) => key !== 'id').sort();
    expect(attrs('heading')).toEqual(['level']);
    expect(attrs('callout')).toEqual(['tone']);
    expect(attrs('image')).toEqual(['alt', 'assetId', 'src']);
    expect(attrs('math')).toEqual(['latex']);
    expect(attrs('mathBlock')).toEqual(['latex']);
    expect(attrs('diagram')).toEqual(['source']);
    expect(attrs('chart')).toEqual(['source', 'spec']);
    expect(attrs('pending')).toEqual(['intent']);
    expect(attrs('date')).toEqual(['iso']);
    expect(attrs('mention')).toEqual(['kind', 'label', 'ref']);
    expect(attrs('dropdown')).toEqual(['options', 'value']);
    expect(attrs('taskItem')).toEqual(['checked']);
    expect(Object.keys(schema.marks.link.spec.attrs ?? {}).sort()).toEqual(['href', 'title']);
    expect(Object.keys(schema.marks.highlight.spec.attrs ?? {})).toEqual(['color']);
    expect(schema.nodes.heading.create({ level: 1 }).attrs.level).toBe(1);
    expect(schema.nodes.math.isInline && schema.nodes.mathBlock.isBlock).toBe(true);
  });

  it('is one object per process', () => {
    expect(schemaFor()).toBe(schemaFor());
  });

  it('mints ids of 8 characters from [0-9a-z]', () => {
    for (let i = 0; i < 50; i++) expect(nanoid8()).toMatch(/^[0-9a-z]{8}$/);
  });

  it('renders a strict container holding a deletion as its --attributed variant', () => {
    expect(attributedNodes('callout', { delete: true })).toBe(true);
    expect(attributedNodes('callout', { insert: true })).toBe(false);
    expect(attributedNodes('paragraph', { delete: true })).toBe(false);
  });
});

describe('S1’s parity check', () => {
  it('has a fixture holding every node and mark the binding stores', () => {
    const nodes = new Set<string>();
    const marks = new Set<string>();
    schema.nodeFromJSON(everyKindJSON()).descendants((node) => {
      nodes.add(node.type.name);
      for (const mark of node.marks) marks.add(mark.type.name);
    });
    nodes.add('doc');
    const renderOnly = (name: string) => name.endsWith('--attributed') || name.startsWith('y-attributed-');
    expect([...nodes].sort()).toEqual(Object.keys(schema.nodes).filter((name) => !renderOnly(name)).sort());
    expect([...marks].sort()).toEqual(Object.keys(schema.marks).filter((name) => !renderOnly(name)).sort());
  });

  it('takes a document with every stored node and mark through Yjs and back byte-identically', () => {
    const doc = schema.nodeFromJSON(everyKindJSON());
    doc.check();
    const ydoc = newDoc();
    ydoc.get('default').applyDelta(pmnodeToDelta(doc));
    const reloaded = newDoc();
    applyV2(reloaded, stateV2(ydoc));
    const back = ynodeToPmnode(reloaded.get('default'), schema);
    expect(JSON.stringify(back.toJSON())).toBe(JSON.stringify(doc.toJSON()));
    expect(back.eq(doc)).toBe(true);
    // and written again, it stores what it was read from
    const again = newDoc();
    again.get('default').applyDelta(pmnodeToDelta(back));
    expect(JSON.stringify(again.get('default').toDelta().toJSON())).toBe(JSON.stringify(reloaded.get('default').toDelta().toJSON()));
  });
});

// X-141 (docs/doperpowers/plans/2026-11-12-ux-wave-U10a-unmade-writes.md, decisions 6 to 8, §B): a repair changes the
// document only in answer to a change of the person's to the content, read at the batch's root; the trailing paragraph
// also waits out a composition. Over the schema module's extension list (an editor's plugins, no view and no binding):
// each transaction is applied to the state as the view would, and what the plugins appended is read from the result.
describe('the document-repairing plugins', () => {
  const editors: Editor[] = [];
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  const para = (id: string, text: string): JSONContent => ({ type: 'paragraph', attrs: { id }, content: text ? [{ type: 'text', text }] : [] });
  const chart = (id: string): JSONContent => ({ type: 'chart', attrs: { id, source: 'sales', spec: null } });
  const table = (id: string, rows: string[][]): JSONContent => ({
    type: 'table',
    attrs: { id },
    content: rows.map((cells, r) => ({ type: 'tableRow', attrs: { id: `${id}r${r}` }, content: cells.map((text, c) => ({ type: 'tableCell', attrs: { id: `${id}r${r}c${c}` }, content: [para(`${id}r${r}c${c}p`, text)] })) })),
  });
  function stateOf(...blocks: JSONContent[]): EditorState {
    let n = 0;
    const editor = new Editor({ element: null, coreExtensionOptions, extensions: extensions({ generateID: () => `n${++n}` }), content: { type: 'doc', content: blocks } });
    editors.push(editor);
    // an unmounted editor's state holds no plugins until a view takes them; the view's own state is made the same way
    return EditorState.create({ doc: editor.state.doc, plugins: editor.extensionManager.plugins });
  }
  /** The state after `tr`, and how many transactions the plugins appended to it. */
  const apply = (state: EditorState, tr: Transaction) => {
    const { state: next, transactions } = state.applyTransaction(tr);
    return { state: next, appended: transactions.length - 1 };
  };
  const shape = (state: EditorState) => {
    const out: string[] = [];
    state.doc.forEach((block) => out.push(`${block.type.name}:${block.textContent}`));
    return out;
  };
  const endOf = (state: EditorState, id: string): number => {
    let at = -1;
    state.doc.descendants((node, pos) => {
      if (at < 0 && node.attrs.id === id && node.isTextblock) at = pos + 1 + node.content.size;
      return at < 0;
    });
    return at;
  };
  const remote = (tr: Transaction) => tr.setMeta('y-sync-transaction', true); // the meta the binding's own dispatches carry

  it('append nothing to a transaction that carries only a meta, or only sets the selection', () => {
    const state = stateOf(para('p1', 'Quarterly sales.'), chart('c1'));
    const redraw = apply(state, state.tr.setMeta('presence', true).setMeta('addToHistory', false));
    expect([redraw.appended, shape(redraw.state)]).toEqual([0, ['paragraph:Quarterly sales.', 'chart:']]);
    const caret = apply(state, state.tr.setSelection(TextSelection.create(state.doc, 3)));
    expect([caret.appended, shape(caret.state)]).toEqual([0, ['paragraph:Quarterly sales.', 'chart:']]);
  });

  it('append the trailing paragraph to a change of the person’s elsewhere, in the same batch', () => {
    const state = stateOf(para('p1', 'Quarterly sales.'), chart('c1'));
    const typed = apply(state, state.tr.insertText('y', endOf(state, 'p1')));
    expect(shape(typed.state)).toEqual(['paragraph:Quarterly sales.y', 'chart:', 'paragraph:']);
  });

  it('hold the trailing paragraph through a composition and append it to the next change outside one', () => {
    const state = stateOf(para('p1', 'Quarterly sales.'), chart('c1'));
    const composed = apply(state, state.tr.insertText('한', endOf(state, 'p1')).setMeta('composition', 1));
    expect(shape(composed.state)).toEqual(['paragraph:Quarterly sales.한', 'chart:']);
    const plain = apply(composed.state, composed.state.tr.insertText(' ', endOf(composed.state, 'p1')));
    expect(shape(plain.state)).toEqual(['paragraph:Quarterly sales.한 ', 'chart:', 'paragraph:']);
  });

  it('answer neither the binding’s transaction nor what another plugin appends to it', () => {
    const state = stateOf(para('p1', 'Quarterly sales.'), chart('c1'));
    const bound = apply(state, remote(state.tr.insertText('!', endOf(state, 'p1'))));
    expect(shape(bound.state)).toEqual(['paragraph:Quarterly sales.!', 'chart:']);
    // a fix-up of the caret appended to a remote write, as `caretFollowsId` makes one: not marked as the binding's
    // itself, only by its root; and a change of the document appended the same way
    const caretFix = new Plugin({ appendTransaction: (trs, _old, next) => (trs.some((tr) => tr.getMeta('y-sync-transaction') != null) ? next.tr.setSelection(TextSelection.create(next.doc, 2)) : null) });
    const withFix = state.reconfigure({ plugins: [...state.plugins, caretFix] });
    const fixed = apply(withFix, remote(withFix.tr.insertText('!', endOf(withFix, 'p1'))));
    expect([fixed.appended, shape(fixed.state)]).toEqual([1, ['paragraph:Quarterly sales.!', 'chart:']]);
    const contentFix = new Plugin({ appendTransaction: (trs, _old, next) => (trs.some((tr) => tr.getMeta('y-sync-transaction') != null) ? next.tr.insertText('?', 1) : null) });
    const withContentFix = state.reconfigure({ plugins: [...state.plugins, contentFix] });
    const changed = apply(withContentFix, remote(withContentFix.tr.insertText('!', endOf(withContentFix, 'p1'))));
    expect(shape(changed.state)).toEqual(['paragraph:?Quarterly sales.!', 'chart:']);
  });

  // decision 7: ProseMirror marks an appended transaction with its root and with nothing else of the root's, so the
  // table's repair of composed input does not carry `composition` itself
  it('repair a ragged table under composed input but hold the trailing paragraph, then append it to the next plain change', () => {
    const state = stateOf(para('p1', 'Intro.'), table('tb', [['a', 'b'], ['c']]), chart('c1'));
    const cells = (s: EditorState) => {
      const out: number[] = [];
      s.doc.descendants((node) => {
        if (node.type.name === 'tableRow') out.push(node.childCount);
        return true;
      });
      return out;
    };
    expect(cells(state)).toEqual([2, 1]);
    const composed = apply(state, state.tr.insertText('한', endOf(state, 'tbr0c0p')).setMeta('composition', 1));
    expect([cells(composed.state), shape(composed.state)]).toEqual([[2, 2], ['paragraph:Intro.', 'table:a한bc', 'chart:']]);
    const plain = apply(composed.state, composed.state.tr.insertText(' ', endOf(composed.state, 'p1')));
    expect(shape(plain.state)).toEqual(['paragraph:Intro. ', 'table:a한bc', 'chart:', 'paragraph:']);
  });

  it('let the table put a selection right, a cell selected as a node becoming a cell selection, and change nothing', () => {
    const state = stateOf(para('p1', 'Intro.'), table('tb', [['alpha', 'beta']]), chart('c1'));
    let cell = -1;
    state.doc.descendants((node, pos) => {
      if (cell < 0 && node.type.name === 'tableCell') cell = pos;
      return cell < 0;
    });
    const selected = apply(state, state.tr.setSelection(NodeSelection.create(state.doc, cell)));
    expect(selected.state.selection).toBeInstanceOf(CellSelection);
    expect(selected.state.doc.eq(state.doc)).toBe(true);
  });
});
