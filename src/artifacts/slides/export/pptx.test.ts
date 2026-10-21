// P3-C M9 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "PPTX"; Acceptance 6): the measured deck mapped
// to pptxgenjs's objects (positions in inches at 1 px = 0.5 pt, runs, names, notes, hidden, transitions, the font
// variants, the pictures the window takes), then written: shapes named by element ids, the notes, the hidden slide, the
// transitions and the design system's theme part in the package.
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { officeThemeXml } from '../../design-system/office';
import { builtinView } from '../../design-system/view';
import { fixtureDoc, MEASURED } from './deck.test-support';
import { inches, parseColor, pictureJobs, pictureKey, points, pptxSlides, writePptx, type PptxObject } from './pptx';
import type { MeasuredElement } from './measure';
import { exportDeckOf } from './standalone';

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const deck = () => exportDeckOf(fixtureDoc(), 'Untitled');
const asset = (ref: string) => (ref === 'assets/logo.png' ? LOGO : null);
const named = (objects: PptxObject[], name: string) => objects.find((o) => o.name === name)!;

describe('the PPTX mapping', () => {
  it('converts px to inches and points, and computed colours to hex and transparency', () => {
    expect(inches(1920)).toBeCloseTo(13.3333, 4);
    expect(inches(1080)).toBe(7.5);
    expect(points(96)).toBe(48);
    expect(parseColor('rgb(18, 52, 86)')).toEqual({ hex: '123456', alpha: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.25)')).toEqual({ hex: '000000', alpha: 0.25 });
    expect(parseColor('#abc')).toEqual({ hex: 'AABBCC', alpha: 1 });
    expect(parseColor('transparent')).toBeNull();
  });

  it('lists the pictures the window takes: embeds, svg and icon fallbacks, gradients; every slide for pictures', () => {
    const jobs = pictureJobs(MEASURED, 'named');
    expect(jobs.map((j) => [j.key, j.mode])).toEqual([
      ['body/star', 'tree'],
      ['body/chart', 'tree'],
      ['body/live', 'tree'],
    ]);
    expect(pictureJobs(MEASURED, 'pictures').map((j) => [j.key, j.mode])).toEqual([
      ['cover', 'slide'],
      ['body', 'slide'],
      ['gone', 'slide'],
    ]);
  });

  it('maps each element to its native object at its measured place, named by its id', () => {
    const pictures = new Map([[pictureKey('body', 'star'), PNG], [pictureKey('body', 'chart'), PNG], [pictureKey('body', 'live'), PNG]]);
    const [cover, body, gone] = pptxSlides(deck(), MEASURED, { variant: 'named', pictures, asset });
    expect([cover!.transition, body!.transition, gone!.transition]).toEqual(['fade', 'push', null]);
    expect([cover!.hidden, gone!.hidden]).toEqual([false, true]);
    expect(cover!.notes).toBe('Open with the numbers.');
    expect(cover!.background).toEqual({ color: 'FFFFFF' });

    const title = named(cover!.objects, 'title');
    expect(title.kind).toBe('text');
    if (title.kind !== 'text') return;
    expect(title.options).toMatchObject({ objectName: 'title', x: inches(128), y: inches(128), w: inches(1664), h: inches(106), fit: 'none', margin: [0, 0, 0, 0], wrap: false }); // one line in the app: never wrapped
    expect(title.text.map((r) => [r.text, r.options?.fontSize, r.options?.bold, r.options?.color, r.options?.fontFace, r.options?.lineSpacing])).toEqual([
      ['Quarterly ', 48, true, '123456', 'Helvetica Neue', 52.8],
      ['review', 48, true, '123456', 'Helvetica Neue', undefined], // the paragraph's properties on its first run
    ]);
    // the fitted size is the size written
    const sub = named(cover!.objects, 'sub');
    expect(sub.kind === 'text' && sub.text[0]!.options?.fontSize).toBe(18);
    expect(sub.kind === 'text' && sub.text[0]!.options?.fontFace).toBe('Brand Sans');
    const logo = named(cover!.objects, 'logo');
    expect(logo).toMatchObject({ kind: 'image', options: { data: LOGO, objectName: 'logo', altText: 'Logo', x: inches(1600), y: inches(64), w: inches(200), h: inches(100) } });

    const badge = named(body!.objects, 'badge');
    expect(badge).toMatchObject({ kind: 'shape', shape: 'ellipse', options: { fill: { color: '2B7A78', transparency: 0 }, line: { color: '0F2A3D', width: 2, dashType: 'solid' } } });
    const link = named(body!.objects, 'link');
    expect(link).toMatchObject({ kind: 'shape', shape: 'line', options: { x: inches(300), y: inches(150), w: inches(300), h: 0, line: { width: 1, endArrowType: 'triangle', beginArrowType: 'none', color: '000000' } } });
    const star = named(body!.objects, 'star');
    expect(star.kind === 'image' && star.options.data?.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(star.kind === 'image' && star.fallback).toBe(PNG);
    expect(named(body!.objects, 'live')).toMatchObject({ kind: 'image', options: { data: PNG, x: inches(1200), y: inches(600) } });
    const points_ = named(body!.objects, 'points');
    expect(points_.kind === 'text' && points_.text.map((r) => [r.text, r.options?.bullet, r.options?.breakLine, r.options?.hyperlink?.url, r.options?.underline])).toEqual([
      ['One ', { indent: 22.5 }, undefined, undefined, undefined],
      ['link', undefined, true, 'https://example.com/', { style: 'sng' }],
      ['Two', { indent: 22.5 }, undefined, undefined, undefined],
    ]);
    expect(points_.kind === 'text' && [points_.options.margin, points_.options.wrap]).toEqual([[0, 0, 0, 0], true]);
    const grid = named(body!.objects, 'grid');
    expect(grid.kind).toBe('table');
    if (grid.kind !== 'table') return;
    expect(grid.options).toMatchObject({ objectName: 'grid', colW: [inches(200), inches(200)], rowH: [inches(60), inches(60)] });
    expect(grid.rows.map((row) => row.map((cell) => [(cell.text as { text: string }[])[0]!.text, cell.options?.fill?.color]))).toEqual([
      [['Region', 'EEF2F1'], ['Q1', 'EEF2F1']],
      [['North', undefined], ['12', undefined]],
    ]);
    expect(grid.rows[0]![0]!.options?.margin).toEqual([6, 8, 6, 8]);
  });

  it('crops a picture to the owner’s region under its own fit, and lets a shape’s outline cast its shadow', () => {
    const cover = MEASURED.slides[0]!;
    const logo = cover.elements.find((e) => e.id === 'logo')!;
    const cropped = { ...logo, attrs: { ...logo.attrs, 'data-crop': '2 25% 50%' }, image: { ...logo.image!, natural: { w: 400, h: 200 }, fit: 'fill' } };
    const badge = MEASURED.slides[1]!.elements.find((e) => e.id === 'badge')!;
    const shadowed = { ...badge, shape: { ...badge.shape!, shadow: { x: 0, y: 8, blur: 24, color: 'rgba(0, 0, 0, 0.25)' } } };
    const measured = { slides: [{ ...cover, elements: [cropped] }, { ...MEASURED.slides[1]!, elements: [shadowed] }, MEASURED.slides[2]!] };
    const [first, second] = pptxSlides(deck(), measured, { variant: 'named', pictures: new Map(), asset });
    // the region (x 50, y 50, 200 × 100 of the picture) fills the 200 × 100 box: the whole picture at scale 1, cropped
    expect(named(first!.objects, 'logo')).toMatchObject({ options: { x: inches(1600), y: inches(64), w: inches(400), h: inches(200), sizing: { type: 'crop', x: inches(50), y: inches(50), w: inches(200), h: inches(100) } } });
    expect(named(second!.objects, 'badge')).toMatchObject({ options: { shadow: { type: 'outer', blur: 12, offset: 4, angle: 90, color: '000000', opacity: 0.25 } } });
  });

  // fix wave 1 (finding 1): an element drawn under a scale (its own or its ancestors') exports at the size it is seen
  it('writes a scaled element’s text, insets, line spacing and paint at their drawn size', () => {
    const cover = MEASURED.slides[0]!;
    const title = cover.elements.find((e) => e.id === 'title')!;
    const scaled = {
      ...title,
      scale: [2, 1.5] as [number, number],
      paint: { ...title.paint, fill: 'rgb(255, 0, 0)', borders: Array(4).fill({ width: 2, style: 'solid', color: 'rgb(0, 0, 0)' }) as typeof title.paint.borders, radius: 8 },
      text: { ...title.text!, padding: [10, 20, 10, 20] as [number, number, number, number], paragraphs: title.text!.paragraphs.map((p) => ({ ...p, lineHeight: 40, runs: p.runs.map((r) => ({ ...r, size: 32, letterSpacing: 1 })) })) },
    };
    const [first] = pptxSlides(deck(), { slides: [{ ...cover, elements: [scaled] }] }, { variant: 'named', pictures: new Map(), asset });
    const out = named(first!.objects, 'title');
    if (out.kind !== 'text') throw new Error('a text box');
    // 32 px × √(2 × 1.5) ≈ 55.4 px seen → 27.7 pt; letter spacing × 2 (across); line height × 1.5 (down)
    expect(out.text[0]!.options).toMatchObject({ fontSize: points(32 * Math.sqrt(3)), charSpacing: points(2), lineSpacing: points(60) });
    // insets: left and right × 2, top and bottom × 1.5 (pptxgenjs's order l, r, b, t), after the border (the path half
    // the border inside the box: exports-capture scalpel-5#5); the line and corner at the seen size, the corner the path's
    const half = Math.sqrt(3);
    expect(out.options.margin).toEqual([points(40 + half), points(40 + half), points(15 + half), points(15 + half)]);
    expect(out.options.line).toMatchObject({ width: points(2 * Math.sqrt(3)) });
    expect(out.options.rectRadius).toBeCloseTo(inches(8 * Math.sqrt(3) - half), 6);
  });

  // fix wave 1 (finding 3): a region stretched into a box of another aspect scales each axis on its own
  it('crops a region stretched into a box of another aspect to the region on both axes', async () => {
    const cover = MEASURED.slides[0]!;
    const logo = cover.elements.find((e) => e.id === 'logo')!;
    const stretched = { ...logo, box: { ...logo.box, h: 200 }, attrs: { ...logo.attrs, 'data-crop': '2 25% 50%' }, image: { ...logo.image!, natural: { w: 400, h: 200 }, fit: 'fill' } };
    const slides = pptxSlides(deck(), { slides: [{ ...cover, elements: [stretched] }] }, { variant: 'named', pictures: new Map(), asset });
    const zip = await JSZip.loadAsync(await writePptx(slides, { title: 'x' }));
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    // the region (x 50, y 50, 200 × 100 of a 400 × 200 picture): 12.5 % off the left, 37.5 % the right, 25 % top and bottom
    expect(/<a:srcRect [^>]*\/>/.exec(xml)![0]).toBe('<a:srcRect l="12500" r="37500" t="25000" b="25000"/>');
    expect(xml).toMatch(/name="logo"[\s\S]*?<a:ext cx="1270000" cy="1270000"\/>/); // 200 × 200 px
  });

  it('names basic faces in the basic variant, and makes each slide one picture with its notes in the pictures variant', () => {
    const [cover] = pptxSlides(deck(), MEASURED, { variant: 'basic', pictures: new Map(), asset });
    const faces = cover!.objects.flatMap((o) => (o.kind === 'text' ? o.text.map((r) => r.options?.fontFace) : []));
    expect(faces).toEqual(['Arial', 'Arial', 'Georgia']);
    const slides = pptxSlides(deck(), MEASURED, { variant: 'pictures', pictures: new Map([['cover', PNG], ['body', PNG], ['gone', PNG]]), asset });
    expect(slides.map((s) => s.objects.map((o) => [o.kind, o.name]))).toEqual([[['image', 'cover']], [['image', 'body']], [['image', 'gone']]]);
    expect(slides[0]!.notes).toBe('Open with the numbers.');
    expect(slides[0]!.objects[0]).toMatchObject({ options: { x: 0, y: 0, w: inches(1920), h: 7.5 } });
  });

  // fix wave 1 (found by the LibreOffice compare): pptxgenjs writes a paragraph's properties for every run that carries
  // them; a second `a:pPr` inside one `a:p` is invalid DrawingML, so only a paragraph's first run carries them
  it('writes each paragraph’s properties once, however many runs it has', async () => {
    const slides = pptxSlides(deck(), MEASURED, { variant: 'named', pictures: new Map(), asset });
    const zip = await JSZip.loadAsync(await writePptx(slides, { title: 'x' }));
    for (const n of [1, 2, 3]) {
      const xml = await zip.file(`ppt/slides/slide${n}.xml`)!.async('string');
      const paragraphs = xml.split('<a:p>').slice(1).map((p) => p.slice(0, p.indexOf('</a:p>')));
      expect(paragraphs.length).toBeGreaterThan(0);
      for (const p of paragraphs) expect(p.split('<a:pPr').length - 1, `slide ${n}: ${p.slice(0, 120)}`).toBeLessThanOrEqual(1);
    }
  });

  it('writes the file: shapes named by element ids, notes, the hidden slide, transitions, the theme, the SVG fallback', async () => {
    const pictures = new Map([[pictureKey('body', 'star'), PNG], [pictureKey('body', 'chart'), PNG], [pictureKey('body', 'live'), PNG]]);
    const slides = pptxSlides(deck(), MEASURED, { variant: 'named', pictures, asset });
    const themeXml = officeThemeXml(builtinView().tokens, 'MAWS', { '--ds-color-accent': '#123456' });
    const zip = await JSZip.loadAsync(await writePptx(slides, { title: 'Quarterly', themeXml }));
    const slide = async (n: number) => (await zip.file(`ppt/slides/slide${n}.xml`)!.async('string'));
    const names = (xml: string) => [...xml.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)].map((m) => m[1]);
    expect(names(await slide(1))).toEqual(expect.arrayContaining(['title', 'sub', 'logo']));
    expect(names(await slide(2))).toEqual(expect.arrayContaining(['badge', 'link', 'star', 'chart', 'points', 'grid', 'live']));
    expect(await slide(1)).toContain('<p:transition spd="med"><p:fade/></p:transition>');
    expect(await slide(2)).toContain('<p:push dir="l"/>');
    expect(await slide(3)).toContain('show="0"');
    expect(await slide(1)).toMatch(/<a:off x="\d+" y="\d+"\/><a:ext cx="\d+" cy="\d+"\/>/);
    const notes = await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f)).map((f) => zip.file(f)!.async('string')));
    expect(notes.some((n) => n.includes('Open with the numbers.'))).toBe(true);
    expect(await zip.file('ppt/theme/theme1.xml')!.async('string')).toBe(themeXml);
    expect(themeXml).toContain('123456');
    // the star's PNG fallback is the window's picture, not pptxgenjs's broken-image stand-in
    const rels = await zip.file('ppt/slides/_rels/slide2.xml.rels')!.async('string');
    const pic = (await slide(2)).split('<p:pic>').find((part) => part.includes('name="star"'))!;
    const rId = /<a:blip r:embed="(rId\d+)"/.exec(pic)![1];
    const target = new RegExp(`Id="${rId}"[^>]*Target="\\.\\./media/([^"]+)"`).exec(rels)![1]!;
    expect(await zip.file(`ppt/media/${target}`)!.async('base64')).toBe(PNG.split(',')[1]);
  });
});

