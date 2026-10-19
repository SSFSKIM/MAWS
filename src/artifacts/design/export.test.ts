// P3-E1 M5 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M5; the parent's §1 "Export" and XE9): what a
// design's PNG and PDF export reads and refuses before any window opens. The boards as the model holds them (each at its
// manifest size whatever its section's style says), the selection checked by name before C's page filters could drop a
// board, the picture and page limits with the fitting scale, the scaled draw's CSS, and C's standalone page writing a
// sized board at its own size with a named print page while a deck's page is unchanged.
import { describe, expect, it } from 'vitest';
import { EXPORT_SIZE_MAX } from '@shared/ipc/schema/artifacts';
import { ArtifactExportInputSchema } from '@shared/maws/tools';
import { deckPage, exportDeckOf } from '../slides/export/standalone';
import { ROOT, setStyle } from '../slides/model';
import { publishFiles } from '../files';
import { newDoc, type Doc } from '../yjs';
import { BOARD_CSS } from './board-css';
import { boardPath, CANVAS_PATH } from './canvas';
import { DESIGN_EXPORT_LIMITS, designExportOf, fittingScale, planDesignExport, scaledDrawCss, type DesignExportPlan, type DesignExportSource } from './export';
import { BOARDS, design } from './fixtures/support';
import { isLegacyDesign, withDesignModel } from './migrate';
import { publishCanvas } from './publish';

const PAGE = { resolveVar: () => undefined, asset: () => null, facesCss: '' };

function published(files: Record<string, string>): Doc {
  const doc = newDoc();
  const outcome = publishCanvas(doc, {}, files, false);
  expect(outcome.conflicts).toEqual([]);
  return doc;
}
const canvas = (boards: Record<string, { x: number; y: number; w: number; h: number; title?: string }>, order = Object.keys(boards)) => JSON.stringify({ v: 1, title: 'Screens', boards, order });

function source(doc: Doc = design()): DesignExportSource {
  return designExportOf(doc, 'Fallback');
}
const refusal = (plan: DesignExportPlan) => (plan.ok ? null : plan.refusal);

describe('the boards a design exports', () => {
  it('are its boards in order, each at its manifest size, its title and whether it can be drawn', () => {
    const s = source();
    expect(s.boards.map(({ id, w, h, title, held, missing }) => ({ id, w, h, title, held, missing }))).toEqual([
      { id: 'b1', w: 390, h: 844, title: 'Phone', held: null, missing: false },
      { id: 'b2', w: 1440, h: 1024, title: null, held: null, missing: false },
      { id: 'b3', w: 1080, h: 8192, title: null, held: null, missing: false },
    ]);
    expect(s.deck.title).toBe('Design');
    expect(s.deck.slides.map((slide) => [slide.id, slide.size])).toEqual([
      ['b1', { w: 390, h: 844 }],
      ['b2', { w: 1440, h: 1024 }],
      ['b3', { w: 1080, h: 8192 }],
    ]);
  });

  it('marks a held board with its reasons and a manifest-only board as missing its source', () => {
    const doc = published({
      [CANVAS_PATH]: canvas({ ok: { x: 0, y: 0, w: 400, h: 300 }, bad: { x: 500, y: 0, w: 400, h: 300 }, gone: { x: 1000, y: 0, w: 400, h: 300 } }),
      [boardPath('ok')]: '<section id="ok"><p id="p">Fine</p></section>',
      [boardPath('bad')]: '<section id="bad"><blink>not a board element</blink></section>',
    });
    const boards = source(doc).boards;
    expect(boards.find((b) => b.id === 'ok')).toMatchObject({ held: null, missing: false });
    expect(boards.find((b) => b.id === 'bad')!.held).toEqual([expect.stringContaining('blink')]);
    expect(boards.find((b) => b.id === 'gone')).toMatchObject({ missing: true });
  });

  it('reads a legacy file state through the design model as its migration would build it, the state left as it was', () => {
    const legacy = newDoc();
    publishFiles(legacy, {}, { [CANVAS_PATH]: canvas({ a: { x: 0, y: 0, w: 640, h: 480 } }), [boardPath('a')]: '<section id="a"><p id="p">Legacy</p></section>' }, false);
    expect(withDesignModel(legacy, (model) => designExportOf(model, 'D').boards.map((b) => [b.id, b.w, b.h]))).toEqual([['a', 640, 480]]);
    expect(isLegacyDesign(legacy)).toBe(true);
  });
});

