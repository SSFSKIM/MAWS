// The editor's node views and highlighting (happy-dom; M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md):
// math through KaTeX, diagrams through a lazily loaded renderer, images through the host's asset URL, the callout's
// tone, the chips, the placeholders, code highlighted by shiki, each atom edited in place through its field; and the
// editor half of D4's identity test (the editor builds the schema module's schema).
import { Editor, type JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  vi.restoreAllMocks();
});

const host = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' });
host.assets.set('maws-artifact:a1/cat.png', 'blob:cat');
const diagrams: string[] = [];
const drawn = async (source: string) => {
  diagrams.push(source);
  return `<svg data-rendered="${source.length}"></svg>`;
};
const make = (content: JSONContent, renderDiagram: (source: string) => Promise<string> = drawn, editable = true) => {
  editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    coreExtensionOptions,
    extensions: editorExtensions({
      collaboration: null,
      env: {
        artifactId: 'doc1',
        host,
        renderDiagram,
      },
    }),
    content,
    editable,
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

  it('cleared before an earlier drawing answers, stay cleared (the late drawing is dropped)', async () => {
    const asked: Array<(svg: string) => void> = [];
    const e = make(doc({ type: 'diagram', attrs: { id: 'd1', source: 'graph TD; A-->B' } }), () => new Promise((resolve) => void asked.push(resolve)));
    await until(() => asked.length > 0, 'the drawing asked for');
    e.view.dispatch(e.state.tr.setNodeAttribute(atPos(e, 'diagram'), 'source', ''));
    expect(view(e, 'diagram').textContent).toContain('Diagram');
    asked[0]('<svg data-obsolete=""></svg>');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(view(e, 'diagram').querySelector('svg')).toBeNull();
    expect(view(e, 'diagram').textContent).toContain('Diagram');
  });
});

// P3-F (sitting candidate 20): a drawing is themed by the page it is shown on (renderDiagram's contract), so it is made
// once its view is on the page, never while ProseMirror builds the view off the document, and made again when the
// page's palette changes after it (the page's system arriving as a scope's stylesheet after the page mounts, the app's
// fallbacks showing until it does; a live system restyling; the app's theme under a page without a system).
describe('a diagram on its page', () => {
  it('is drawn once on the page in its palette, and drawn again when the page’s palette changes', async () => {
    const calls: Array<{ connected: boolean; color: string; ground: string }> = [];
    const page = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'ds-doc' }));
    const system = document.head.appendChild(document.createElement('style'));
    system.textContent = '.ds-doc { color: rgb(240, 240, 240); background-color: rgb(20, 20, 20); }';
    const other = document.createElement('style');
    try {
      editor = new Editor({
        element: page.appendChild(document.createElement('div')),
        coreExtensionOptions,
        extensions: editorExtensions({
          collaboration: null,
          env: {
            artifactId: 'doc1',
            host,
            renderDiagram: async (_source, into) => {
              calls.push({ connected: into.isConnected, color: getComputedStyle(into).color, ground: getComputedStyle(into.closest('.ds-doc') ?? into).backgroundColor });
              return `<svg data-call="${calls.length}"></svg>`;
            },
          },
        }),
        content: doc({ type: 'diagram', attrs: { id: 'd1', source: 'graph TD; A-->B' } }),
      });
      const e = editor;
      await until(() => view(e, 'diagram').querySelector('svg[data-call="1"]') !== null, 'the first drawing');
      expect(calls).toEqual([{ connected: true, color: 'rgb(240, 240, 240)', ground: 'rgb(20, 20, 20)' }]);
      // the page's own system arrives after the drawing, light where the app's fallbacks were dark
      system.textContent = '.ds-doc { color: rgb(31, 30, 27); background-color: rgb(250, 249, 246); }';
      await until(() => view(e, 'diagram').querySelector('svg[data-call="2"]') !== null, 'the drawing in the page’s palette');
      expect(calls[1]).toEqual({ connected: true, color: 'rgb(31, 30, 27)', ground: 'rgb(250, 249, 246)' });
      // a stylesheet that leaves the page's palette as it is draws nothing again
      other.textContent = '.doc-unrelated { margin: 0; }';
      document.head.append(other);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls).toHaveLength(2);
    } finally {
      system.remove();
      other.remove();
      page.remove();
    }
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