// The final review's A5, A9, A11 and A12: each a regression of a code-traced finding.
describe('the PPTX mapping: the final review', () => {
  const body = MEASURED.slides[1]!;
  const only = (el: MeasuredElement, pictures = new Map<string, string>()) => pptxSlides(deck(), { slides: [{ ...body, elements: [el] }] }, { variant: 'named', pictures, asset })[0]!.objects;
  const quarter: [number, number, number, number] = [0, 1, -1, 0]; // a quarter turn clockwise (y down)

  it('A5: draws a connector through its host’s turn: a horizontal line in a quarter-turned group runs down the slide', () => {
    // the group: 200 × 100, centred at (300, 250), turned 90°; the connector across its middle
    const wire: MeasuredElement = { ...body.elements[1]!, id: 'wire', box: { x: 200, y: 200, w: 200, h: 100 }, rotate: 90, linear: quarter, attrs: { x1: '0', y1: '50', x2: '200', y2: '50' } };
    const out = named(only(wire), 'wire');
    expect(out).toMatchObject({ kind: 'shape', shape: 'line' });
    expect(out.options).toMatchObject({ x: inches(300), y: inches(150), w: 0, h: inches(200) });
    expect(out.options).not.toHaveProperty('rotate');
    // a routed one keeps its corners where they are drawn
    const routed = named(only({ ...wire, attrs: { ...wire.attrs, x2: '200', y2: '100', route: 'hv' } }), 'wire');
    // hv from (0, 50) to (200, 100): (300, 150), (300, 350), (250, 350) on the slide
    expect(routed.options).toMatchObject({ x: inches(250), y: inches(150), points: [{ x: inches(50), y: 0, moveTo: true }, { x: inches(50), y: inches(200) }, { x: 0, y: inches(200) }] });
  });

  it('A11: exports a turned table as the window’s picture of it, turned', () => {
    const grid = body.elements.find((e) => e.id === 'grid')!;
    const turned = { ...grid, rotate: 30 };
    expect(pictureJobs({ slides: [{ ...body, elements: [turned] }] }, 'named').map((j) => [j.key, j.mode])).toEqual([['body/grid', 'tree']]);
    expect(pictureJobs({ slides: [{ ...body, elements: [grid] }] }, 'named')).toEqual([]);
    const out = only(turned, new Map([[pictureKey('body', 'grid'), PNG]]));
    expect(out).toEqual([{ kind: 'image', name: 'grid', options: expect.objectContaining({ data: PNG, rotate: 30, x: inches(grid.box.x), w: inches(grid.box.w) }) }]);
  });

  it('A12: turns a box’s uneven border bars with it, about the box’s centre', () => {
    const top = { width: 10, style: 'solid', color: 'rgb(255, 0, 0)' };
    const card: MeasuredElement = { ...body.elements[0]!, id: 'card', tag: 'div', box: { x: 100, y: 100, w: 200, h: 100 }, rotate: 90, linear: quarter, paint: { fill: null, image: false, borders: [top, null, null, null], radius: 0, shadow: null, opacity: 1 } };
    const bar = named(only(card), 'card:border-top');
    // unturned, the bar is 200 × 10 centred at (200, 105); a quarter turn about (200, 150) takes its centre to (245, 150)
    expect(bar.options).toMatchObject({ x: inches(145), y: inches(145), w: inches(200), h: inches(10), rotate: 90 });
  });

  it('A9: writes every line break as a native break: several in a row, one leading, the trailing ones the app shows', async () => {
    const title = MEASURED.slides[0]!.elements[0]!;
    const run = title.text!.paragraphs[0]!.runs[0]!;
    const broken: MeasuredElement = {
      ...title,
      text: { ...title.text!, oneLine: false, paragraphs: [{ ...title.text!.paragraphs[0]!, runs: [{ ...run, text: 'Lead', breaks: 1 }, { ...run, text: 'A' }, { ...run, text: 'B', breaks: 2 }, { ...run, text: '', breaks: 1 }] }] },
    };
    const slides = pptxSlides(deck(), { slides: [{ ...MEASURED.slides[0]!, elements: [broken] }] }, { variant: 'named', pictures: new Map(), asset });
    const zip = await JSZip.loadAsync(await writePptx(slides, { title: 'x' }));
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const paragraph = xml.split('<a:p>').slice(1).map((p) => p.slice(0, p.indexOf('</a:p>'))).find((p) => p.includes('Lead'))!;
    const sequence = [...paragraph.matchAll(/<a:br\/>|<a:t>([^<]*)<\/a:t>/g)].map((m) => (m[0] === '<a:br/>' ? '|' : m[1])).filter((t) => t !== '').join('');
    expect(sequence).toBe('|LeadA||B|');
  });
});

