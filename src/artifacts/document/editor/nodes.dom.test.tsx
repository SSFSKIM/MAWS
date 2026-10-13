// The editor's node views and highlighting (happy-dom; M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md):
// math through KaTeX, diagrams through a lazily loaded renderer, images through the host's asset URL, the callout's
// tone, the chips, the placeholders, code highlighted by shiki, each atom edited in place through its field; and the
// editor half of D4's identity test (the editor builds the schema module's schema).
import { Editor, type JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { coreExtensionOptions } from '../ids';
import { fingerprint } from '../fingerprint';
import { schemaFor } from '../schema';
import { editorExtensions } from './extensions';
import { memoryEditorHost } from './memory-host';
import { doc, para, until } from './test-world';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const host = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' });
host.assets.set('maws-artifact:a1/cat.png', 'blob:cat');
const diagrams: string[] = [];
const make = (content: JSONContent) => {
  editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    coreExtensionOptions,
    extensions: editorExtensions({
      collaboration: null,
      env: {
        artifactId: 'doc1',
        host,
        renderDiagram: async (source) => {
          diagrams.push(source);
          return `<svg data-rendered="${source.length}"></svg>`;
        },
      },
    }),
    content,
  });
  return editor;
};
const view = (e: Editor, type: string) => e.view.dom.querySelector<HTMLElement>(`[data-node="${type}"]`)!;
const atPos = (e: Editor, type: string): number => {
  let at = -1;
  e.state.doc.descendants((node, pos) => {
    if (node.type.name === type && at < 0) at = pos;
    return at < 0;
  });
  return at;
};
const attrsOf = (e: Editor, type: string) => e.state.doc.nodeAt(atPos(e, type))!.attrs;
const select = (e: Editor, type: string) => e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, atPos(e, type))));
// Types into an atom's field as a person would: the value, then an input event.
function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('the schema the editor builds', () => {
  it('is the schema module’s, node for node and mark for mark (D4, the editor half)', () => {
    const e = make(doc(para('p1', 'x')));
    expect(fingerprint(e.schema)).toEqual(fingerprint(schemaFor()));
  });
});

