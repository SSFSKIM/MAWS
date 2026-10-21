// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Inspector"): the inspector over a replica, under
// happy-dom: each section writes through the dialect's checks (the loader's normal form in the model, a refused value
// shown with its reason and nothing written), tokens from the swatch row, rotation composed with the other transforms,
// the image's crop and replacement, shape kind, connector heads, table rows and columns, and a multi-selection's change
// as one undo step.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newDoc, onUpdate, transact, type Doc } from '../../yjs';
import { importSlide, readSlide, slideFile, writeDeckKeys, ROOT } from '../model';
import { loadSlide } from '../parse';
import { restyle, siteOf } from '../writers-elements';
import { SlideCanvas } from '../canvas';
import { Inspector } from './Inspector';
import { DeckSession } from './session';
import { startMove, startResize, type GestureContext } from './transform/gestures';
import { measureInHost } from './transform/Overlay';

const SLIDE = `<section id="a" style="background:#ffffff">
<h2 id="title" style="font-size:64px">Title</h2>
<p id="note" style="position:absolute; left:100px; top:200px; width:400px; font-size:32px; transform:translate(10px, 20px)">Text</p>
<div id="box" style="position:absolute; left:600px; top:100px; width:300px; height:200px; background:#eeeeee"></div>
<div id="box2" style="position:absolute; left:1000px; top:100px; width:300px; height:200px; background:#dddddd"></div>
<img id="pic" src="assets/a.png" alt="A cat" style="position:absolute; left:100px; top:500px; width:640px; height:360px; object-fit:cover">
<x-shape id="shape" kind="rect" style="position:absolute; left:900px; top:500px; width:300px; height:200px; background:#c9663f; border-radius:12px"></x-shape>
<x-icon id="icon" name="Star" style="position:absolute; left:1300px; top:500px; width:96px; height:96px; color:#000000"></x-icon>
<x-connector id="link" x1="100" y1="900" x2="500" y2="950" head="end" route="elbow" style="color:#000000; border-width:4px"></x-connector>
<table id="tbl" style="position:absolute; left:1200px; top:700px; width:600px; font-size:28px"><tr id="r1"><th>A</th><th>B</th></tr><tr id="r2"><td>1</td><td>2</td></tr></table>
</section>`;

function deck(slide = SLIDE): Doc {
  const doc = newDoc();
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'Q3', order: ['a'], faces: { lora: { family: 'Lora' } } });
    const l = loadSlide(slide);
    if (!l.ok) throw new Error(`fixture: ${l.held.reasons.join('; ')}`);
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

afterEach(cleanup);

type Measure = (id: string) => { x: number; y: number; w: number; h: number } | null;
function mount(selection: string[] = [], options: { readOnly?: boolean; uploadAsset?: (file: File) => Promise<string>; measure?: Measure; slide?: string } = {}) {
  const doc = deck(options.slide);
  const session = new DeckSession(doc);
  session.select(selection);
  const utils = render(
    <Inspector session={session} slideId="a" readOnly={options.readOnly ?? false} faces={{ lora: { family: 'Lora' } }} uploadAsset={options.uploadAsset} measure={options.measure} />,
  );
  return { doc, session, ...utils };
}

