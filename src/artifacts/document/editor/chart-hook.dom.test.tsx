// P3-E (E2 M3; ledger X26's amendment, E's Decision Log 6 and 19): B's chart atom draws through the environment's
// `renderChart` when one is given, with the displayed document beside it, and releases each drawing through the
// disposer it returned: before a redraw on an attribute change, when the node leaves the document, when the editor
// goes. Without `renderChart` the placeholder stays (B's own suites cover it unchanged).
import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreExtensionOptions } from '../ids';
import { newDoc } from '../../yjs';
import { editorExtensions } from './extensions';
import { memoryEditorHost } from './memory-host';
import { displayedDocument, type ViewEnvironment } from './nodes/views';
import { doc, para } from './test-world';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const host = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' });
const chart = (id: string, source: string, spec: unknown = { view: 'bar' }): JSONContent => ({ type: 'chart', attrs: { id, source, spec } });

function make(content: JSONContent, env: Partial<ViewEnvironment>) {
  editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    coreExtensionOptions,
    extensions: editorExtensions({ collaboration: null, env: { artifactId: 'dash1', host, ...env } }),
    content,
  });
  return editor;
}

describe('the chart hook', () => {
  it('draws each chart through renderChart with the node and the displayed document, and releases it when it goes', () => {
    const shown = displayedDocument(newDoc(), 7);
    const drawn: string[] = [];
    const released: string[] = [];
    const renderChart = vi.fn((into: HTMLElement, node: { attrs: Record<string, unknown> }, env: ViewEnvironment) => {
      const label = `${String(node.attrs.source)}@${env.displayed?.current().revision}`;
      into.textContent = label;
      drawn.push(label);
      return () => released.push(label);
    });
    const e = make(doc(para('p1', 'Intro'), chart('c1', 'sales'), chart('c2', 'costs')), { renderChart, displayed: shown });
    expect(drawn).toEqual(['sales@7', 'costs@7']);
    expect(e.view.dom.querySelector('[data-node="chart"]')!.textContent).toBe('sales@7');
    expect(renderChart.mock.calls[0][2].displayed?.current().doc).toBe(shown.current().doc);

    // an attribute change releases the old drawing before the new one
    let pos = -1;
    e.state.doc.descendants((node, at) => {
      if (node.attrs.id === 'c1') pos = at;
    });
    e.view.dispatch(e.state.tr.setNodeAttribute(pos, 'source', 'revenue'));
    expect(released).toEqual(['sales@7']);
    expect(drawn.at(-1)).toBe('revenue@7');

    // the node leaving the document releases its drawing
    e.view.dispatch(e.state.tr.delete(pos, pos + 1));
    expect(released).toEqual(['sales@7', 'revenue@7']);

    // the editor going releases the rest
    e.destroy();
    expect(released).toEqual(['sales@7', 'revenue@7', 'costs@7']);
  });

  it('tells its subscribers when the displayed document changes', () => {
    const first = newDoc();
    const second = newDoc();
    const shown = displayedDocument(first);
    const heard: unknown[] = [];
    const off = shown.subscribe(() => heard.push(shown.current()));
    shown.set(first); // the same document: nothing to tell
    shown.set(second, 12);
    off();
    shown.set(first);
    expect(heard).toEqual([{ doc: second, revision: 12 }]);
  });

  it('leaves the drawing\'s own controls their events: Enter on a source button neither edits nor replaces the block', () => {
    const clicked = vi.fn();
    const renderChart = (into: HTMLElement) => {
      const controls = into.appendChild(document.createElement('div'));
      controls.setAttribute('data-atom-controls', '');
      const button = controls.appendChild(document.createElement('button'));
      button.textContent = 'Source';
      button.addEventListener('click', clicked);
      return () => {};
    };
    const e = make(doc(para('p1', 'Intro'), chart('c1', 'sales')), { renderChart, displayed: displayedDocument(newDoc()) });
    const before = e.state.doc;
    const button = e.view.dom.querySelector<HTMLButtonElement>('[data-atom-controls] button')!;
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    button.click();
    expect(e.state.doc).toBe(before);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('keeps B\'s placeholder without renderChart', () => {
    const e = make(doc(chart('c1', 'sales')), {});
    const atom = e.view.dom.querySelector('[data-node="chart"]')!;
    expect(atom.querySelector('.doc-placeholder-label')?.textContent).toBe('Chart');
    expect(atom.textContent).toContain('sales');
  });
});
