import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { applyV1, diffV1, newDoc, stateVector, type Doc } from '../yjs';
import type { HtmlParser } from './canon';
import { CLAUDE_SOURCES } from './claude';
import { TIDEWATER_FILES } from './fixtures/claude-tidewater';
import complete from './fixtures/complete.tokens.json';
import lenient from './fixtures/lenient.tokens.json';
import { generateTokensCss } from './css';
import {
  createDesignSystemAdapter,
  designSystemAdapter,
  GENERATED_PATHS,
  publishSystem,
  readFiles,
  readSystem,
  setFile,
  setLaw,
  setToken,
  SystemFilesError,
  writeSystem,
  type SystemOrigin,
} from './model';
import { officeTheme } from './office';
import { parseTokens, serializeTokens, validateTokenFile, type Token } from './tokens';

const parser = new new Window().DOMParser() as unknown as HtmlParser;
const AT = Date.UTC(2026, 9, 13);
const DERIVED: SystemOrigin = { route: 'derived', at: AT };

const LAW = `# Harbor

## 0. Stance commitment

persona: quiet-editorial

Quiet print on warm paper.

## 1. Palette

The accent marks the one action per view.

## 2. Typography

Display for titles only.

## 3. Canvas

Flat paper.

## 4. Layout

Two columns on wide pages.

## 5. Component canon

- layouts/title.html, components/chip.html, components/document.css

## 6. Voice

Plain words.

## 7. Motion

None.

## 8. Hard don'ts

- No gradients. [check: no-gradient]
- Nothing louder than the title.
`;
const TOKENS = serializeTokens(parseTokens(complete).tokens!);
const TITLE = `<section id="title" style="background:var(--ds-color-bg)"><h1 data-ph="title" style="color:var(--ds-color-text)">Lab safety</h1></section>`;
const CHIP = `<div style="background:var(--ds-color-accent)"><span style="color:var(--ds-color-accent-text)">Due Friday</span></div>`;
const DOCUMENT_CSS = `.ds-doc blockquote { border-left: 2px solid var(--ds-color-accent); }\n`;
const FILES: Record<string, string> = {
  'DESIGN.md': LAW,
  'tokens.tokens.json': TOKENS,
  'layouts/title.html': TITLE,
  'components/chip.html': CHIP,
  'components/document.css': DOCUMENT_CSS,
};

const color = (hex: string): Token => ({ $type: 'color', $value: { colorSpace: 'srgb', components: [0, 1, 2].map((i) => Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255), hex } });

/** The token file as an object, edited: each edit sets (or with undefined removes) the token at a path. */
function tokensWith(text: string, edits: Record<string, Token | undefined>): string {
  const set = parseTokens(text).tokens!;
  const tokens = new Map(set.tokens);
  for (const [path, token] of Object.entries(edits)) {
    if (token === undefined) tokens.delete(path);
    else tokens.set(path, token);
  }
  return serializeTokens({ tokens, groups: set.groups });
}
const tokenOf = (doc: Doc, path: string) => readSystem(doc).tokens.tokens.get(path);

/** Two replicas exchange what the other lacks (the provider's sync, in-process). */
function sync(...docs: Doc[]): void {
  for (const a of docs) for (const b of docs) if (a !== b) applyV1(b, diffV1(a, stateVector(b)));
}

/**
 * The host's doc, a human's replica and an agent session's replica (A's Decision Log 9), all in sync; the agent's base
 * is the file view of its last `artifact_read`.
 */
function scene(files: Record<string, string> = FILES) {
  const host = newDoc();
  writeSystem(host, files, DERIVED, { name: 'Harbor' });
  const human = newDoc();
  const agent = newDoc();
  sync(host, human, agent);
  const base = readFiles(agent);
  return { host, human, agent, base };
}

