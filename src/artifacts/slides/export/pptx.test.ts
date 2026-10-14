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
    expect(title.options).toMatchObject({ objectName: 'title', x: inches(128), y: inches(128), w: inches(1664), h: inches(106), fit: 'none', margin: [0, 0, 0, 0] });
    expect(title.text.map((r) => [r.text, r.options?.fontSize, r.options?.bold, r.options?.color, r.options?.fontFace, r.options?.lineSpacing])).toEqual([
      ['Quarterly ', 48, true, '123456', 'Helvetica Neue', 52.8],
      ['review', 48, true, '123456', 'Helvetica Neue', 52.8],
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
      ['link', { indent: 22.5 }, true, 'https://example.com/', { style: 'sng' }],
      ['Two', { indent: 22.5 }, undefined, undefined, undefined],
    ]);
    expect(points_.kind === 'text' && points_.options.margin).toEqual([0, 0, 0, 0]);
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

  it('names basic faces in the basic variant, and makes each slide one picture with its notes in the pictures variant', () => {
    const [cover] = pptxSlides(deck(), MEASURED, { variant: 'basic', pictures: new Map(), asset });
    const faces = cover!.objects.flatMap((o) => (o.kind === 'text' ? o.text.map((r) => r.options?.fontFace) : []));
    expect(faces).toEqual(['Arial', 'Arial', 'Georgia']);
    const slides = pptxSlides(deck(), MEASURED, { variant: 'pictures', pictures: new Map([['cover', PNG], ['body', PNG], ['gone', PNG]]), asset });
    expect(slides.map((s) => s.objects.map((o) => [o.kind, o.name]))).toEqual([[['image', 'cover']], [['image', 'body']], [['image', 'gone']]]);
    expect(slides[0]!.notes).toBe('Open with the numbers.');
    expect(slides[0]!.objects[0]).toMatchObject({ options: { x: 0, y: 0, w: inches(1920), h: 7.5 } });
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