describe('a PNG’s board and size', () => {
  it('is the first board at native size by default, and the named board when asked', () => {
    expect(planDesignExport(source(), { format: 'png' })).toMatchObject({ ok: true, format: 'png', board: { id: 'b1' }, width: 390, height: 844, scale: 1 });
    const plan = planDesignExport(source(), { format: 'png', board: 'b2' });
    expect(plan).toMatchObject({ ok: true, board: { id: 'b2' }, width: 1440, height: 1024, scale: 1 });
    expect(plan.ok && plan.deck.slides.map((s) => s.id)).toEqual(['b2']);
  });

  it('a native side over the picture cap refuses naming the board, its size and the largest scale that fits; that scale succeeds', () => {
    const doc = design([...BOARDS, { id: 'poster', at: { x: 0, y: 0, w: 1080, h: 12_000 } }]);
    const refused = refusal(planDesignExport(source(doc), { format: 'png', board: 'poster' }));
    expect(refused).toMatchObject({ reason: 'exportTooLarge', data: { board: 'poster', w: 1080, h: 12_000, maxScale: 0.6826 } });
    expect(refused!.message).toContain('poster');
    expect(refused!.message).toContain('0.6826');
    expect(planDesignExport(source(doc), { format: 'png', board: 'poster', scale: 0.6826 })).toMatchObject({ ok: true, width: 737, height: 8191, scale: 0.6826 });
    // a board the cap holds natively is refused only at a scale that would take it over
    expect(refusal(planDesignExport(source(), { format: 'png', board: 'b3', scale: 1.5 }))).toMatchObject({ reason: 'exportTooLarge', data: { board: 'b3', w: 1080, h: 8192, maxScale: 1 } });
  });

  it('the fitting scale keeps every side within the cap, at most 4', () => {
    expect(fittingScale(1080, 9000, 8192)).toBe(0.9102);
    expect(fittingScale(16_384, 16_384 / 4, 8192)).toBe(0.5);
    expect(fittingScale(390, 844, 8192)).toBe(4);
    for (const [w, h] of [[1080, 12_000], [16_384, 4096], [8193, 1], [3, 16_384], [1234.5, 9876.25]] as const) {
      const s = fittingScale(w, h, 8192);
      expect(Math.round(Math.max(w, h) * s)).toBeLessThanOrEqual(8192);
      expect(Math.round(Math.max(w, h) * (s + 0.0001))).toBeGreaterThanOrEqual(8192);
    }
  });

  it('a scale, a width or a height each give one output that keeps the board’s shape; a contradiction or a distortion refuses', () => {
    const s = source();
    expect(planDesignExport(s, { format: 'png', scale: 2 })).toMatchObject({ ok: true, width: 780, height: 1688, scale: 2 });
    expect(planDesignExport(s, { format: 'png', width: 195 })).toMatchObject({ ok: true, width: 195, height: 422, scale: 0.5 });
    expect(planDesignExport(s, { format: 'png', height: 422 })).toMatchObject({ ok: true, width: 195, height: 422, scale: 0.5 });
    expect(planDesignExport(s, { format: 'png', width: 195, height: 422 })).toMatchObject({ ok: true, width: 195, height: 422 });
    expect(planDesignExport(s, { format: 'png', scale: 0.5, width: 195, height: 422 })).toMatchObject({ ok: true, width: 195, height: 422 });
    expect(refusal(planDesignExport(s, { format: 'png', width: 400, height: 400 }))).toMatchObject({ reason: 'invalid', data: { board: 'b1', width: 400, height: 400 } });
    expect(refusal(planDesignExport(s, { format: 'png', scale: 0.5, width: 300 }))).toMatchObject({ reason: 'invalid', data: { board: 'b1', scale: 0.5, width: 300 } });
    // a width asking more than four times the board, or less than a tenth, is outside the scale's range
    expect(refusal(planDesignExport(s, { format: 'png', width: 1600 }))).toMatchObject({ reason: 'invalid' });
    expect(refusal(planDesignExport(s, { format: 'png', scale: 0.05 }))).toMatchObject({ reason: 'invalid' });
    // a height the width implies over the cap: refused with the fitting scale
    expect(refusal(planDesignExport(source(), { format: 'png', board: 'b3', width: 2160 }))).toMatchObject({ reason: 'exportTooLarge', data: { board: 'b3', maxScale: 1 } });
  });

  it('a width and a height together must both be one scale’s rounded output: a pixel off on a small board refuses, never distorts', () => {
    const square = source(design([{ id: 'sq', at: { x: 0, y: 0, w: 16, h: 16 } }]));
    expect(refusal(planDesignExport(square, { format: 'png', width: 16, height: 17 }))).toMatchObject({ reason: 'invalid', data: { board: 'sq', width: 16, height: 17 } });
    expect(refusal(planDesignExport(square, { format: 'png', width: 17, height: 16 }))).toMatchObject({ reason: 'invalid' });
    expect(planDesignExport(square, { format: 'png', width: 32, height: 32 })).toMatchObject({ ok: true, width: 32, height: 32, scale: 2 });
    // fractional rounding that one scale gives on both sides is accepted, at a scale inside both sides' rounding
    const tall = source(design([{ id: 'p', at: { x: 0, y: 0, w: 1080, h: 9000 } }]));
    const fitted = planDesignExport(tall, { format: 'png', width: 983, height: 8192 });
    expect(fitted).toMatchObject({ ok: true, width: 983, height: 8192 });
    const s = fitted.ok && fitted.format === 'png' ? fitted.scale : NaN;
    expect([Math.round(1080 * s), Math.round(9000 * s)]).toEqual([983, 8192]);
    expect(refusal(planDesignExport(tall, { format: 'png', width: 983, height: 8200 }))).toMatchObject({ reason: 'invalid', data: { board: 'p', width: 983, height: 8200 } });
  });

  it('a width and a height together take any scale inside both sides’ rounding and the scale range: the range’s endpoints included (P3-F L227)', () => {
    const png = (plan: DesignExportPlan) => (plan.ok && plan.format === 'png' ? { width: plan.width, height: plan.height } : refusal(plan));
    // 161×161 → 16×16: each side's own ratio (16/161) is under the range, yet 0.1 itself rounds both sides to 16
    const small = source(design([{ id: 's', at: { x: 0, y: 0, w: 161, h: 161 } }]));
    const paired = planDesignExport(small, { format: 'png', width: 16, height: 16 });
    expect(paired).toMatchObject({ ok: true, width: 16, height: 16 });
    expect(png(paired)).toEqual(png(planDesignExport(small, { format: 'png', scale: 0.1 })));
    const s = paired.ok ? paired.scale : NaN;
    expect(s).toBeGreaterThanOrEqual(DESIGN_EXPORT_LIMITS.scaleMin);
    // two sides of different lengths whose admissible scales meet only from the range's lower endpoint
    const pair = source(design([{ id: 'r', at: { x: 0, y: 0, w: 161, h: 322 } }]));
    expect(png(planDesignExport(pair, { format: 'png', width: 16, height: 32 }))).toEqual(png(planDesignExport(pair, { format: 'png', scale: 0.1 })));
    // every scale both sides' rounding admits is under the range: refused for the range, as a single side is
    const under = source(design([{ id: 'u', at: { x: 0, y: 0, w: 166, h: 166 } }]));
    expect(refusal(planDesignExport(under, { format: 'png', width: 16, height: 16 }))).toMatchObject({ reason: 'invalid', data: { board: 'u', scale: expect.any(Number) } });
    expect(refusal(planDesignExport(under, { format: 'png', width: 16 }))).toMatchObject({ reason: 'invalid', data: { board: 'u', scale: expect.any(Number) } });
    // the upper endpoint: a side ratio over 4 whose rounding still admits 4 is drawn at 4, never above
    const tiny = source(design([{ id: 't', at: { x: 0, y: 0, w: 2.9, h: 2.9 } }]));
    const top = planDesignExport(tiny, { format: 'png', width: 12, height: 12 });
    expect(png(top)).toEqual(png(planDesignExport(tiny, { format: 'png', scale: 4 })));
    expect(top.ok ? top.scale : NaN).toBeLessThanOrEqual(DESIGN_EXPORT_LIMITS.scaleMax);
    // the open end of a side's rounding is never taken: 16 px at 16.5/161 would round to 17
    expect(refusal(planDesignExport(small, { format: 'png', width: 17, height: 16 }))).toMatchObject({ reason: 'invalid', data: { board: 's', width: 17, height: 16 } });
  });

  it('refuses by name an unknown board, boards meant for a PDF, a paper size, an empty design, and a board that cannot be drawn', () => {
    expect(refusal(planDesignExport(source(), { format: 'png', board: 'nope' }))).toMatchObject({ reason: 'notFound', data: { board: 'nope' } });
    expect(refusal(planDesignExport(source(), { format: 'png', boards: ['b1'] }))).toMatchObject({ reason: 'invalid', data: { boards: ['b1'] } });
    expect(refusal(planDesignExport(source(), { format: 'png', pageSize: 'letter' }))).toMatchObject({ reason: 'invalid', data: { pageSize: 'letter' } });
    expect(refusal(planDesignExport(source(design([])), { format: 'png' }))).toMatchObject({ reason: 'invalid', data: { boards: 0 } });
    const doc = published({
      [CANVAS_PATH]: canvas({ bad: { x: 0, y: 0, w: 400, h: 300 }, gone: { x: 500, y: 0, w: 400, h: 300 }, ok: { x: 1000, y: 0, w: 400, h: 300 } }),
      [boardPath('bad')]: '<section id="bad"><blink>held</blink></section>',
      [boardPath('ok')]: '<section id="ok"></section>',
    });
    // the default first board held: refused, never another board in its place
    expect(refusal(planDesignExport(source(doc), { format: 'png' }))).toMatchObject({ reason: 'invalid', data: { board: 'bad', held: [expect.any(String)] } });
    expect(refusal(planDesignExport(source(doc), { format: 'png', board: 'gone' }))).toMatchObject({ reason: 'invalid', data: { board: 'gone', missingSource: true } });
    expect(planDesignExport(source(doc), { format: 'png', board: 'ok' })).toMatchObject({ ok: true, board: { id: 'ok' } });
  });
});

