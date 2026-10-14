// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Inspector"): the inspector over a replica, under
// happy-dom: each section writes through the dialect's checks (the loader's normal form in the model, a refused value
// shown with its reason and nothing written), tokens from the swatch row, rotation composed with the other transforms,
// the image's crop and replacement, shape kind, connector heads, table rows and columns, and a multi-selection's change
// as one undo step.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newDoc, transact, type Doc } from '../../yjs';
import { importSlide, readSlide, slideFile, writeDeckKeys, ROOT } from '../model';
import { loadSlide } from '../parse';
import { restyle, siteOf } from '../writers-elements';
import { Inspector } from './Inspector';
import { DeckSession } from './session';

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

function deck(): Doc {
  const doc = newDoc();
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'Q3', order: ['a'], faces: { lora: { family: 'Lora' } } });
    const l = loadSlide(SLIDE);
    if (!l.ok) throw new Error(`fixture: ${l.held.reasons.join('; ')}`);
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

afterEach(cleanup);

type Measure = (id: string) => { x: number; y: number; w: number; h: number } | null;
function mount(selection: string[] = [], options: { readOnly?: boolean; uploadAsset?: (file: File) => Promise<string>; measure?: Measure } = {}) {
  const doc = deck();
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
    type('Fill colour', 'red');
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
});
