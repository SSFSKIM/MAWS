// The reference's two variants as the model types them (§B): narrowed to a text, its Read facts are numbers; narrowed to
// an image, its media type is a string. Pinned where a consumer meets them, a narrowing and a typed literal, which the
// typecheck gate compiles; and the schemas parse each variant and refuse one that lacks its own facts.
import { describe, expect, it } from 'vitest';
import { SheetReferenceSchema, StoredReferenceSchema, type SheetReference, type StoredReference } from './model';

type Text<R> = Extract<R, { kind: 'text' }>;
type Image<R> = Extract<R, { kind: 'image' }>;

const base = { path: 'src/a.ts', abs: '/work/a/src/a.ts', sha256: 'c'.repeat(64), bytes: 1, size: 1, mtimeMs: 1 };
const TEXT: SheetReference = { ...base, kind: 'text', lines: [40, 42], startLine: 40, numLines: 3, totalLines: 120, changed: true };
const IMAGE: SheetReference = { ...base, kind: 'image', mediaType: 'image/png', changed: null };
const STORED: StoredReference = { ...base, kind: 'text', startLine: 1, numLines: 1, totalLines: 1 };

// Each compiles only while narrowing gives the variant's own facts their types.
const factsOf = (reference: SheetReference): [number, number, number] | string =>
  reference.kind === 'text' ? [reference.startLine, reference.numLines, reference.totalLines] : reference.mediaType;
const storedFactsOf = (reference: StoredReference): [number, number, number] | string =>
  reference.kind === 'text' ? [reference.startLine, reference.numLines, reference.totalLines] : reference.mediaType;
const textOnly = (reference: Text<SheetReference>): number => reference.startLine + reference.numLines + reference.totalLines;
const imageOnly = (reference: Image<StoredReference>): string => reference.mediaType;

describe('a reference', () => {
  it('narrows to a text with numbers for its line facts, and to an image with a string for its media type', () => {
    expect(factsOf(TEXT)).toEqual([40, 3, 120]);
    expect(factsOf(IMAGE)).toBe('image/png');
    expect(storedFactsOf(STORED)).toEqual([1, 1, 1]);
    expect(textOnly(TEXT as Text<SheetReference>)).toBe(163);
    expect(imageOnly({ ...base, kind: 'image', mediaType: 'image/gif' })).toBe('image/gif');
  });

  it('parses each variant, and refuses a text without its line facts or an image without its media type', () => {
    expect(SheetReferenceSchema.parse(TEXT)).toEqual(TEXT);
    expect(SheetReferenceSchema.parse(IMAGE)).toEqual(IMAGE);
    expect(StoredReferenceSchema.parse(STORED)).toEqual(STORED);
    expect(StoredReferenceSchema.safeParse({ ...base, kind: 'text' }).success).toBe(false);
    expect(StoredReferenceSchema.safeParse({ ...base, kind: 'image' }).success).toBe(false);
  });
});
