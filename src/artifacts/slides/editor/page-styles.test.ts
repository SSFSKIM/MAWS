// P4-B2 D19 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md): a page's faces read `faceFiles`, so a Google
// Fonts face the host fetched draws from the deck's assets offline, one @font-face per file with its weight and style,
// under the authored name (the presenter) or one private name hashed over all of its files' URLs (the live editor, the
// history preview). Today's faces keep today's rules and names.
import { describe, expect, it } from 'vitest';
import { stableHash } from '../../design-system/hash';
import { LORA_FILES, loraFace, robotoSlabFace, TODAYS_FACES } from '../export/faces.test-support';
import { declareFaces, faceRules } from './page-styles';

const live = (ref: string) => `maws-artifact://deck/live/${ref}`;
const block = (family: string, url: string, file?: { weight: string; style: string }) => `@font-face { font-family: "${family}"; src: url("${url}");${file ? ` font-weight: ${file.weight}; font-style: ${file.style};` : ''} }`;

describe('a page’s faces (D19)', () => {
  it('declares a fetched face file by file, each with its weight and style, under its authored name (the presenter)', () => {
    expect(faceRules({ lora: loraFace() }, live)).toBe(LORA_FILES.map((file) => block('Lora', live(file.src), file)).join('\n'));
  });

  it('declares a fetched face under one private name hashed over every file’s URL (the live editor, the history preview)', () => {
    const { rules, aliases } = declareFaces({ lora: loraFace() }, live);
    const alias = aliases.get('lora')!;
    expect(alias).toBe(`deck-face-${stableHash([...LORA_FILES.map((file) => live(file.src)), 'lora'].join('\n'))}`);
    expect(rules).toEqual(LORA_FILES.map((file) => block(alias, live(file.src), file)));
    // any one file's URL names the face: another state's italic alone is another face
    const otherItalic = (ref: string) => (ref.endsWith('-italic.woff2') ? `maws-artifact://deck/7/${ref}` : live(ref));
    expect(declareFaces({ lora: loraFace() }, otherItalic).aliases.get('lora')).not.toBe(alias);
  });

  it('declares a file the page cannot resolve no rule, and a face with none no name', () => {
    const noItalic = (ref: string) => (ref.endsWith('-italic.woff2') ? null : live(ref));
    expect(declareFaces({ lora: loraFace() }, noItalic).rules).toHaveLength(2);
    expect(faceRules({ lora: loraFace() }, noItalic).split('\n')).toHaveLength(2);
    expect(declareFaces({ lora: loraFace() }, () => null)).toEqual({ rules: [], aliases: new Map() });
  });

  it('draws a refused face and a face with no record yet as their fallbacks: no rule, no name', () => {
    const faces = { 'roboto-slab': robotoSlabFace(), 'source-serif-4': TODAYS_FACES['source-serif-4']! };
    expect(faceRules(faces, live)).toBe('');
    expect(declareFaces(faces, live)).toEqual({ rules: [], aliases: new Map() });
  });

  // the architect's condition: a deck whose faces are today's shape draws exactly as before (pinned from the pre-D19 code)
  it('keeps today’s rules and private names for today’s faces, byte for byte', () => {
    expect(faceRules(TODAYS_FACES, live)).toBe('@font-face { font-family: "Brand Sans"; src: url("maws-artifact://deck/live/assets/brand.woff2"); }');
    const declared = declareFaces(TODAYS_FACES, live);
    expect(declared.rules).toEqual(['@font-face { font-family: "deck-face-9dq4ckumbym6"; src: url("maws-artifact://deck/live/assets/brand.woff2"); }']);
    expect([...declared.aliases]).toEqual([['brand sans', 'deck-face-9dq4ckumbym6']]);
  });
});
