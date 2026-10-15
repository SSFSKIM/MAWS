// A system's own files where it renders (M4 fix wave 1): asset URLs keep their fragments (I6); a face is declared only
// when its one family and one source are the system's own (I4); in a scope its family is a private name, unique to the
// system, its revision and the family, set first in the scope's family values (I5).
import { describe, expect, it } from 'vitest';
import { fontFaces, rewriteCssUrls } from './assets';
import { edited } from './fixtures/edit';
import complete from './fixtures/complete.tokens.json';
import { generateTokensCss } from './css';
import { parseTokens } from './tokens';
import { snapshotCss } from './view';

const tokens = parseTokens(complete).tokens!; // font.display "Iowan Old Style", Georgia, serif; font.mono "JetBrains Mono"
const urlOf = (system: string) => (ref: string) => `maws-artifact://${system}/live/${ref}`;
const FACE = '@font-face { font-family: "Iowan Old Style"; font-weight: 400; src: url("assets/iowan.woff2") format("woff2"); }\n';

describe('asset URLs (I6)', () => {
  it('keep the fragment of an asset reference, and leave any other URL as written', () => {
    const css = rewriteCssUrls('fill: url("assets/paint.svg#grad"); mask: url(#local); background: url(https://x.example/a.png)', urlOf('a'));
    expect(css).toContain('url("maws-artifact\\3a //a/live/assets/paint.svg#grad")');
    expect(css).toContain('url(#local)');
    expect(css).toContain('url(https://x.example/a.png)');
  });
});

describe('faces (I4, I5)', () => {
  it('refuse a face with two src or two font-family descriptors, whichever comes first', () => {
    for (const face of [
      '@font-face { font-family: "Iowan Old Style"; src: url("assets/ok.woff2"); src: url("https://foreign.example/f.woff2"); }',
      '@font-face { font-family: "Iowan Old Style"; src: url("https://foreign.example/f.woff2"); src: url("assets/ok.woff2"); }',
      '@font-face { font-family: "Iowan Old Style"; font-family: "SF Mono"; src: url("assets/ok.woff2"); }',
    ]) {
      expect(fontFaces(face, tokens, urlOf('a'), { aliased: true }).css).toBe('');
      expect(fontFaces(face, tokens, urlOf('a'), { aliased: false }).css).toBe('');
    }
  });

  it('declare a scope’s face under a private family, the same for one system and revision, another for another system or revision', () => {
    const one = fontFaces(FACE, tokens, urlOf('a'), { aliased: true });
    const alias = one.aliases.get('iowan old style')!;
    expect(alias).toMatch(/^ds-face-[a-z0-9]+$/);
    expect(one.css).toContain(`font-family: ${alias};`);
    expect(one.css).not.toContain('"Iowan Old Style"');
    expect(fontFaces(FACE, tokens, urlOf('a'), { aliased: true }).aliases.get('iowan old style')).toBe(alias);
    expect(fontFaces(FACE, tokens, urlOf('b'), { aliased: true }).aliases.get('iowan old style')).not.toBe(alias); // another system
    const revised = FACE.replace('iowan.woff2', 'iowan-2.woff2');
    expect(fontFaces(revised, tokens, urlOf('a'), { aliased: true }).aliases.get('iowan old style')).not.toBe(alias); // another revision
    // Two faces of one family (two weights) share the family's alias, so weight matching still works.
    const bold = `${FACE}@font-face { font-family: "Iowan Old Style"; font-weight: 700; src: url("assets/iowan-bold.woff2"); }`;
    expect(new Set([...fontFaces(bold, tokens, urlOf('a'), { aliased: true }).css.matchAll(/font-family: ([^;]+);/g)].map((m) => m[1])).size).toBe(1);
    // A frame keeps the authored name.
    expect(fontFaces(FACE, tokens, urlOf('a'), { aliased: false }).css).toContain('font-family: "Iowan Old Style";');
  });

  it('put the private family before its authored one in the scope, keeping the stack’s order; tokens.css as a file keeps the authored names', () => {
    const files = { 'components/document.css': FACE };
    const css = snapshotCss({ tokens, law: '', name: 'Harbor', files, origin: null }, urlOf('a'), '[data-ds-scope="s"]', 'document');
    const alias = fontFaces(FACE, tokens, urlOf('a'), { aliased: true }).aliases.get('iowan old style')!;
    expect(css).toContain(`--ds-font-display: ${alias}, "Iowan Old Style", Georgia, serif;`);
    expect(css).toContain('--ds-font-mono: "JetBrains Mono";'); // no bundled face: unchanged
    expect(css).toContain(`.ds-type-quote {\n  font-family: ${alias}, "Iowan Old Style", serif;`); // a class's literal family too
    expect(generateTokensCss(tokens)).toContain('--ds-font-display: "Iowan Old Style", Georgia, serif;');
  });

  it('cannot stand in for a family the window uses: a system naming the app’s mono face declares it only under its private name', () => {
    const own = parseTokens(edited(complete, ['font/mono/$value', ['SF Mono', 'monospace']])).tokens!;
    const faces = fontFaces('@font-face { font-family: "SF Mono"; src: url("assets/mono.woff2"); }', own, urlOf('a'), { aliased: true });
    expect(faces.css).not.toContain('"SF Mono"');
    expect(faces.css).toMatch(/font-family: ds-face-[a-z0-9]+;/);
  });
});

describe('whole-branch review: a font override in a scope (C2)', () => {
  it('keeps the private family before an overridden stack’s bundled face, and leaves var() and other names as written', () => {
    const files = { 'components/document.css': FACE };
    const snapshot = { tokens, law: '', name: 'Harbor', files, origin: null };
    const alias = fontFaces(FACE, tokens, urlOf('a'), { aliased: true }).aliases.get('iowan old style')!;
    const css = snapshotCss(snapshot, urlOf('a'), '.s', 'document', {
      '--ds-font-body': "'Iowan Old Style', var(--ds-font-mono), serif",
      '--ds-font-mono': 'Menlo, monospace',
      '--ds-color-accent': '#123456',
    });
    const after = css.slice(css.lastIndexOf('.s {'));
    expect(after).toContain(`--ds-font-body: ${alias}, "Iowan Old Style", var(--ds-font-mono), serif;`);
    expect(after).toContain('--ds-font-mono: Menlo, monospace;');
    expect(after).toContain('--ds-color-accent: #123456;');
  });
});