// P3-F panel scalpel-3#2: a callout's tone and a Status chip are form controls the page draws; they follow the editor's
// editability both ways (setEditable redraws no unchanged node), so a read-only page (a version, the suggestion review,
// a read-only store) offers neither, and a page made writable offers both again
describe('the callout tone and the Status select', () => {
  const both = doc(
    { type: 'callout', attrs: { id: 'c1', tone: 'note' }, content: [para('p1', 'Heads up')] },
    { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'dropdown', attrs: { options: ['To do', 'Done'], value: 'To do' } }] },
  );
  const disabled = (e: Editor) => [view(e, 'callout').querySelector<HTMLSelectElement>('[aria-label="Callout tone"]')!.disabled, view(e, 'dropdown').querySelector('select')!.disabled];

  it('are off while the editor is read-only and on while it is editable, following each change', () => {
    const e = make(both);
    expect(disabled(e)).toEqual([false, false]);
    e.setEditable(false);
    expect(disabled(e), 'made read-only').toEqual([true, true]);
    e.setEditable(true);
    expect(disabled(e), 'made editable again').toEqual([false, false]);
  });

  it('opened read-only, are off, and on once the editor is made editable', () => {
    const e = make(both, drawn, false);
    expect(disabled(e)).toEqual([true, true]);
    e.setEditable(true);
    expect(disabled(e)).toEqual([false, false]);
    choose(view(e, 'dropdown').querySelector('select')!, 'Done');
    expect(attrsOf(e, 'dropdown').value).toBe('Done');
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

describe('leaving an atom’s field', () => {
  const leave = (e: Editor, type: string, label: string) => {
    select(e, type);
    view(e, type).querySelector(`[aria-label="${label}"]`)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };

  it('puts the caret in the text after a block atom, through a valid selection only', () => {
    const warn = vi.spyOn(console, 'warn');
    const e = make(doc({ type: 'pending', attrs: { id: 'x1', intent: 'Results' } }, para('p1', 'After')));
    leave(e, 'pending', 'Intent');
    expect(e.state.selection.empty).toBe(true);
    expect(e.state.selection.$head.parent.attrs.id).toBe('p1');
    expect(e.state.selection.$head.parentOffset).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('after the last block, leaves a valid selection without a warning', () => {
    const warn = vi.spyOn(console, 'warn');
    const e = make(doc({ type: 'pending', attrs: { id: 'x1', intent: 'Results' } }));
    leave(e, 'pending', 'Intent');
    expect(e.state.selection.$head.parent.inlineContent || e.state.selection instanceof NodeSelection).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  // P3-F (wave S review of c16): macOS Korean input confirms a composing syllable with Return as two keydowns about 1 ms
  // apart, the first composing (keyCode 229) and followed by compositionend, the second not (the owner's capture,
  // docs/doperpowers/evidence/p2-finish/owner-ime-capture-2026-10-12-events.txt:47-55). Only the second leaves the field,
  // so it never reaches the page as a Return of its own that splits the line after the atom.
  it('leaves on the Return that ends a composition, not the composing one, the line kept whole', () => {
    const e = make(doc({ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Ask ' }, { type: 'mention', attrs: { kind: 'person', ref: 'u1', label: '' } }, { type: 'text', text: ' now' }] }));
    select(e, 'mention');
    const field = view(e, 'mention').querySelector<HTMLInputElement>('[aria-label="Name"]')!;
    field.focus();
    typeInto(field, '홍길동');
    // each keydown goes where the keyboard is, as the browser sends it
    const enter = (init: KeyboardEventInit) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ...init }));
    enter({ keyCode: 229, isComposing: true });
    field.dispatchEvent(new CompositionEvent('compositionend', { data: '동', bubbles: true }));
    enter({ keyCode: 13, isComposing: false });
    expect(e.state.doc.childCount).toBe(1);
    expect(e.state.doc.child(0).textContent).toBe('Ask  now');
    expect(attrsOf(e, 'mention').label).toBe('홍길동');
    expect(document.activeElement).toBe(e.view.dom);
    expect(e.state.selection.empty && e.state.selection.from).toBe(atPos(e, 'mention') + 1);
  });

  it('puts the caret right after an inline atom', () => {
    const e = make(doc({ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Due ' }, { type: 'math', attrs: { latex: 'x' } }, { type: 'text', text: ' now' }] }));
    leave(e, 'math', 'LaTeX');
    expect(e.state.selection.empty).toBe(true);
    expect(e.state.selection.from).toBe(atPos(e, 'math') + 1);
  });
});

// P3-F (sitting candidate 16): a date chip's field keeps the chip. A date the field cannot read (a segment cleared)
// writes nothing, so the chip keeps its last date; Return commits what the field shows and Escape shows the chip's date
// again, each handing the caret back right after the chip, the key kept from the page (no split line) and from any
// surface around it
describe('a date chip’s field', () => {
  const dated = () => doc({ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Due ' }, { type: 'date', attrs: { iso: '2026-10-13' } }, { type: 'text', text: ' now' }] });
  const press = (field: HTMLElement, key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    field.dispatchEvent(event);
    return event;
  };
  const open = (e: Editor) => {
    select(e, 'date');
    const field = view(e, 'date').querySelector<HTMLInputElement>('[aria-label="Date"]')!;
    field.focus();
    return field;
  };

  it('keeps its last date through an entry it cannot read, and Escape shows that date again', () => {
    const e = make(dated());
    const around = vi.fn();
    document.body.addEventListener('keydown', around);
    try {
      const field = open(e);
      typeInto(field, '2026-11-02');
      typeInto(field, ''); // a segment cleared: the field reads no date
      expect(attrsOf(e, 'date').iso).toBe('2026-11-02');
      expect(view(e, 'date').querySelector('.doc-chip')!.textContent).toBe('Nov 2, 2026');
      expect(press(field, 'Escape').defaultPrevented).toBe(true);
      expect(field.value).toBe('2026-11-02');
      expect(attrsOf(e, 'date').iso).toBe('2026-11-02');
      expect(e.state.doc.childCount).toBe(1);
      expect(e.state.selection.empty && e.state.selection.from).toBe(atPos(e, 'date') + 1);
      expect(around).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener('keydown', around);
    }
  });

  it('commits the date the field shows on Return, the chip kept and the line whole', () => {
    const e = make(dated());
    const field = open(e);
    field.value = '2026-12-24'; // shown, its input event not yet delivered
    expect(press(field, 'Enter').defaultPrevented).toBe(true);
    expect(attrsOf(e, 'date').iso).toBe('2026-12-24');
    expect(e.state.doc.childCount).toBe(1);
    expect(e.state.doc.child(0).textContent).toBe('Due  now');
    expect(e.state.selection.empty && e.state.selection.from).toBe(atPos(e, 'date') + 1);
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

describe('table cells', () => {
  const emptyTable = (e: Editor) => e.schema.nodeFromJSON({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell' }, { type: 'tableCell' }] }] });
  const cellContents = (e: Editor) => {
    const out: number[] = [];
    e.state.doc.descendants((node) => {
      if (node.type.name === 'tableCell') out.push(node.childCount);
      return true;
    });
    return out;
  };

  it('a local change leaves no cell without a paragraph to type in; a remote write is left as it came', () => {
    const e = make(doc(para('p1', 'x')));
    e.view.dispatch(e.state.tr.insert(e.state.doc.content.size, emptyTable(e)).setMeta('y-sync-transaction', true));
    expect(cellContents(e)).toEqual([0, 0]);
    e.view.dispatch(e.state.tr.insert(e.state.doc.content.size, emptyTable(e)));
    expect(cellContents(e)).toEqual([0, 0, 1, 1]);
  });
});