describe('the document model: write, read, the file view (Acceptance 7)', () => {
  it('round-trips a system’s files: readFiles(writeSystem(files)) is the canonical files plus the generated ones', () => {
    const doc = newDoc();
    const result = writeSystem(doc, FILES, DERIVED, { name: 'Harbor' });
    expect(result.warnings).toEqual([]);
    const out = readFiles(doc);
    expect(Object.keys(out)).toEqual(['DESIGN.md', 'tokens.tokens.json', 'components/chip.html', 'components/document.css', 'layouts/title.html', ...GENERATED_PATHS]);
    for (const path of Object.keys(FILES)) expect(out[path]).toBe(FILES[path]);
    const tokens = parseTokens(TOKENS).tokens!;
    expect(out['tokens.css']).toBe(generateTokensCss(tokens));
    expect(JSON.parse(out['office-theme.json']!)).toEqual(officeTheme(tokens));
  });

  it('writes a lenient token file canonically, and a replica loaded over the wire reads the same files', () => {
    const doc = newDoc();
    writeSystem(doc, { ...FILES, 'tokens.tokens.json': JSON.stringify(lenient) }, DERIVED);
    const canonical = serializeTokens(parseTokens(lenient).tokens!);
    expect(readFiles(doc)['tokens.tokens.json']).toBe(canonical);
    const replica = newDoc();
    applyV1(replica, diffV1(doc));
    expect(readFiles(replica)).toEqual(readFiles(doc));
  });

  it('keeps D7’s layout: meta with the origin and the law’s persona, one attribute per token and per group, the law as text, canon by path', () => {
    const doc = newDoc();
    writeSystem(doc, FILES, { route: 'adopted', from: 'Harbor web', at: AT }, { name: 'Harbor' });
    const system = readSystem(doc);
    expect(system.meta).toEqual({ formatVersion: 1, name: 'Harbor', origin: { route: 'adopted', from: 'Harbor web', at: AT }, persona: 'quiet-editorial' });
    expect(system.law).toBe(LAW);
    expect(system.files).toEqual({ 'components/chip.html': CHIP, 'components/document.css': DOCUMENT_CSS, 'layouts/title.html': TITLE });
    const tokens = doc.get('tokens');
    expect(tokens.getAttr('color.accent.$root')).toEqual(parseTokens(TOKENS).tokens!.tokens.get('color.accent.$root'));
    expect(tokens.getAttr('/$group')).toEqual(parseTokens(TOKENS).tokens!.groups.get(''));
    expect(tokens.hasAttr('color.bg/$group')).toBe(true);
    expect(doc.get('law').length).toBe(LAW.length);
  });

  it('names the system after its law’s title when no name is given, and reads an empty doc as no system', () => {
    const doc = newDoc();
    expect(writeSystem(doc, FILES, DERIVED).name).toBe('Harbor');
    expect(readSystem(newDoc()).meta).toBeNull();
  });

  it('imports Claude’s shape: the tokens converted, Claude’s files kept read-only under sources/claude/, no law', () => {
    const doc = newDoc();
    const result = writeSystem(doc, TIDEWATER_FILES, { route: 'derived', at: AT });
    expect(result.warnings.length).toBeGreaterThan(0);
    const system = readSystem(doc);
    expect(system.meta!.origin).toEqual({ route: 'imported', from: 'Tidewater', at: AT });
    expect(system.meta!.name).toBe('Tidewater');
    expect(system.law).toBe('');
    const out = readFiles(doc);
    expect(out['DESIGN.md']).toBeUndefined();
    expect(validateTokenFile(out['tokens.tokens.json']).ok).toBe(true);
    for (const [path, text] of Object.entries(TIDEWATER_FILES)) expect(out[`${CLAUDE_SOURCES}${path.replace(/^project\//, '')}`]).toBe(text);
  });

  it('refuses files it cannot hold, naming every problem by path, and writes nothing', () => {
    const doc = newDoc();
    const bad = {
      'DESIGN.md': 'x'.repeat(256 * 1024 + 1),
      'tokens.tokens.json': tokensWith(TOKENS, { 'color.accent.$root': undefined }),
      'tokens.css': ':root{}',
      'assets/logo.svg': '<svg/>',
      'layouts/Bad Name.html': '<section id="x"></section>',
      'notes.txt': 'hi',
      [`${CLAUDE_SOURCES}tokens.json`]: '{}',
    };
    const error = (() => {
      try {
        writeSystem(doc, bad, DERIVED);
      } catch (e) {
        return e;
      }
    })() as SystemFilesError;
    expect(error).toBeInstanceOf(SystemFilesError);
    expect(error.code).toBe('invalid');
    const paths = error.problems.map((p) => p.path);
    expect(paths).toEqual(expect.arrayContaining(['DESIGN.md', 'tokens.tokens.json', 'tokens.css', 'assets/logo.svg', 'layouts/Bad Name.html', 'notes.txt', `${CLAUDE_SOURCES}tokens.json`]));
    expect(error.problems.find((p) => p.path === 'tokens.tokens.json')!.message).toContain('color.accent.$root');
    expect(error.problems.find((p) => p.path === 'tokens.css')!.message).toMatch(/generated/);
    expect(doc.get('meta').getAttrs()).toEqual({});
    expect(() => writeSystem(newDoc(), { 'DESIGN.md': LAW }, DERIVED)).toThrow(/tokens\.tokens\.json/);
    expect(() => writeSystem(newDoc(), { ...FILES, 'tokens.tokens.json': '{ nope' }, DERIVED)).toThrow(SystemFilesError);
  });

  it('checks the canon’s structure when given a parser, and its limits always', () => {
    const script = { ...FILES, 'components/bad.html': '<div><script>x()</script></div>' };
    expect(() => writeSystem(newDoc(), script, DERIVED, { parser })).toThrow(/components\/bad\.html/);
    expect(() => writeSystem(newDoc(), script, DERIVED)).not.toThrow();
    const many: Record<string, string> = { ...FILES };
    for (let i = 0; i < 64; i++) many[`components/c${i}.html`] = CHIP;
    expect(() => writeSystem(newDoc(), many, DERIVED)).toThrow(/at most 64/);
    expect(() => writeSystem(newDoc(), { ...FILES, 'components/big.html': `<div>${'x'.repeat(64 * 1024)}</div>` }, DERIVED)).toThrow(/components\/big\.html/);
  });
});