// The exports-capture panel's findings (P3-F), each a regression drawn against where the canvas draws.
describe('the PPTX mapping: the exports-capture panel', () => {
  const cover = MEASURED.slides[0]!;
  const body = MEASURED.slides[1]!;
  const on = (slide: typeof cover) => (el: MeasuredElement, pictures = new Map<string, string>()) => pptxSlides(deck(), { slides: [{ ...slide, elements: [el] }] }, { variant: 'named', pictures, asset })[0]!.objects;
  const onBody = on(body);
  const NO_PAINT: MeasuredElement['paint'] = { fill: null, image: false, borders: [null, null, null, null], radius: 0, shadow: null, opacity: 1 };
  /** Slide px from pptxgenjs's inches and points. */
  const px = (inch: number) => inch * 144;
  const pxOfPt = (pt: number) => pt * 2;
  /** Within a point (2 px) of where the canvas draws it. */
  const nearCanvas = (exported: number, canvas: number) => expect(Math.abs(exported - canvas), `${exported} px against the canvas's ${canvas} px`).toBeLessThanOrEqual(2);

  // scalpel-5#5: PowerPoint centres an outline on its shape's path; the canvas draws a border inside the box (as the
  // uneven bars are drawn) and sets the text after the border and the padding
  it('scalpel-5#5: draws a 16 px border inside the box and sets a quote’s text after its 6 px left border', () => {
    const black = { width: 16, style: 'solid', color: 'rgb(0, 0, 0)' };
    const card: MeasuredElement = { ...body.elements[0]!, id: 'card', tag: 'div', box: { x: 100, y: 100, w: 400, h: 200 }, paint: { ...NO_PAINT, fill: 'rgb(255, 255, 255)', borders: [black, black, black, black], radius: 24 } };
    const shape = named(onBody(card), 'card');
    if (shape.kind !== 'shape') throw new Error('a shape');
    const o = shape.options as { x: number; y: number; w: number; h: number; line: { width: number }; rectRadius: number };
    const stroke = pxOfPt(o.line.width);
    expect(stroke).toBe(16);
    // the stroke's outer edge on the box's edge, its inner edge 16 px inside
    nearCanvas(px(o.x) - stroke / 2, 100);
    nearCanvas(px(o.y) - stroke / 2, 100);
    nearCanvas(px(o.x) + px(o.w) + stroke / 2, 500);
    nearCanvas(px(o.y) + px(o.h) + stroke / 2, 300);
    nearCanvas(px(o.x) + stroke / 2, 116);
    // the corner's outer curve keeps the box's 24 px radius
    nearCanvas(px(o.rectRadius) + stroke / 2, 24);

    const title = cover.elements[0]!;
    const teal = { width: 6, style: 'solid', color: 'rgb(43, 122, 120)' };
    const quote: MeasuredElement = { ...title, id: 'quote', tag: 'p', box: { x: 200, y: 400, w: 800, h: 120 }, paint: { ...NO_PAINT, borders: [null, null, null, teal] }, text: { ...title.text!, padding: [24, 32, 24, 32] } };
    const objects = on(cover)(quote);
    const text = named(objects, 'quote');
    if (text.kind !== 'text') throw new Error('a text box');
    const [left, right, bottom, top] = text.options.margin as [number, number, number, number];
    // the text starts after the border and the padding: 200 + 6 + 32 on the left, 400 + 24 at the top
    nearCanvas(px(text.options.x as number) + pxOfPt(left), 238);
    nearCanvas(px(text.options.y as number) + pxOfPt(top), 424);
    nearCanvas(px(text.options.x as number) + px(text.options.w as number) - pxOfPt(right), 968);
    nearCanvas(px(text.options.y as number) + px(text.options.h as number) - pxOfPt(bottom), 496);
    // the border its own bar, inside the box
    expect(named(objects, 'quote:border-left').options).toMatchObject({ x: inches(200), w: inches(6) });
  });
  // scalpel-5#2: a table's own background, border and shadow, which the canvas draws (its border collapsed over its
  // cells' fills)
  it('scalpel-5#2: draws a dark table’s fill under the native table and its outline over it; a gradient table’s picture under it', () => {
    const grid = body.elements.find((e) => e.id === 'grid')!;
    const edge = { width: 2, style: 'solid', color: 'rgb(204, 204, 204)' };
    const whiteText = grid.rows!.map((row) => ({ ...row, fill: null, cells: row.cells.map((cell) => ({ ...cell, text: { ...cell.text, paragraphs: cell.text.paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, color: 'rgb(255, 255, 255)' })) })) } })) }));
    const dark: MeasuredElement = { ...grid, paint: { ...NO_PAINT, fill: 'rgb(31, 41, 55)', borders: [edge, edge, edge, edge], shadow: { x: 0, y: 4, blur: 12, color: 'rgba(0, 0, 0, 0.25)' } }, rows: whiteText };
    const out = onBody(dark);
    expect(out.map((o) => [o.kind, o.name])).toEqual([['shape', 'grid:fill'], ['table', 'grid'], ['shape', 'grid:border']]);
    // the fill and the shadow under the table, over its whole box
    expect(out[0]).toMatchObject({ shape: 'rect', options: { objectName: 'grid:fill', x: inches(128), y: inches(229), w: inches(400), h: inches(120), fill: { color: '1F2937', transparency: 0 }, shadow: { type: 'outer', color: '000000' } } });
    expect(out[0]!.options).not.toHaveProperty('line');
    // the cells' white text on it
    const table = out[1]!;
    if (table.kind !== 'table') throw new Error('a table');
    expect(table.rows.flat().map((cell) => (cell.text as { options?: { color?: string } }[])[0]!.options?.color)).toEqual(['FFFFFF', 'FFFFFF', 'FFFFFF', 'FFFFFF']);
    // the outline over it, unfilled, unshadowed, its stroke inside the box
    expect(out[2]).toMatchObject({ options: { objectName: 'grid:border', fill: { type: 'none' }, line: { color: 'CCCCCC', width: 1 }, x: inches(129), y: inches(230), w: inches(398), h: inches(118) } });
    expect(out[2]!.options).not.toHaveProperty('shadow');

    // a gradient: the window's picture of the table's own paint (its cells hidden) under the native table
    const gradient: MeasuredElement = { ...grid, paint: { ...NO_PAINT, image: true } };
    expect(pictureJobs({ slides: [{ ...body, elements: [gradient] }] }, 'named').map((j) => [j.key, j.mode])).toEqual([['body/grid', 'self']]);
    const pictured = onBody(gradient, new Map([[pictureKey('body', 'grid'), PNG]]));
    expect(pictured.map((o) => [o.kind, o.name])).toEqual([['image', 'grid:fill'], ['table', 'grid']]);
    expect(pictured[0]).toMatchObject({ options: { data: PNG, objectName: 'grid:fill', x: inches(128), y: inches(229), w: inches(400), h: inches(120) } });
    // an unpainted table: the native table alone, as before
    expect(onBody(grid).map((o) => o.name)).toEqual(['grid']);
  });
  // P4 (the collapsed-table row): Chromium draws a collapsed table's whole outer border inside its measured box and never
  // rounds it, while its background and shadow keep the radius (the presentations-export probe on the export window)
  it('draws a collapsed table’s 16 px outline square and inside its box, its fill and shadow under it rounded', () => {
    const grid = body.elements.find((e) => e.id === 'grid')!;
    const red = { width: 16, style: 'solid', color: 'rgb(255, 0, 0)' };
    const rounded: MeasuredElement = { ...grid, paint: { ...NO_PAINT, fill: 'rgb(0, 0, 255)', borders: [red, red, red, red], radius: 40, shadow: { x: 12, y: 12, blur: 0, color: 'rgb(0, 255, 0)' } } };
    const out = onBody(rounded);
    expect(out.map((o) => [o.kind, o.name])).toEqual([['shape', 'grid:fill'], ['table', 'grid'], ['shape', 'grid:border']]);
    const outline = out[2]!;
    if (outline.kind !== 'shape') throw new Error('a shape');
    expect(outline.shape).toBe('rect');
    expect(outline.options).not.toHaveProperty('rectRadius');
    const o = outline.options as { x: number; y: number; w: number; h: number; line: { width: number } };
    const stroke = pxOfPt(o.line.width);
    expect(stroke).toBe(16);
    // the stroke from the box's edge (128, 229, 400 × 120) to 16 px inside it
    nearCanvas(px(o.x) - stroke / 2, 128);
    nearCanvas(px(o.y) - stroke / 2, 229);
    nearCanvas(px(o.x) + px(o.w) + stroke / 2, 528);
    nearCanvas(px(o.y) + px(o.h) + stroke / 2, 349);
    nearCanvas(px(o.x) + stroke / 2, 144);
    // the fill and its shadow at the whole box, with the table's radius
    expect(out[0]).toMatchObject({ shape: 'roundRect', options: { objectName: 'grid:fill', x: inches(128), w: inches(400), rectRadius: inches(40), shadow: { type: 'outer', color: '00FF00' } } });
  });
  // scalpel-5#3: an image's own paint (the presentation guide's `border-radius:16px`, a border, a background) is no
  // native picture's: the window's picture of it, which draws them; a shadow PowerPoint casts itself
  it('scalpel-5#3: takes a rounded or framed image as the window draws it, and casts an image’s shadow natively', () => {
    const logo = cover.elements.find((e) => e.id === 'logo')!;
    const onCover = on(cover);
    const jobsOf = (el: MeasuredElement) => pictureJobs({ slides: [{ ...cover, elements: [el] }] }, 'named').map((j) => [j.key, j.mode]);
    const picture = new Map([[pictureKey('cover', 'logo'), PNG]]);
    const rounded: MeasuredElement = { ...logo, paint: { ...NO_PAINT, radius: 16 } };
    expect(jobsOf(rounded)).toEqual([['cover/logo', 'self']]);
    expect(onCover(rounded, picture)).toEqual([{ kind: 'image', name: 'logo', options: { data: PNG, objectName: 'logo', altText: 'Logo', x: inches(1600), y: inches(64), w: inches(200), h: inches(100) } }]);
    const framed: MeasuredElement = { ...logo, paint: { ...NO_PAINT, borders: Array(4).fill({ width: 4, style: 'solid', color: 'rgb(0, 0, 0)' }) as MeasuredElement['paint']['borders'] } };
    expect(jobsOf(framed)).toEqual([['cover/logo', 'self']]);
    expect(onCover(framed, picture)).toMatchObject([{ kind: 'image', options: { data: PNG } }]);
    // no picture taken (the window failed): the native picture, as before
    expect(onCover(rounded)).toMatchObject([{ kind: 'image', options: { data: LOGO } }]);
    // a shadow alone: the native picture keeps its resolution, PowerPoint casting the shadow; a rounded one's picture casts it too
    const shadow = { x: 0, y: 8, blur: 24, color: 'rgba(0, 0, 0, 0.25)' };
    const cast = { type: 'outer', blur: 12, offset: 4, angle: 90, color: '000000', opacity: 0.25 };
    const shadowed: MeasuredElement = { ...logo, paint: { ...NO_PAINT, shadow } };
    expect(jobsOf(shadowed)).toEqual([]);
    expect(onCover(shadowed)).toMatchObject([{ kind: 'image', options: { data: LOGO, shadow: cast } }]);
    expect(onCover({ ...rounded, paint: { ...rounded.paint, shadow } }, picture)).toMatchObject([{ kind: 'image', options: { data: PNG, shadow: cast } }]);
    // a placeholder keeps its flat stand-in, whatever its paint
    expect(jobsOf({ ...rounded, image: { ...rounded.image!, placeholder: true } })).toEqual([]);
  });
  // scalpel-5#4: CSS turns the whole img about the element's centre; PowerPoint turns a picture about its own frame's
  it('scalpel-5#4: turns a contained, cropped, off-centre picture about the element’s centre, where the canvas draws it', () => {
    const logo = cover.elements.find((e) => e.id === 'logo')!;
    // a 400 × 200 box, a square crop region (zoom 2 of a 400 × 400 picture), its focus at 25 %, a quarter turn
    const turned: MeasuredElement = { ...logo, box: { x: 0, y: 0, w: 400, h: 200 }, rotate: 90, attrs: { ...logo.attrs, 'data-crop': '2 25% 50%' }, image: { ...logo.image!, natural: { w: 400, h: 400 }, fit: 'contain', position: [0.25, 0.5] } };
    const out = named(on(cover)(turned), 'logo');
    if (out.kind !== 'image') throw new Error('a picture');
    const o = out.options as { x: number; y: number; rotate: number; sizing: { w: number; h: number } };
    // unturned the region is drawn 200 × 200 at (50, 0), centred at (150, 100); the quarter turn about the element's
    // centre (200, 100) takes that centre to (200, 50)
    expect([px(o.sizing.w), px(o.sizing.h), o.rotate]).toEqual([200, 200, 90]);
    nearCanvas(px(o.x) + 100, 200);
    nearCanvas(px(o.y) + 100, 50);
    // uncropped and contained the same: a 400 × 400 picture drawn 200 × 200 at (50, 0)
    const whole = named(on(cover)({ ...turned, attrs: { alt: 'Logo' } }), 'logo');
    nearCanvas(px((whole.options as { x: number }).x) + 100, 200);
    nearCanvas(px((whole.options as { y: number }).y) + 100, 50);
  });
  // (the exports-capture regressions end)
});