describe('a PDF’s boards and pages', () => {
  it('is every board in order by default, the boards named in their order when asked, each page its board at the scale', () => {
    const all = planDesignExport(source(), { format: 'pdf' });
    expect(all).toMatchObject({ ok: true, format: 'pdf', scale: 1 });
    expect(all.ok && all.format === 'pdf' && all.boards.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    const named = planDesignExport(source(), { format: 'pdf', boards: ['b3', 'b1'], scale: 0.5 });
    expect(named.ok && named.format === 'pdf' && [named.boards.map((b) => b.id), named.deck.slides.map((s) => s.id), named.scale]).toEqual([['b3', 'b1'], ['b3', 'b1'], 0.5]);
  });

  it('a hidden board is still exported: the selection is checked before any page filter', () => {
    const hidden = published({ [CANVAS_PATH]: canvas({ h: { x: 0, y: 0, w: 300, h: 200 } }), [boardPath('h')]: '<section id="h" hidden><p id="p">Hidden</p></section>' });
    const plan = planDesignExport(source(hidden), { format: 'pdf' });
    expect(plan.ok && plan.deck.slides.map((s) => [s.id, s.hidden])).toEqual([['h', true]]);
    const page = deckPage(plan.ok ? plan.deck : source(hidden).deck, { ...PAGE, mode: 'print', only: ['h'] });
    expect(page).toContain('data-frame="h"');
  });

  it('a page over 19,200 px a side at the scale refuses naming the largest board and the scale that fits every page', () => {
    const doc = design([{ id: 'wide', at: { x: 0, y: 0, w: 16_384, h: 1000 } }, { id: 'tall', at: { x: 0, y: 0, w: 1000, h: 12_000 } }]);
    expect(planDesignExport(source(doc), { format: 'pdf' })).toMatchObject({ ok: true, scale: 1 }); // native: every board fits
    expect(refusal(planDesignExport(source(doc), { format: 'pdf', scale: 2 }))).toMatchObject({ reason: 'exportTooLarge', data: { board: 'wide', w: 16_384, h: 1000, maxScale: 1.1718 } });
    expect(planDesignExport(source(doc), { format: 'pdf', scale: 1.1718 })).toMatchObject({ ok: true });
    expect(planDesignExport(source(doc), { format: 'pdf', boards: ['tall'], scale: 1.5 })).toMatchObject({ ok: true });
  });

  it('refuses by name an empty, a repeated or an unknown selection, a single board, a picture size, a paper size, and a board that cannot be drawn', () => {
    expect(refusal(planDesignExport(source(), { format: 'pdf', boards: [] }))).toMatchObject({ reason: 'invalid', data: { boards: [] } });
    expect(refusal(planDesignExport(source(), { format: 'pdf', boards: ['b1', 'b1'] }))).toMatchObject({ reason: 'invalid', data: { board: 'b1' } });
    expect(refusal(planDesignExport(source(), { format: 'pdf', boards: ['b1', 'x'] }))).toMatchObject({ reason: 'notFound', data: { board: 'x' } });
    expect(refusal(planDesignExport(source(), { format: 'pdf', board: 'b1' }))).toMatchObject({ reason: 'invalid', data: { board: 'b1' } });
    expect(refusal(planDesignExport(source(), { format: 'pdf', width: 800 }))).toMatchObject({ reason: 'invalid', data: { width: 800 } });
    expect(refusal(planDesignExport(source(), { format: 'pdf', pageSize: 'a4' }))).toMatchObject({ reason: 'invalid', data: { pageSize: 'a4' } });
    expect(refusal(planDesignExport(source(design([])), { format: 'pdf' }))).toMatchObject({ reason: 'invalid', data: { boards: 0 } });
    const doc = published({ [CANVAS_PATH]: canvas({ ok: { x: 0, y: 0, w: 400, h: 300 }, bad: { x: 500, y: 0, w: 400, h: 300 } }), [boardPath('ok')]: '<section id="ok"></section>', [boardPath('bad')]: '<section id="bad"><blink>held</blink></section>' });
    expect(refusal(planDesignExport(source(doc), { format: 'pdf' }))).toMatchObject({ reason: 'invalid', data: { board: 'bad' } });
    expect(planDesignExport(source(doc), { format: 'pdf', boards: ['ok'] })).toMatchObject({ ok: true });
  });
});

describe('the scaled draw', () => {
  it('is nothing at native size; otherwise each board’s frame zoomed, and in print its own page at the scaled size', () => {
    const boards = source().boards.slice(0, 2);
    expect(scaledDrawCss(boards, 1, true)).toBe('');
    const picture = scaledDrawCss(boards, 0.5, false);
    expect(picture).toContain('.maws-frame[data-frame="b1"] { zoom: 0.5; }');
    expect(picture).not.toContain('@page');
    const print = scaledDrawCss(boards, 0.5, true);
    expect(print).toContain('.maws-frame[data-frame="b2"] { zoom: 0.5; page: design-1; }');
    expect(print).toContain('@page design-0 { size: 195px 422px; margin: 0; }');
    expect(print).toContain('@page design-1 { size: 720px 512px; margin: 0; }');
  });
});

describe('C’s standalone page for a sized board (P3-E, additive)', () => {
  it('writes each board’s frame and section at its manifest size, marked a board, over its section’s own width and height', () => {
    const doc = design();
    setStyle(doc, 'b1', ROOT, { width: '500px', height: '300px' }); // a republished section style at odds with the manifest
    const page = deckPage(exportDeckOf(doc, 'D'), { ...PAGE, mode: 'measure' });
    expect(page).toMatch(/<div class="maws-frame" data-frame="b1" data-size="390x844" style="width:390px; height:844px"><section class="maws-slide" data-board="" data-slide="b1"[^>]*style="width:390px; height:844px; background:#ffffff"/);
    expect(page).not.toContain('500px');
  });

  it('names a print page per board size, adds the trusted extra CSS last, and leaves a deck’s page as it was', () => {
    const doc = design();
    const print = deckPage(exportDeckOf(doc, 'D'), { ...PAGE, mode: 'print', extraCss: BOARD_CSS });
    expect(print).toContain('@page board-390x844 { size: 390px 844px; margin: 0; }');
    expect(print).toContain('.maws-frame[data-size="390x844"] { page: board-390x844; }');
    expect(print.indexOf(BOARD_CSS)).toBeGreaterThan(print.indexOf('@page board-1080x8192'));
    // a fractional size names a page CSS accepts
    const fractional = design([{ id: 'f', at: { x: 0, y: 0, w: 390.5, h: 844.25 } }]);
    expect(deckPage(exportDeckOf(fractional, 'D'), { ...PAGE, mode: 'print' })).toContain('@page board-390_5x844_25 { size: 390.5px 844.25px; margin: 0; }');
    // a deck's slide has no size: no data-size, no board page, no data-board; the extra CSS defaults to nothing
    const sized = exportDeckOf(doc, 'D');
    const plain = deckPage({ ...sized, slides: sized.slides.map((slide) => ({ ...slide, size: undefined })) }, { ...PAGE, mode: 'print' });
    expect(plain).not.toContain('data-size');
    expect(plain).not.toContain('@page board-');
    expect(plain).not.toContain('data-board');
    expect(plain).toMatch(/break-after: auto; }\n\.maws-slide x-embed > img \{ display: block; width: 100%; height: 100%; \}<\/style>/);
  });
});

describe('the limits', () => {
  it('are the schema’s: the picture cap is EXPORT_SIZE_MAX and the tool’s scale is 0.1 to 4', () => {
    expect(DESIGN_EXPORT_LIMITS.pngSide).toBe(EXPORT_SIZE_MAX);
    const base = { artifact: 'd', format: 'png' };
    expect(ArtifactExportInputSchema.safeParse({ ...base, scale: DESIGN_EXPORT_LIMITS.scaleMin }).success).toBe(true);
    expect(ArtifactExportInputSchema.safeParse({ ...base, scale: DESIGN_EXPORT_LIMITS.scaleMax }).success).toBe(true);
    expect(ArtifactExportInputSchema.safeParse({ ...base, scale: DESIGN_EXPORT_LIMITS.scaleMin - 0.01 }).success).toBe(false);
    expect(ArtifactExportInputSchema.safeParse({ ...base, scale: DESIGN_EXPORT_LIMITS.scaleMax + 0.01 }).success).toBe(false);
  });
});