describe('the page’s edits: setToken, setLaw, setFile', () => {
  it('writes one token as one attribute, removes it with null, and refuses a path the layout reserves', () => {
    const { human } = scene();
    setToken(human, 'color.accent.$root', color('#cc3300'));
    expect(readFiles(human)['tokens.css']).toContain('--ds-color-accent: #cc3300');
    setToken(human, 'color.highlight', null);
    expect(tokenOf(human, 'color.highlight')).toBeUndefined();
    expect(() => setToken(human, 'color.x/$group', color('#000000'))).toThrow(/\$group/);
  });

  it('applies a law edit as a diff, so a concurrent edit elsewhere in the law survives, and mirrors the persona', () => {
    const { human, agent } = scene();
    setLaw(human, LAW.replace('Quiet print on warm paper.', 'Quiet print on cool paper.'));
    setLaw(agent, LAW.replace('persona: quiet-editorial', 'persona: bold-poster').replace('Plain words.', 'Short, plain words.'));
    sync(human, agent);
    const merged = LAW.replace('Quiet print on warm paper.', 'Quiet print on cool paper.').replace('persona: quiet-editorial', 'persona: bold-poster').replace('Plain words.', 'Short, plain words.');
    expect(readSystem(human).law).toBe(merged);
    expect(readSystem(agent).law).toBe(merged);
    expect(readSystem(agent).meta!.persona).toBe('bold-poster');
  });

  it('replaces a canon file whole, removes it with null, and refuses a path that is not canon', () => {
    const { human } = scene();
    setFile(human, 'components/chip.html', CHIP.replace('Due Friday', 'Due Monday'));
    setFile(human, 'layouts/title.html', null);
    expect(readSystem(human).files).toEqual({ 'components/chip.html': CHIP.replace('Due Friday', 'Due Monday'), 'components/document.css': DOCUMENT_CSS });
    expect(() => setFile(human, 'tokens.css', 'x')).toThrow(/generated/);
    expect(() => setFile(human, 'DESIGN.md', 'x')).toThrow(SystemFilesError);
  });
});