const styleOf = (doc: Doc, id: string) => siteOf(doc, 'a', id).style;
const attrsOf = (doc: Doc, id: string) => siteOf(doc, 'a', id).site.attrs;
const box = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
const combo = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement;
const type = (name: string, value: string) => fireEvent.change(box(name), { target: { value } });
const enter = (name: string, value: string) => {
  type(name, value);
  fireEvent.keyDown(box(name), { key: 'Enter' });
};
const choose = (name: string, value: string) => fireEvent.change(combo(name), { target: { value } });
/** The slide's file loads back through the loader with no warning: the inspector wrote only what the loader accepts. */
function loadsClean(doc: Doc) {
  const loaded = loadSlide(slideFile(doc, 'a'));
  expect(loaded.ok).toBe(true);
  expect(loaded.diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
}

describe('the inspector', () => {
  it('nothing selected: the slide, its fill typed into the model in the loader’s form', () => {
    const { doc } = mount();
    const panel = screen.getByRole('complementary', { name: 'Inspector' });
    expect(panel.classList.contains('deck-inspector')).toBe(true);
    expect(box('Fill colour').value).toBe('#ffffff');
    type('Fill colour', 'rgb(0,0,255)');
    expect(styleOf(doc, ROOT).background).toBe('#0000ff');
    expect(screen.queryByRole('textbox', { name: 'X' })).toBeNull();
    loadsClean(doc);
  });

  it('a fill colour typed on an element is normalized; a swatch writes the system’s token and the field names it', () => {
    const { doc } = mount(['box']);
    type('Fill colour', 'rgb(0,0,255)');
    expect(styleOf(doc, 'box').background).toBe('#0000ff');
    fireEvent.click(within(screen.getByRole('group', { name: 'Fill colour swatches' })).getByRole('button', { name: 'Accent' }));
    expect(styleOf(doc, 'box').background).toMatch(/^var\(--ds-color-accent, #[0-9a-f]{6}\)$/);
    expect(box('Fill colour').value).toBe('Accent');
    loadsClean(doc);
  });

  it('a linear gradient: angle and stops, a stop added and removed', () => {
    const { doc } = mount(['box']);
    choose('Fill', 'gradient');
    expect(styleOf(doc, 'box').background).toMatch(/^linear-gradient\(180deg, #eeeeee 0%, .+ 100%\)$/);
    enter('Gradient angle', '90');
    expect(styleOf(doc, 'box').background).toMatch(/^linear-gradient\(90deg, /);
    fireEvent.click(screen.getByRole('button', { name: 'Add stop' }));
    expect(styleOf(doc, 'box').background.match(/%/g)).toHaveLength(3);
    type('Stop 2 colour', 'red');
    expect(styleOf(doc, 'box').background).toContain('red 50%');
    fireEvent.click(screen.getByRole('button', { name: 'Remove stop 2' }));
    expect(styleOf(doc, 'box').background.match(/%/g)).toHaveLength(2);
    loadsClean(doc);
  });

  it('a shape takes a flat fill only', () => {
    mount(['shape']);
    expect([...combo('Fill').options].map((o) => o.value)).not.toContain('gradient');
  });

  it('a border built from width, style and colour as one value', () => {
    const { doc } = mount(['box']);
    enter('Border width', '4');
    expect(styleOf(doc, 'box').border).toMatch(/^4px solid /);
    choose('Border style', 'dashed');
    expect(styleOf(doc, 'box').border).toMatch(/^4px dashed /);
    type('Border colour', 'red');
    expect(styleOf(doc, 'box').border).toBe('4px dashed red');
    enter('Corner radius', '16');
    expect(styleOf(doc, 'box')['border-radius']).toBe('16px');
    loadsClean(doc);
  });

  it('a shadow from x, y, blur and colour', () => {
    const { doc } = mount(['box']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shadow' }));
    expect(styleOf(doc, 'box')['box-shadow']).toBeDefined();
    enter('Shadow X', '6');
    enter('Shadow Y', '12');
    enter('Shadow blur', '30');
    type('Shadow colour', 'black');
    expect(styleOf(doc, 'box')['box-shadow']).toBe('6px 12px 30px black');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shadow' }));
    expect(styleOf(doc, 'box')['box-shadow']).toBeUndefined();
    loadsClean(doc);
  });

  it('a font size, a family (a basic face, a deck face, a system role) and the text fit', () => {
    const { doc } = mount(['note']);
    enter('Font size', '48');
    expect(styleOf(doc, 'note')['font-size']).toBe('48px');
    choose('Font', [...combo('Font').options].find((o) => o.text === 'Georgia')!.value);
    expect(styleOf(doc, 'note')['font-family']).toBe('Georgia, serif');
    choose('Font', [...combo('Font').options].find((o) => o.text === 'Lora')!.value);
    expect(styleOf(doc, 'note')['font-family']).toMatch(/^Lora, /);
    choose('Font', [...combo('Font').options].find((o) => o.text.startsWith('Body'))!.value);
    expect(styleOf(doc, 'note')['font-family']).toMatch(/^var\(--ds-font-body, .+\)$/);
    choose('Font weight', '700');
    expect(styleOf(doc, 'note')['font-weight']).toBe('700');
    fireEvent.click(screen.getByRole('button', { name: 'Align center' }));
    expect(styleOf(doc, 'note')['text-align']).toBe('center');
    choose('Text fit', 'grow');
    expect(attrsOf(doc, 'note')['data-fit']).toBe('grow');
    choose('Text fit', '');
    expect(attrsOf(doc, 'note')['data-fit']).toBeUndefined();
    loadsClean(doc);
  });

  it('an out-of-range value is refused with its reason, nothing written, the typed text kept until blurred', () => {
    const { doc } = mount(['note']);
    enter('Font size', '500');
    expect(screen.getByRole('alert').textContent).toMatch(/8–400/);
    expect(box('Font size').getAttribute('aria-invalid')).toBe('true');
    expect(box('Font size').value).toBe('500');
    expect(styleOf(doc, 'note')['font-size']).toBe('32px');
    loadsClean(doc);
    fireEvent.blur(box('Font size'));
    expect(box('Font size').value).toBe('32');
    expect(screen.queryByRole('alert')).toBeNull();
    enter('Opacity', '2');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(styleOf(doc, 'note').opacity).toBeUndefined();
  });

  it('rotation composes with the element’s translate; arrow keys step it, Shift by ten', () => {
    const { doc } = mount(['note']);
    enter('Rotation', '30');
    expect(styleOf(doc, 'note').transform).toBe('translate(10px, 20px) rotate(30deg)');
    fireEvent.keyDown(box('Rotation'), { key: 'ArrowUp' });
    expect(styleOf(doc, 'note').transform).toBe('translate(10px, 20px) rotate(31deg)');
    fireEvent.keyDown(box('Rotation'), { key: 'ArrowUp', shiftKey: true });
    expect(styleOf(doc, 'note').transform).toBe('translate(10px, 20px) rotate(41deg)');
    enter('Rotation', '0');
    expect(styleOf(doc, 'note').transform).toBe('translate(10px, 20px)');
  });

  it('position and size in px on a pinned element; a flow child shows size only', () => {
    const { doc } = mount(['box']);
    expect(box('X').value).toBe('600');
    enter('X', '120');
    enter('Y', '80');
    enter('Width', '500');
    enter('Height', '250');
    expect(styleOf(doc, 'box')).toMatchObject({ left: '120px', top: '80px', width: '500px', height: '250px' });
    cleanup();
    const flow = mount(['title'], { measure: () => ({ x: 128, y: 96, w: 1664, h: 74 }) });
    expect(screen.queryByRole('textbox', { name: 'X' })).toBeNull();
    expect(box('Width').value).toBe('1664'); // no width in its style: the laid-out box
    enter('Width', '900');
    expect(styleOf(flow.doc, 'title').width).toBe('900px');
  });

  it('an image: fit, crop (zoom and focus, reset), alt text and a replacement through the upload', async () => {
    const uploadAsset = vi.fn(async () => 'assets/b.png');
    const { doc } = mount(['pic'], { uploadAsset });
    choose('Image fit', 'contain');
    expect(styleOf(doc, 'pic')['object-fit']).toBe('contain');
    enter('Crop zoom', '2');
    expect(attrsOf(doc, 'pic')['data-crop']).toBe('2 50% 50%');
    enter('Crop X', '30');
    expect(attrsOf(doc, 'pic')['data-crop']).toBe('2 30% 50%');
    enter('Crop zoom', '60');
    expect(screen.getByRole('alert').textContent).toMatch(/1 to 50/);
    expect(attrsOf(doc, 'pic')['data-crop']).toBe('2 30% 50%');
    fireEvent.click(screen.getByRole('button', { name: 'Reset crop' }));
    expect(attrsOf(doc, 'pic')['data-crop']).toBeUndefined();
    type('Alt text', 'A dog');
    expect(attrsOf(doc, 'pic').alt).toBe('A dog');
    expect(screen.getByRole('button', { name: 'Replace image' })).toBeTruthy();
    const file = new File(['x'], 'b.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [file] } });
    });
    expect(uploadAsset).toHaveBeenCalledWith(file);
    expect(attrsOf(doc, 'pic').src).toBe('assets/b.png');
    loadsClean(doc);
  });

  it('no upload: no Replace image', () => {
    mount(['pic']);
    expect(screen.queryByRole('button', { name: 'Replace image' })).toBeNull();
  });

  it('a shape’s kind; leaving rect drops the radius only a rect takes', () => {
    const { doc } = mount(['shape']);
    expect(combo('Shape').value).toBe('rect');
    choose('Shape', 'ellipse');
    expect(attrsOf(doc, 'shape').kind).toBe('ellipse');
    expect(styleOf(doc, 'shape')['border-radius']).toBeUndefined();
    loadsClean(doc);
  });

  it('an icon’s name and colour', () => {
    const { doc } = mount(['icon']);
    choose('Icon', 'Lightbulb');
    expect(attrsOf(doc, 'icon').name).toBe('Lightbulb');
    type('Icon colour', '#ff0000');
    expect(styleOf(doc, 'icon').color).toBe('#ff0000');
  });

  it('a connector’s heads replace the shorthand; route, colour, line width and style', () => {
    const { doc } = mount(['link']);
    expect(combo('Start head').value).toBe('none');
    expect(combo('End head').value).toBe('filled');
    choose('Start head', 'open');
    expect(attrsOf(doc, 'link')).toMatchObject({ 'head-start': 'open', 'head-end': 'filled' });
    expect(attrsOf(doc, 'link').head).toBeUndefined();
    choose('Route', 'hv');
    expect(attrsOf(doc, 'link').route).toBe('hv');
    enter('Line width', '6');
    expect(styleOf(doc, 'link')['border-width']).toBe('6px');
    choose('Line style', 'dashed');
    expect(styleOf(doc, 'link')['border-style']).toBe('dashed');
    type('Line colour', 'blue');
    expect(styleOf(doc, 'link').color).toBe('blue');
    expect(screen.queryByRole('textbox', { name: 'Rotation' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'X' })).toBeNull();
    loadsClean(doc);
  });

  it('a table’s rows and columns added and removed', () => {
    const { doc } = mount(['tbl']);
    const table = () => readSlide(doc, 'a').children.find((c) => c.id === 'tbl')!;
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    expect(table().children).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Remove row' }));
    expect(table().children).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    expect(table().children.map((r) => r.children.length)).toEqual([3, 3]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove column' }));
    expect(table().children.map((r) => r.children.length)).toEqual([2, 2]);
    loadsClean(doc);
  });

  it('a row selected: its table’s rows and columns', () => {
    const { doc } = mount(['r1']);
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    const rows = readSlide(doc, 'a').children.find((c) => c.id === 'tbl')!.children;
    expect(rows).toHaveLength(3);
    expect(rows[0]!.id).toBe('r1'); // the new row follows the selected one
    expect(rows[2]!.id).toBe('r2');
  });

  it('several selected: the shared sections, a change written to each as one undo step', () => {
    const { doc, session } = mount(['box', 'box2']);
    expect(box('Fill colour').value).toBe('');
    expect(box('Fill colour').placeholder).toBe('Mixed');
    let updates = 0;
    const off = onUpdate(doc, () => updates++);
    type('Fill colour', 'red');
    off();
    expect(updates).toBe(1); // one gesture, one transaction (fix wave 1)
    expect([styleOf(doc, 'box').background, styleOf(doc, 'box2').background]).toEqual(['red', 'red']);
    act(() => session.undoStep());
    expect([styleOf(doc, 'box').background, styleOf(doc, 'box2').background]).toEqual(['#eeeeee', '#dddddd']);
    cleanup();
    mount(['box', 'pic']);
    expect(screen.queryByRole('combobox', { name: 'Image fit' })).toBeNull();
    expect(box('Fill colour')).toBeTruthy();
  });

  it('read-only: every control disabled', () => {
    mount(['box'], { readOnly: true });
    const panel = screen.getByRole('complementary', { name: 'Inspector' });
    const controls = panel.querySelectorAll('input, select, button');
    expect(controls.length).toBeGreaterThan(5);
    for (const c of controls) expect((c as HTMLInputElement).disabled).toBe(true);
  });

  it('a remote change re-renders the fields', () => {
    const { doc } = mount(['box']);
    expect(box('Fill colour').value).toBe('#eeeeee');
    act(() => void restyle(doc, 'a', 'box', { background: '#123456' }, 'remote'));
    expect(box('Fill colour').value).toBe('#123456');
  });

  // P4-R9: as the app ships, under the React Compiler (the artifacts-dom-compiled project), the fields once kept the
  // values they opened with, whoever wrote: the panel itself, the stage, an undo or an agent
  it('the fields follow every write: the panel’s own, the stage’s, an undo', () => {
    const { doc, session } = mount(['note']);
    enter('X', '150');
    expect(box('X').value).toBe('150');
    act(() => session.edit((origin) => void restyle(doc, 'a', 'note', { left: '300px' }, origin))); // a drag on the stage
    expect(box('X').value).toBe('300');
    act(() => session.undoStep());
    expect(box('X').value).toBe('150');
  });
});

// W1 (tech debt, 2026-10-19): the panel names what it edits as the toolbar does, and a token by its friendly name
describe('names: the element by its type class, a token by the name its role goes by', () => {
  const ROLES = `<section id="a">
<h1 id="head" style="font-family:var(--ds-font-display); font-size:var(--ds-type-title-size); line-height:var(--ds-type-title-line); font-weight:var(--ds-type-title-weight)">Q3</h1>
<h1 id="plain" style="font-size:64px">Plain</h1>
<div id="grp" data-group="" style="position:absolute; left:100px; top:400px; width:400px; height:200px; border-radius:var(--ds-radius-md)"><p id="in" style="position:absolute; left:0px; top:0px; width:200px">In</p></div>
<div id="card" style="position:absolute; left:600px; top:400px; width:300px; height:200px"></div>
</section>`;
  const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
  const shown = (name: string) => combo(name).selectedOptions[0]!;

  it('a text element by its type class, as the Text style menu names it; the tag where it has none', () => {
    mount(['head'], { slide: ROLES });
    expect(heading()).toBe('Title');
    cleanup();
    mount(['plain'], { slide: ROLES });
    expect(heading()).toBe('Heading 1');
  });

  it('a group as a group, any other box by its tag', () => {
    mount(['grp'], { slide: ROLES });
    expect(heading()).toBe('Group');
    cleanup();
    mount(['card'], { slide: ROLES });
    expect(heading()).toBe('Box');
  });

  it('token fields show the friendly name, the token’s own name in the title, as the swatches do', () => {
    mount(['head'], { slide: ROLES });
    expect(box('Font size').placeholder).toBe('Title');
    expect(box('Font size').title).toBe('Title (--ds-type-title-size)');
    expect(box('Line height').placeholder).toBe('Title');
    expect(shown('Font weight').text).toBe('Title');
    expect(shown('Font weight').title).toBe('Title (--ds-type-title-weight)');
    expect(shown('Font').text).toBe('Display (system)');
    const panel = screen.getByRole('complementary', { name: 'Inspector' });
    const words = [...panel.querySelectorAll('input, option, h2, h3, span, p')].map((e) => `${e.textContent ?? ''} ${(e as HTMLInputElement).placeholder ?? ''}`);
    expect(words.filter((w) => w.includes('--ds-'))).toEqual([]);
    cleanup();
    mount(['grp'], { slide: ROLES });
    expect(box('Corner radius').placeholder).toBe('Medium');
    expect(box('Corner radius').title).toBe('Medium (--ds-radius-md)');
  });
});

describe('fix wave 1: a shadow the canvas cannot draw is never offered', () => {
  it('inset and spread are offered on a box, and held off on a shape that is not a rect, with the reason', async () => {
    const { setAttrsOf } = await import('../writers-elements');
    const { doc } = mount(['box']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shadow' }));
    expect((screen.getByRole('checkbox', { name: 'Inset shadow' }) as HTMLInputElement).disabled).toBe(false);
    enter('Shadow spread', '4');
    expect(styleOf(doc, 'box')['box-shadow']).toMatch(/^0px 8px 24px 4px /);
    cleanup();
    const shape = mount(['shape']);
    act(() => setAttrsOf(shape.doc, 'a', { shape: { kind: 'ellipse' } }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shadow' }));
    expect((screen.getByRole('checkbox', { name: 'Inset shadow' }) as HTMLInputElement).disabled).toBe(true);
    expect(box('Shadow spread').disabled).toBe(true);
    expect(screen.getByText(/drawn from its outline/)).toBeTruthy();
  });
});

describe('fix wave 3: a transform that is a design-system token', () => {
  it('holds the rotation off with the reason, and Detach writes the token’s own value, which reloads clean', async () => {
    const { setStyles } = await import('../writers-elements');
    const { doc } = mount(['box']);
    act(() => setStyles(doc, 'a', { box: { transform: 'var(--ds-pose, scale(1.5))' } }));
    expect(box('Rotation').disabled).toBe(true);
    expect(screen.getByText(/design-system token/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Detach transform' }));
    expect(styleOf(doc, 'box').transform).toBe('scale(1.5)');
    expect(box('Rotation').disabled).toBe(false);
    const reloaded = loadSlide(slideFile(doc, 'a'), { fileId: 'a' });
    expect(reloaded.ok && reloaded.diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
  });

  // M6 (M5's review, Minor): the note says what Detach does, and never points at a button it does not show
  it('says Detach replaces the token with its fallback value, and with no fallback offers no Detach and asks for none', async () => {
    const { setStyles } = await import('../writers-elements');
    const { doc } = mount(['box']);
    act(() => setStyles(doc, 'a', { box: { transform: 'var(--ds-pose, scale(1.5))' } }));
    expect(screen.getByText(/Detach transform replaces the token with its fallback value, scale\(1\.5\)/)).toBeTruthy();
    act(() => setStyles(doc, 'a', { box: { transform: 'var(--ds-pose)' } }));
    expect(screen.queryByRole('button', { name: 'Detach transform' })).toBeNull();
    const note = screen.getByText(/design-system token/).textContent!;
    expect(note).toMatch(/no fallback value/);
    expect(note).not.toMatch(/[Dd]etach/);
  });
});

// final fix wave (B4): Replace's upload is an awaited edit; one finishing after the tab closed writes nothing
describe('final fix wave B4: a replacement finishing after the tab closed', () => {
  it('writes nothing into the disposed session', async () => {
    let finish!: (ref: string) => void;
    const uploadAsset = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const { doc, session, unmount } = mount(['pic'], { uploadAsset });
    fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [new File(['x'], 'b.png', { type: 'image/png' })] } });
    expect(uploadAsset).toHaveBeenCalled();
    unmount();
    session.dispose();
    await act(async () => finish('assets/b.png'));
    expect(attrsOf(doc, 'pic').src).toBe('assets/a.png');
  });
});

// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D13; tracker row 280): the inspector follows every
// gesture's end, not its frames, and shows X, Y, W and H in whole pixels while the model keeps its fractions. The
// gestures are the stage's own (gestures.ts), over a canvas laid out as each node's px style says (happy-dom lays
// nothing out); both artifacts DOM projects run these, the compiled one as the app ships.
describe('P4-B2 (D13): the inspector settles at each gesture’s end, in whole pixels', () => {
  const canvases: SlideCanvas[] = [];
  afterEach(() => {
    canvases.splice(0).forEach((c) => c.dispose());
    document.body.replaceChildren();
  });
  /** Each node's box as its own px style says it, read live (a flow node's from `flow`, which a test may change). */
  function fakeLayout(root: HTMLElement, flow: Record<string, { x: number; y: number; w: number; h: number }>) {
    for (const n of root.querySelectorAll<HTMLElement>('[data-eid]')) {
      const id = n.dataset.eid!;
      const v = (k: string) => Number.parseFloat(n.style.getPropertyValue(k)) || 0;
      const box = () => flow[id] ?? { x: v('left'), y: v('top'), w: v('width'), h: v('height') };
      for (const [k, read] of [['offsetLeft', () => box().x], ['offsetTop', () => box().y], ['offsetWidth', () => box().w], ['offsetHeight', () => box().h]] as const)
        Object.defineProperty(n, k, { configurable: true, get: read });
      Object.defineProperty(n, 'offsetParent', { configurable: true, get: () => root });
    }
  }
  function mountLive(selection: string[], slide?: string) {
    const doc = deck(slide);
    const session = new DeckSession(doc);
    session.select(selection);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const canvas = new SlideCanvas(doc, 'a', host);
    canvases.push(canvas);
    const flow = { title: { x: 128, y: 96, w: 1664, h: 74 } };
    fakeLayout(canvas.root, flow);
    render(<Inspector session={session} slideId="a" readOnly={false} faces={{}} canvas={canvas} measure={(id) => measureInHost(canvas, id, 1)} />);
    const ctx: GestureContext = { session, slideId: 'a', canvas, scale: 1 };
    return { doc, session, canvas, ctx, flow };
  }
  const NO = { shift: false, alt: false, meta: true }; // ⌘: no snapping

  it('a move: X holds during its frames and shows the new whole number at its end; a cancel shows the model’s value then', () => {
    const { doc, ctx } = mountLive(['box']);
    expect(box('X').value).toBe('600');
    const g = startMove(ctx, ['box'], { x: 700, y: 200 });
    act(() => void g.frame({ x: 712, y: 200 }, NO));
    act(() => void g.frame({ x: 745, y: 207 }, NO));
    expect(styleOf(doc, 'box').left).toBe('645px'); // written each frame
    expect([box('X').value, box('Y').value]).toEqual(['600', '100']); // the inspector holds
    act(() => g.end());
    expect([box('X').value, box('Y').value]).toEqual(['645', '107']);
    const cancelled = startMove(ctx, ['box'], { x: 700, y: 200 });
    act(() => void cancelled.frame({ x: 690, y: 200 }, NO));
    expect(box('X').value).toBe('645');
    act(() => cancelled.end(false)); // P3's cancel keeps what its frames wrote (no rollback): the model's value at the cancel
    expect(box('X').value).toBe('635');
  });

  it('a resize: W holds during its frames and shows the whole width at its end, the model keeping the fraction', () => {
    const { doc, ctx } = mountLive(['box']);
    const g = startResize(ctx, 'box', 'e', { x: 900, y: 200 });
    act(() => void g.frame({ x: 934.73, y: 200 }, NO));
    expect(styleOf(doc, 'box').width).toBe('334.73px');
    expect(box('Width').value).toBe('300');
    act(() => g.end());
    expect(box('Width').value).toBe('335');
    expect(styleOf(doc, 'box').width).toBe('334.73px');
  });

  it('1334.73 reads 1335; an untouched Enter writes nothing; the arrows step from the model’s value', () => {
    const { doc } = mountLive(['box']);
    act(() => void restyle(doc, 'a', 'box', { left: '1334.73px' }, 'remote'));
    expect(box('X').value).toBe('1335');
    let updates = 0;
    const off = onUpdate(doc, () => updates++);
    fireEvent.keyDown(box('X'), { key: 'Enter' });
    expect(updates).toBe(0);
    off();
    fireEvent.keyDown(box('X'), { key: 'ArrowUp' });
    expect(styleOf(doc, 'box').left).toBe('1335.73px');
    expect(box('X').value).toBe('1336');
  });

  it('“Mixed” compares the whole values shown', () => {
    const { doc } = mountLive(['box', 'box2']);
    act(() => void restyle(doc, 'a', 'box2', { top: '100.3px' }, 'remote'));
    expect([box('Y').value, box('Y').placeholder]).toEqual(['100', '']);
    act(() => void restyle(doc, 'a', 'box2', { top: '100.6px' }, 'remote'));
    expect([box('Y').value, box('Y').placeholder]).toEqual(['', 'Mixed']);
  });

  it('a layout pass alone (no update of the replica) updates a laid-out width', () => {
    const { canvas, flow } = mountLive(['title']);
    expect(box('Width').value).toBe('1664');
    flow.title = { ...flow.title, w: 1500.4 }; // a face arrived: the heading lays out narrower, nothing written
    act(() => canvas.layoutNow());
    expect(box('Width').value).toBe('1500');
  });
});
