// X10's schema: E5's file-line anchor and E6's pr-line shape are members; the security caps and the one-line rule hold.
import { describe, expect, it } from 'vitest';
import { AnchorSchema, AnchorScreenshotSchema, type Anchor, type FileLineAnchor } from './anchor';

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
});