// P4 (the skewed-element row): a skew, an element's own or an ancestor's, has no native form (a PowerPoint box turns but
// does not lean): the element, and every member of a skewed group with its connectors among them, is the window's picture
// of it as drawn, placed unturned at the box it is drawn in; a turned or scaled element keeps its native object.
describe('the PPTX mapping: skewed elements', () => {
  const body = MEASURED.slides[1]!;
  const lean: [number, number, number, number] = [1, 0, Math.tan(Math.PI / 9), 1]; // skewX(20deg)
  const fill: MeasuredElement['paint'] = { fill: 'rgb(0, 255, 0)', image: false, borders: [null, null, null, null], radius: 0, shadow: null, opacity: 1 };

  it('takes a skewed box, a skewed group’s text and its connector as drawn, and places each unturned at its drawn box', () => {
    const card: MeasuredElement = { ...body.elements[0]!, id: 'card', tag: 'div', box: { x: 118, y: 200, w: 200, h: 100 }, rotate: 0, linear: lean, drawn: { x: 100, y: 200, w: 236.4, h: 100 }, paint: fill };
    const wire: MeasuredElement = { ...body.elements[1]!, id: 'wire', box: { x: 400, y: 100, w: 300, h: 200 }, rotate: 10, linear: lean, drawn: { x: 380, y: 90, w: 380, h: 230 }, attrs: { x1: '0', y1: '0', x2: '300', y2: '200' } };
    const points = body.elements.find((e) => e.id === 'points')!;
    const text: MeasuredElement = { ...points, id: 'member', rotate: 10, linear: lean, drawn: { x: 410, y: 110, w: 120, h: 60 } };
    const turned: MeasuredElement = { ...card, id: 'turned', rotate: 30, linear: [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)], drawn: undefined };
    // the skewed group itself paints nothing: no picture of it
    const group: MeasuredElement = { ...card, id: 'group', box: wire.box, drawn: wire.drawn, paint: { ...fill, fill: null } };
    const measured = { slides: [{ ...body, elements: [card, group, wire, text, turned] }] };
    expect(pictureJobs(measured, 'named').map((j) => [j.key, j.mode, j.box])).toEqual([
      ['body/card', 'drawn', card.drawn],
      ['body/wire', 'drawn', wire.drawn],
      ['body/member', 'drawn', text.drawn],
    ]);
    const pictures = new Map(['card', 'wire', 'member'].map((id) => [pictureKey('body', id), PNG]));
    const out = pptxSlides(deck(), measured, { variant: 'named', pictures, asset })[0]!.objects;
    expect(out.map((o) => [o.kind, o.name])).toEqual([['image', 'card'], ['image', 'wire'], ['image', 'member'], ['shape', 'turned']]);
    expect(named(out, 'card').options).toEqual({ data: PNG, objectName: 'card', x: inches(100), y: inches(200), w: inches(236.4), h: inches(100) });
    expect(named(out, 'wire').options).toEqual({ data: PNG, objectName: 'wire', x: inches(380), y: inches(90), w: inches(380), h: inches(230) });
    expect(named(out, 'member').options).not.toHaveProperty('rotate');
    // a turn alone: its native box, turned
    expect(named(out, 'turned')).toMatchObject({ kind: 'shape', shape: 'rect', options: { rotate: 30 } });
  });

  // the re-review: a native stand-in's box need not stay within the skewed paint (a skewY(30deg) box just past the right
  // edge turns back onto the slide), so a skewed element is its picture or nothing
  it('draws nothing for a skewed element the slide shows none of, or one whose picture is missing', () => {
    const off: MeasuredElement = { ...body.elements[0]!, id: 'off', tag: 'div', box: { x: 1921, y: 200, w: 200, h: 100 }, rotate: 30, linear: [1, Math.tan(Math.PI / 6), 0, 1], drawn: { x: 1920, y: 142, w: 0, h: 216 }, paint: fill };
    const measured = { slides: [{ ...body, elements: [off] }] };
    expect(pictureJobs(measured, 'named')).toEqual([]);
    expect(pptxSlides(deck(), measured, { variant: 'named', pictures: new Map(), asset })[0]!.objects).toEqual([]);
    const shown = { slides: [{ ...body, elements: [{ ...off, id: 'shown', drawn: { x: 100, y: 142, w: 200, h: 216 } }] }] };
    expect(pictureJobs(shown, 'named').map((j) => j.key)).toEqual(['body/shown']);
    expect(pptxSlides(deck(), shown, { variant: 'named', pictures: new Map(), asset })[0]!.objects).toEqual([]);
  });
});