describe('math', () => {
  it('renders inline and block math through KaTeX and edits the LaTeX in place', () => {
    const e = make(
      doc({ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Euler: ' }, { type: 'math', attrs: { latex: 'e^{i\\pi}' } }] }, { type: 'mathBlock', attrs: { id: 'm1', latex: 'a^2+b^2=c^2' } }),
    );
    expect(view(e, 'math').querySelector('.katex')).not.toBeNull();
    expect(view(e, 'mathBlock').querySelector('.katex-display')).not.toBeNull();

    const field = view(e, 'math').querySelector<HTMLInputElement>('[aria-label="LaTeX"]')!;
    expect(field.closest<HTMLElement>('.doc-atom-field')!.hidden).toBe(true);
    select(e, 'math');
    expect(field.closest<HTMLElement>('.doc-atom-field')!.hidden).toBe(false);
    typeInto(field, 'x^2');
    expect(attrsOf(e, 'math').latex).toBe('x^2');
    expect(view(e, 'math').querySelector('.doc-atom-view')!.textContent).toContain('x');
  });
});

describe('diagrams', () => {
  it('show their source until the renderer answers, then the drawing; an edited source redraws', async () => {
    const e = make(doc({ type: 'diagram', attrs: { id: 'd1', source: 'graph TD; A-->B' } }));
    expect(view(e, 'diagram').textContent).toContain('graph TD; A-->B');
    await until(() => view(e, 'diagram').querySelector('svg') !== null, 'the drawing');
    select(e, 'diagram');
    typeInto(view(e, 'diagram').querySelector<HTMLTextAreaElement>('[aria-label="Diagram source"]')!, 'graph LR; X-->Y');
    expect(attrsOf(e, 'diagram').source).toBe('graph LR; X-->Y');
    await until(() => diagrams.at(-1) === 'graph LR; X-->Y', 'the redraw');
  });
});

describe('images', () => {
  it('show an asset through the host’s asset URL and an https image as given; alt text edits in place', () => {
    const e = make(
      doc({
        type: 'paragraph',
        attrs: { id: 'p1' },
        content: [
          { type: 'image', attrs: { src: 'maws-artifact:a1/cat.png', alt: 'a cat', assetId: 'a1' } },
          { type: 'image', attrs: { src: 'https://example.com/dog.png', alt: 'a dog', assetId: null } },
          { type: 'image', attrs: { src: 'javascript:alert(1)', alt: 'no', assetId: null } },
        ],
      }),
    );
    const images = [...e.view.dom.querySelectorAll<HTMLImageElement>('[data-node="image"] img')];
    expect(images.map((img) => img.getAttribute('src'))).toEqual(['blob:cat', 'https://example.com/dog.png', null]);
    select(e, 'image');
    typeInto(view(e, 'image').querySelector<HTMLInputElement>('[aria-label="Alt text"]')!, 'a sleeping cat');
    expect(attrsOf(e, 'image').alt).toBe('a sleeping cat');
  });
});

describe('callouts', () => {
  it('carry their tone and change it through the tone control, the content still editable', () => {
    const e = make(doc({ type: 'callout', attrs: { id: 'c1', tone: 'note' }, content: [para('p1', 'Heads up')] }));
    const aside = view(e, 'callout');
    expect(aside.getAttribute('data-callout-tone')).toBe('note');
    choose(aside.querySelector<HTMLSelectElement>('[aria-label="Callout tone"]')!, 'warn');
    expect(attrsOf(e, 'callout').tone).toBe('warn');
    expect(view(e, 'callout').getAttribute('data-callout-tone')).toBe('warn');
    e.commands.insertContentAt(atPos(e, 'callout') + 2, 'Note: ');
    expect(e.state.doc.child(0).textContent).toBe('Note: Heads up');
  });
});

describe('chips', () => {
  const chips = doc({
    type: 'paragraph',
    attrs: { id: 'p1' },
    content: [
      { type: 'date', attrs: { iso: '2026-10-13' } },
      { type: 'text', text: ' ' },
      { type: 'mention', attrs: { kind: 'person', ref: 'u1', label: 'Ada' } },
      { type: 'text', text: ' ' },
      { type: 'dropdown', attrs: { options: ['To do', 'Done'], value: 'To do' } },
    ],
  });

  it('show a date, a mention and a status', () => {
    const e = make(chips);
    expect(view(e, 'date').textContent).toContain('Oct 13, 2026');
    expect(view(e, 'mention').textContent).toContain('@Ada');
    expect(view(e, 'dropdown').querySelector('select')!.value).toBe('To do');
  });

  it('change their values in place', () => {
    const e = make(chips);
    choose(view(e, 'dropdown').querySelector('select')!, 'Done');
    expect(attrsOf(e, 'dropdown').value).toBe('Done');
    select(e, 'date');
    typeInto(view(e, 'date').querySelector<HTMLInputElement>('[aria-label="Date"]')!, '2026-11-02');
    expect(attrsOf(e, 'date').iso).toBe('2026-11-02');
    select(e, 'mention');
    typeInto(view(e, 'mention').querySelector<HTMLInputElement>('[aria-label="Name"]')!, 'Ada Lovelace');
    expect(attrsOf(e, 'mention')).toMatchObject({ label: 'Ada Lovelace', ref: 'u1' });
  });
});

describe('placeholders', () => {
  it('label a pending section with its intent (editable) and a chart with its source', () => {
    const e = make(doc({ type: 'pending', attrs: { id: 'x1', intent: 'Summary of findings' } }, { type: 'chart', attrs: { id: 'x2', source: 'sales.csv', spec: null } }));
    expect(view(e, 'pending').textContent).toContain('Summary of findings');
    expect(view(e, 'chart').textContent).toContain('sales.csv');
    select(e, 'pending');
    typeInto(view(e, 'pending').querySelector<HTMLInputElement>('[aria-label="Intent"]')!, 'Methods');
    expect(attrsOf(e, 'pending').intent).toBe('Methods');
  });
});

describe('code blocks', () => {
  it('are highlighted by shiki, decorations only (the stored text carries no marks)', async () => {
    const e = make(doc({ type: 'codeBlock', attrs: { id: 'c1', language: 'js' }, content: [{ type: 'text', text: 'const x = 1;' }] }));
    await until(() => e.view.dom.querySelectorAll('.doc-code-token').length > 1, 'the highlighted tokens');
    const tokens = [...e.view.dom.querySelectorAll<HTMLElement>('.doc-code-token')];
    expect(tokens.map((t) => t.textContent).join('')).toBe('const x = 1;');
    expect(tokens.some((t) => /color/.test(t.getAttribute('style') ?? ''))).toBe(true);
    expect(e.getJSON().content![0].content).toEqual([{ type: 'text', text: 'const x = 1;' }]);
  });
});
