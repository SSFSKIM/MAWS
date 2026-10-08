// X10's schema: E5's file-line anchor and E6's pr-line shape are members; the security caps and the one-line rule hold.
import { describe, expect, it } from 'vitest';
import { AnchorBoxSchema /* E4d */, anchorField, AnchorSchema, AnchorScreenshotSchema, type Anchor, type FileLineAnchor } from './anchor';

const fileLine: FileLineAnchor = { kind: 'file-line', locator: '/r/src/app.ts#L7', label: 'app.ts:7', path: '/r/src/app.ts', line: 7 }; // E5's fileLineAnchor('/r/src/app.ts', 7)

describe('AnchorSchema (X10)', () => {
  it('accepts E5’s file-line anchor and E6’s pr-line shape', () => {
    expect(AnchorSchema.parse(fileLine)).toEqual(fileLine);
    const prLine: Anchor = { kind: 'pr-line', locator: 'https://github.com/o/r/pull/9/files#diff-abc', label: 'app.ts:12', pageUrl: 'https://github.com/o/r/pull/9/files', path: 'src/app.ts', line: 12, side: 'new', prNumber: 9 };
    expect(AnchorSchema.parse(prLine)).toEqual(prLine);
  });

  it('accepts a screenshot and the anchorless kind', () => {
    expect(AnchorSchema.safeParse({ ...fileLine, screenshot: { path: '/u/shot.png', width: 640, height: 480 } }).success).toBe(true);
    expect(AnchorSchema.safeParse({ kind: 'none', locator: 'btw', label: 'Side question' }).success).toBe(true);
  });

  it('refuses an unknown kind, an unknown field and a control character in an embedded field', () => {
    expect(AnchorSchema.safeParse({ ...fileLine, kind: 'x' }).success).toBe(false);
    expect(AnchorSchema.safeParse({ ...fileLine, extra: 1 }).success).toBe(false);
    for (const field of ['locator', 'label', 'pageUrl', 'path'] as const) {
      expect(AnchorSchema.safeParse({ ...fileLine, [field]: 'a\nb' }).success, field).toBe(false);
      expect(AnchorSchema.safeParse({ ...fileLine, [field]: 'a\u007fb' }).success, field).toBe(false);
    }
  });

  it('caps each text field at the security bound', () => {
    expect(AnchorSchema.safeParse({ ...fileLine, label: 'x'.repeat(200) }).success).toBe(true);
    expect(AnchorSchema.safeParse({ ...fileLine, label: 'x'.repeat(201) }).success).toBe(false);
    expect(AnchorSchema.safeParse({ ...fileLine, locator: 'x'.repeat(2001) }).success).toBe(false);
    expect(AnchorSchema.safeParse({ ...fileLine, pageUrl: 'x'.repeat(2001) }).success).toBe(false);
    expect(AnchorSchema.safeParse({ ...fileLine, path: 'x'.repeat(1001) }).success).toBe(false);
    expect(AnchorSchema.safeParse({ ...fileLine, line: 0 }).success).toBe(false);
    // the screenshot's path is the one path main opens: the anchor's path cap (M1's review)
    expect(AnchorScreenshotSchema.safeParse({ path: `/${'x'.repeat(999)}`, width: 1, height: 1 }).success).toBe(true);
    expect(AnchorScreenshotSchema.safeParse({ path: `/${'x'.repeat(1000)}`, width: 1, height: 1 }).success).toBe(false);
  });

  // E4d start: the browser-element fields (E4d execution document, Design §6; P1 ledger §5): css, role, name, a11y, box
  describe('browser-element (E4d)', () => {
    const element: Anchor = {
      kind: 'browser-element',
      locator: '#increment',
      label: 'button “Increment”',
      pageUrl: 'http://127.0.0.1:4321/comment.html',
      css: '#increment',
      role: 'button',
      name: 'Increment',
      a11y: 'main > region “A form” > button “Increment”',
      box: { x: 248, y: 312, width: 96, height: 30 },
    };

    it('accepts the five fields, each optional, beside a screenshot', () => {
      expect(AnchorSchema.parse(element)).toEqual(element);
      expect(AnchorSchema.parse({ ...element, screenshot: { path: '/u/browser/crops/x.png', width: 192, height: 60 } }).screenshot).toEqual({ path: '/u/browser/crops/x.png', width: 192, height: 60 });
      const older: Anchor = { kind: element.kind, locator: element.locator, label: element.label, pageUrl: element.pageUrl }; // E3's shape
      expect(AnchorSchema.parse(older)).toEqual(older);
      expect(AnchorSchema.safeParse({ ...element, name: '', a11y: '' }).success).toBe(true);
    });

    it('caps each field and refuses a control character in it', () => {
      expect(AnchorSchema.safeParse({ ...element, css: 'x'.repeat(2000) }).success).toBe(true);
      expect(AnchorSchema.safeParse({ ...element, css: 'x'.repeat(2001) }).success).toBe(false);
      expect(AnchorSchema.safeParse({ ...element, css: '' }).success).toBe(false);
      expect(AnchorSchema.safeParse({ ...element, role: 'r'.repeat(64) }).success).toBe(true);
      expect(AnchorSchema.safeParse({ ...element, role: 'r'.repeat(65) }).success).toBe(false);
      expect(AnchorSchema.safeParse({ ...element, role: '' }).success).toBe(false);
      expect(AnchorSchema.safeParse({ ...element, name: 'n'.repeat(200) }).success).toBe(true);
      expect(AnchorSchema.safeParse({ ...element, name: 'n'.repeat(201) }).success).toBe(false);
      expect(AnchorSchema.safeParse({ ...element, a11y: 'a'.repeat(2000) }).success).toBe(true);
      expect(AnchorSchema.safeParse({ ...element, a11y: 'a'.repeat(2001) }).success).toBe(false);
      for (const field of ['css', 'role', 'name', 'a11y'] as const) {
        expect(AnchorSchema.safeParse({ ...element, [field]: 'a\nb' }).success, field).toBe(false);
        expect(AnchorSchema.safeParse({ ...element, [field]: 'a\u001bb' }).success, field).toBe(false);
      }
    });

    it('takes the box as whole CSS pixels, its size positive', () => {
      expect(AnchorBoxSchema.safeParse({ x: -12, y: 0, width: 1, height: 1 }).success).toBe(true);
      expect(AnchorBoxSchema.safeParse({ x: 1.5, y: 0, width: 1, height: 1 }).success).toBe(false);
      expect(AnchorBoxSchema.safeParse({ x: 0, y: 0, width: 0, height: 1 }).success).toBe(false);
      expect(AnchorBoxSchema.safeParse({ x: 0, y: 0, width: 1, height: -1 }).success).toBe(false);
      expect(AnchorBoxSchema.safeParse({ x: 0, y: 0, width: 1, height: 1, z: 0 }).success).toBe(false);
      expect(AnchorSchema.safeParse({ ...element, box: { x: 0, y: 0, width: 1 } }).success).toBe(false);
    });
  });
  // E4d end
});