describe('publish: the agent’s change over the live doc (Acceptance 7, A’s layers 2 and 3)', () => {
  it('merges token by token: the human’s edit to another token is kept', () => {
    const { human, agent, base } = scene();
    setToken(human, 'color.bg.$root', color('#fafafa'));
    sync(human, agent);
    const sent = { 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.accent.$root': color('#cc3300'), 'color.callout': color('#ffeeaa') }) };
    expect(publishSystem(agent, base, sent, false)).toEqual({ changed: ['tokens.tokens.json'], conflicts: [] });
    sync(human, agent);
    for (const doc of [human, agent]) {
      expect(tokenOf(doc, 'color.bg.$root')).toEqual(color('#fafafa'));
      expect(tokenOf(doc, 'color.accent.$root')).toEqual(color('#cc3300'));
      expect(tokenOf(doc, 'color.callout')).toEqual(color('#ffeeaa'));
    }
  });

  it('refuses a token changed on both sides, naming it, and writes nothing', () => {
    const { human, agent, base } = scene();
    setToken(human, 'color.accent.$root', color('#0055aa'));
    sync(human, agent);
    const before = stateVector(agent);
    const sent = { 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.accent.$root': color('#cc3300') }) };
    const result = publishSystem(agent, base, sent, false);
    expect(result.changed).toEqual([]);
    expect(result.conflicts).toEqual([{ path: 'tokens.tokens.json', detail: expect.stringContaining('color.accent.$root') }]);
    expect(stateVector(agent)).toEqual(before);
  });

  it('takes the same change made on both sides as no conflict, and an unchanged send as no change', () => {
    const { human, agent, base } = scene();
    setToken(human, 'color.accent.$root', color('#cc3300'));
    sync(human, agent);
    const sent = { 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.accent.$root': color('#cc3300') }) };
    expect(publishSystem(agent, base, sent, false)).toEqual({ changed: [], conflicts: [] });
    expect(publishSystem(agent, base, { 'layouts/title.html': TITLE }, false)).toEqual({ changed: [], conflicts: [] });
  });

  it('refuses a group’s own properties changed on both sides', () => {
    const { human, agent, base } = scene();
    human.get('tokens').setAttr('color.status/$group', { $description: 'Human' });
    sync(human, agent);
    const set = parseTokens(base['tokens.tokens.json']!).tokens!;
    const groups = new Map(set.groups).set('color.status', { $description: 'Agent' });
    const result = publishSystem(agent, base, { 'tokens.tokens.json': serializeTokens({ tokens: set.tokens, groups }) }, false);
    expect(result.conflicts).toEqual([{ path: 'tokens.tokens.json', detail: expect.stringContaining('color.status') }]);
  });

  it('refuses a merge whose result would not validate, naming the problem (a token the human now references, removed)', () => {
    const { human, agent, base } = scene();
    setToken(human, 'line.copy', { $type: 'gradient', $value: '{line.ramp}' });
    sync(human, agent);
    const before = stateVector(agent);
    const result = publishSystem(agent, base, { 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'line.ramp': undefined }) }, false);
    expect(result.conflicts).toEqual([{ path: 'tokens.tokens.json', detail: expect.stringContaining('line.copy') }]);
    expect(stateVector(agent)).toEqual(before);
  });

  it('merges the law by hunks: a concurrent edit elsewhere survives, overlapping hunks are refused naming the lines', () => {
    const { human, agent, base } = scene();
    setLaw(human, LAW.replace('Flat paper.', 'Flat, matte paper.'));
    sync(human, agent);
    const sent = { 'DESIGN.md': LAW.replace('Plain words.', 'Short, plain words.').replace('persona: quiet-editorial', 'persona: bold-poster') };
    expect(publishSystem(agent, base, sent, false)).toEqual({ changed: ['DESIGN.md'], conflicts: [] });
    sync(human, agent);
    const merged = LAW.replace('Flat paper.', 'Flat, matte paper.').replace('Plain words.', 'Short, plain words.').replace('persona: quiet-editorial', 'persona: bold-poster');
    expect(readSystem(human).law).toBe(merged);
    expect(readSystem(human).meta!.persona).toBe('bold-poster');

    const again = scene();
    setLaw(again.human, LAW.replace('Flat paper.', 'Flat grey paper.'));
    sync(again.human, again.agent);
    const result = publishSystem(again.agent, again.base, { 'DESIGN.md': LAW.replace('Flat paper.', 'Flat white paper.') }, false);
    const line = LAW.split('\n').indexOf('Flat paper.') + 1;
    expect(result).toEqual({ changed: [], conflicts: [{ path: 'DESIGN.md', detail: expect.stringContaining(`line ${line}`) }] });
  });

  it('refuses two insertions at one place in the law (no order both sides agreed on)', () => {
    const { human, agent, base } = scene();
    setLaw(human, LAW.replace('None.', 'None.\n\nHuman note.'));
    sync(human, agent);
    expect(publishSystem(agent, base, { 'DESIGN.md': LAW.replace('None.', 'None.\n\nAgent note.') }, false).conflicts).toHaveLength(1);
  });

  it('writes a law to a system that had none (the adopt route after a Claude import)', () => {
    const { human, agent, base } = scene(TIDEWATER_FILES);
    expect(base['DESIGN.md']).toBeUndefined();
    expect(publishSystem(agent, base, { 'DESIGN.md': LAW }, false)).toEqual({ changed: ['DESIGN.md'], conflicts: [] });
    sync(human, agent);
    expect(readSystem(human).law).toBe(LAW);
  });

  it('conflicts on a canon file by file: the human’s change to another file is kept, a file changed on both sides is refused', () => {
    const { human, agent, base } = scene();
    setFile(human, 'components/chip.html', CHIP.replace('Due Friday', 'Due Monday'));
    sync(human, agent);
    const add = `<div style="color:var(--ds-color-text)">Note</div>`;
    expect(publishSystem(agent, base, { 'layouts/title.html': null, 'components/note.html': add }, false)).toEqual({ changed: ['components/note.html', 'layouts/title.html'], conflicts: [] });
    sync(human, agent);
    expect(readSystem(human).files).toEqual({ 'components/chip.html': CHIP.replace('Due Friday', 'Due Monday'), 'components/document.css': DOCUMENT_CSS, 'components/note.html': add });
    expect(publishSystem(agent, base, { 'components/chip.html': CHIP.replace('Due Friday', 'Due Sunday') }, false)).toEqual({
      changed: [],
      conflicts: [{ path: 'components/chip.html', detail: expect.any(String) }],
    });
  });

  it('lands whole or not at all: one conflicting file holds back every other file of the publish', () => {
    const { human, agent, base } = scene();
    setFile(human, 'components/chip.html', CHIP.replace('Due Friday', 'Due Monday'));
    sync(human, agent);
    const before = stateVector(agent);
    const sent = {
      'DESIGN.md': LAW.replace('Plain words.', 'Short words.'),
      'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.accent.$root': color('#cc3300') }),
      'components/chip.html': CHIP.replace('Due Friday', 'Due Sunday'),
    };
    const result = publishSystem(agent, base, sent, false);
    expect(result).toEqual({ changed: [], conflicts: [{ path: 'components/chip.html', detail: expect.any(String) }] });
    expect(stateVector(agent)).toEqual(before);
    expect(readFiles(agent)['DESIGN.md']).toBe(LAW);
  });

  it('refuses invalid content before writing anything: a bad token file, a generated or read-only file, a non-canon path', () => {
    const { agent, base } = scene(TIDEWATER_FILES);
    const before = stateVector(agent);
    const attempt = (sent: Record<string, string | null>, force = false) => {
      try {
        publishSystem(agent, base, sent, force);
      } catch (error) {
        return error as SystemFilesError;
      }
      throw new Error('expected a refusal');
    };
    const bad = attempt({ 'DESIGN.md': LAW, 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.text.$root': undefined }) });
    expect(bad.problems.every((p) => p.path === 'tokens.tokens.json')).toBe(true);
    expect(bad.problems.some((p) => p.message.includes('color.text.$root'))).toBe(true);
    expect(attempt({ 'tokens.css': ':root{}' }, true).problems).toEqual([{ path: 'tokens.css', message: expect.stringMatching(/generated/) }]);
    expect(attempt({ 'office-theme.json': '{}' }).problems[0]!.path).toBe('office-theme.json');
    expect(attempt({ [`${CLAUDE_SOURCES}tokens.json`]: '{}' }).problems[0]!.message).toMatch(/read-only/);
    expect(attempt({ 'tokens.tokens.json': null }).problems[0]!.message).toMatch(/cannot be removed/);
    expect(attempt({ 'readme.md': 'x' }).problems[0]!.path).toBe('readme.md');
    expect(stateVector(agent)).toEqual(before);
  });

  it('with force, writes the sent files as sent over the other side’s changes', () => {
    const { human, agent, base } = scene();
    setToken(human, 'color.accent.$root', color('#0055aa'));
    setToken(human, 'color.bg.$root', color('#fafafa'));
    setLaw(human, LAW.replace('Flat paper.', 'Flat grey paper.'));
    setFile(human, 'components/chip.html', CHIP.replace('Due Friday', 'Due Monday'));
    sync(human, agent);
    const sentTokens = tokensWith(base['tokens.tokens.json']!, { 'color.accent.$root': color('#cc3300') });
    const sent = { 'tokens.tokens.json': sentTokens, 'DESIGN.md': LAW.replace('Flat paper.', 'Flat white paper.'), 'components/chip.html': CHIP };
    // The chip was sent as read: no conflict, but `force` writes it as sent over the human's change.
    expect(publishSystem(agent, base, sent, false).conflicts.map((c) => c.path)).toEqual(['DESIGN.md', 'tokens.tokens.json']);
    expect(publishSystem(agent, base, sent, true)).toEqual({ changed: ['DESIGN.md', 'tokens.tokens.json', 'components/chip.html'], conflicts: [] });
    sync(human, agent);
    const out = readFiles(human);
    expect(out['tokens.tokens.json']).toBe(sentTokens);
    expect(out['DESIGN.md']).toBe(sent['DESIGN.md']);
    expect(out['components/chip.html']).toBe(CHIP);
  });

  it('writes only the tokens that change, so token-level authorship stays with whoever set each one', () => {
    const { human, agent, base } = scene();
    setToken(human, 'color.bg.$root', color('#fafafa'));
    sync(human, agent);
    const written: string[] = [];
    agent.get('tokens').observe((event) => written.push(...event.keysChanged));
    publishSystem(agent, base, { 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.accent.$root': color('#cc3300') }) }, false);
    expect(written).toEqual(['color.accent.$root']);
  });

  it('checks published canon with the adapter’s parser', () => {
    const { agent, base } = scene();
    const checked = createDesignSystemAdapter({ parser });
    expect(() => checked.publish!(agent, base, { 'components/bad.html': '<div onclick="x()">x</div>' }, false)).toThrow(SystemFilesError);
    expect(designSystemAdapter.publish!(agent, base, { 'components/bad.html': '<div onclick="x()">x</div>' }, false).changed).toEqual(['components/bad.html']);
  });

  it('is the design_system kind’s adapter: its readFiles and publish are the model’s', () => {
    expect(designSystemAdapter.kind).toBe('design_system');
    const { agent } = scene();
    expect(designSystemAdapter.readFiles!(agent)).toEqual(readFiles(agent));
  });
});
