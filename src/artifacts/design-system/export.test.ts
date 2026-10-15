// The `claude` export over a system's document (D12; registered with A's export service in main at M7): Claude's files
// from the system as it stands, `tokens.json` in Claude's list grammar, `README.md` from the law, the system's faces as
// Claude's `type.fonts` with their files under `fonts/`, and every other asset it is given (all the store lists for the
// system, named by its files or not) under `assets/`.
import { describe, expect, it } from 'vitest';
import { newDoc } from '../yjs';
import { claudeExportFiles } from './export';
import complete from './fixtures/complete.tokens.json';
import { fromClaude } from './claude';
import { validateClaudeTokens } from './claude-grammar';
import { writeSystem } from './model';
import { parseTokens, serializeTokens } from './tokens';

const LAW = '# Harbor\n\n## 0. Persona\npersona: a harbour pilot\n';
const TOKENS = serializeTokens(parseTokens(complete).tokens!);
// `font.display` is Iowan Old Style in the fixture; "Elsewhere" is a family no token sets
const DOCUMENT_CSS = `/* Iowan Old Style (SIL OFL 1.1, assets/OFL.txt). */
@font-face { font-family: "Iowan Old Style"; font-weight: 400; src: url("assets/iowan-regular.woff2") format("woff2"); }
@font-face { font-family: 'Iowan Old Style'; font-weight: bold; font-style: italic; src: url("assets/iowan-bold-italic.woff2") format("woff2"), url(assets/iowan-bold-italic.woff) format("woff"); }
@font-face { font-family: "Elsewhere"; src: url("assets/elsewhere.woff2"); }
.ds-doc { color: var(--ds-color-text); }
`;
const LAYOUT = '<section id="title"><img src="assets/logo.png#mark" alt=""><h1 data-ph="title">Title</h1></section>';

function systemDoc(files: Record<string, string> = {}) {
  const doc = newDoc();
  writeSystem(doc, { 'DESIGN.md': LAW, 'tokens.tokens.json': TOKENS, ...files }, { route: 'derived', at: 0 });
  return doc;
}
const bytesOf = (text: string) => new TextEncoder().encode(text);
const tokensOf = (files: Record<string, string | Uint8Array>) => JSON.parse(files['tokens.json'] as string) as { type: { fonts: unknown[] } };

describe('the claude export of a system’s document', () => {
  it('writes Claude’s files from the system as it stands, which import back', () => {
    const files = claudeExportFiles(systemDoc());
    expect(Object.keys(files).sort()).toEqual(['README.md', 'tokens.json']);
    expect(files['README.md']).toBe(LAW);
    expect(validateClaudeTokens(tokensOf(files))).toEqual([]);
    expect(tokensOf(files).type.fonts).toEqual([]);
    expect(fromClaude(files as Record<string, string>).tokens).not.toBeNull();
  });

  it('refuses a document that holds no system yet', () => {
    expect(() => claudeExportFiles(newDoc())).toThrow(/holds no design system/);
  });

  it('writes the system’s faces as Claude’s type.fonts with their files under fonts/, and every other asset under assets/', () => {
    const doc = systemDoc({ 'components/document.css': DOCUMENT_CSS, 'layouts/title.html': LAYOUT });
    const assets: Record<string, Uint8Array> = {
      'assets/iowan-regular.woff2': bytesOf('regular'),
      // the bold italic's first source is missing from the store: its entry names the next one
      'assets/iowan-bold-italic.woff': bytesOf('bold italic'),
      'assets/elsewhere.woff2': bytesOf('elsewhere'),
      'assets/OFL.txt': bytesOf('SIL OPEN FONT LICENSE'),
      'assets/logo.png': bytesOf('png'),
      'assets/brand-guide.pdf': bytesOf('pdf'), // named by none of the system's files
    };
    const files = claudeExportFiles(doc, assets);
    expect(Object.keys(files).sort()).toEqual([
      'README.md', 'assets/OFL.txt', 'assets/brand-guide.pdf', 'assets/elsewhere.woff2', 'assets/logo.png', 'fonts/iowan-bold-italic.woff', 'fonts/iowan-regular.woff2', 'tokens.json',
    ]);
    expect(files['fonts/iowan-regular.woff2']).toEqual(bytesOf('regular'));
    expect(files['fonts/iowan-bold-italic.woff']).toEqual(bytesOf('bold italic'));
    expect(files['assets/OFL.txt']).toEqual(bytesOf('SIL OPEN FONT LICENSE'));
    const tokens = tokensOf(files);
    expect(tokens.type.fonts).toEqual([
      { family: 'Iowan Old Style', file: 'iowan-regular.woff2', weight: '400', style: 'normal' },
      { family: 'Iowan Old Style', file: 'iowan-bold-italic.woff', weight: '700', style: 'italic' },
    ]);
    expect(validateClaudeTokens(tokens)).toEqual([]);
  });

  // Review M7b-1 (Important): a face's file is the reference the renderer reads, not a delimiter scan of the text
  it.each([
    ['a name with a space', 'assets/Iowan Regular.woff2', 'assets/Iowan Regular.woff2'],
    ['a ./ prefix', './assets/iowan.woff2', 'assets/iowan.woff2'],
    ['parentheses', 'assets/iowan(regular).woff2', 'assets/iowan(regular).woff2'],
    ['a percent-encoding', 'assets/iowan%20regular.woff2', 'assets/iowan regular.woff2'],
  ])('takes a face’s file as the renderer does, with %s', (_, url, ref) => {
    const doc = systemDoc({ 'components/document.css': `@font-face { font-family: "Iowan Old Style"; font-weight: 400; src: url("${url}") format("woff2"); }` });
    const files = claudeExportFiles(doc, { [ref]: bytesOf('face') });
    const name = ref.slice('assets/'.length);
    expect(tokensOf(files).type.fonts).toEqual([{ family: 'Iowan Old Style', file: name, weight: '400', style: 'normal' }]);
    expect(files[`fonts/${name}`]).toEqual(bytesOf('face'));
  });

  it('leaves out a face none of whose files the store holds', () => {
    const doc = systemDoc({ 'components/document.css': DOCUMENT_CSS });
    const files = claudeExportFiles(doc, { 'assets/iowan-regular.woff2': bytesOf('regular') });
    expect(tokensOf(files).type.fonts).toEqual([{ family: 'Iowan Old Style', file: 'iowan-regular.woff2', weight: '400', style: 'normal' }]);
    expect(Object.keys(files).filter((path) => path.startsWith('fonts/') || path.startsWith('assets/'))).toEqual(['fonts/iowan-regular.woff2']);
  });
});