// E11 (W-C): the producers' one strip-and-fit helper; every result passes the schema's one-line rule and its cap.
describe('anchorField', () => {
  const passes = (text: string) => AnchorSchema.safeParse({ ...fileLine, label: text }).success;

  it('makes a field one line: a control character becomes a space, whitespace runs collapse, the ends trim', () => {
    expect(anchorField('  Save\n\tdraft\u007f now ', 200)).toBe('Save draft now');
    expect(passes(anchorField('a\u0000b\u001bc', 200))).toBe(true);
  });

  it('marks a control character as U+FFFD, or drops it, keeping the rest exact', () => {
    expect(anchorField('odd\nname  .ts', 200, { control: 'mark' })).toBe('odd\uFFFDname  .ts');
    expect(anchorField('div > a\n[x]', 200, { control: 'drop' })).toBe('div > a[x]');
  });

  it('cuts to the cap in UTF-16 units with an ellipsis, never half a surrogate pair', () => {
    expect(anchorField('x'.repeat(200), 200)).toBe('x'.repeat(200));
    expect(anchorField('abcdef', 4)).toBe('abc…');
    expect(anchorField('ab\u{1F600}cd', 4)).toBe('ab…'); // the pair straddles the cut: dropped whole
    expect(passes(anchorField('y'.repeat(500), 200))).toBe(true);
  });

  it('keeps the tail when asked (a path’s end), and cuts bare without an ellipsis', () => {
    expect(anchorField('abcdef', 4, { keep: 'tail' })).toBe('…def');
    expect(anchorField('a\u{1F600}bc', 4, { keep: 'tail' })).toBe('…bc'); // the pair straddles the cut: dropped whole
    expect(anchorField('abcdef', 4, { ellipsis: false })).toBe('abcd');
    expect(anchorField('abc\u{1F600}', 4, { ellipsis: false })).toBe('abc');
  });
});
