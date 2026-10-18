// P3-E1 M3: Insert on a board. C's factory makes every element (its markup, loaded through the dialect's loader); the
// design takes the slide-sized defaults off it: text kinds lose their slide font size so the board's screen defaults
// (16 px body, 24 px h2) apply, and each element fits within 80 % of the board, centred on it. The result inserts
// through C's validated writer.
import { describe, expect, it } from 'vitest';
import { readSlide } from '../../slides/model';
import { insertElements, type NewKind } from '../../slides/writers-elements';
import { design } from '../fixtures/support';
import { boardElement } from './insert';

const PHONE = { w: 390, h: 844 };
const DESKTOP = { w: 1440, h: 1024 };
const px = (v: string | undefined) => Number(/^(-?[\d.]+)px$/.exec(v ?? '')?.[1] ?? NaN);

describe('an element inserted on a board', () => {
  it('a text kind takes the board’s screen type (no slide font size) and fits a phone, centred', () => {
    for (const kind of ['text', 'heading', 'bullets', 'numbers'] as const) {
      const el = boardElement(kind, PHONE);
      expect(el.style['font-size'], kind).toBeUndefined();
      const w = px(el.style.width);
      expect(w, kind).toBeLessThanOrEqual(312);
      expect(px(el.style.left) + w / 2, kind).toBeCloseTo(195, 0);
    }
    expect(boardElement('heading', PHONE).tag).toBe('h2');
  });

  it('keeps a desktop board’s room: C’s widths where they fit, screen type still', () => {
    const text = boardElement('text', DESKTOP);
    expect(text.style.width).toBe('800px');
    expect(text.style['font-size']).toBeUndefined();
    expect(px(text.style.left)).toBe(720 - 400);
  });

  it('scales a picture, a table and a connector down to the phone, aspect kept', () => {
    const img = boardElement('image:assets/a.png', PHONE);
    expect(px(img.style.width)).toBe(312);
    expect(px(img.style.height)).toBe(Math.round(312 * (360 / 640)));
    expect(px(img.style.left)).toBe(195 - 156);
    const table = boardElement('table:3x2', PHONE);
    expect(px(table.style.width)).toBe(312);
    expect(table.style['font-size']).toBeUndefined();
    const line = boardElement('connector', PHONE);
    const span = Math.abs(Number(line.attrs.x2) - Number(line.attrs.x1));
    expect(span).toBeLessThanOrEqual(312);
    expect((Number(line.attrs.x1) + Number(line.attrs.x2)) / 2).toBeCloseTo(195, 0);
    // what already fits keeps C's size
    const shape = boardElement('shape:rect', PHONE);
    expect([shape.style.width, shape.style.height]).toEqual(['300px', '200px']);
  });

  it('inserts through C’s validated writer onto a phone board', () => {
    const doc = design();
    const kinds: NewKind[] = ['text', 'heading', 'bullets', 'shape:ellipse', 'icon:star', 'table:2x2', 'line', 'connector', 'image:assets/a.png'];
    const ids = insertElements(doc, 'b1', kinds.map((k) => boardElement(k, PHONE)), {}, 'editor');
    expect(ids).toHaveLength(kinds.length);
    const tags = readSlide(doc, 'b1').children.map((c) => c.tag);
    for (const tag of ['p', 'h2', 'ul', 'x-shape', 'x-icon', 'table', 'x-connector', 'img']) expect(tags).toContain(tag);
  });
});
