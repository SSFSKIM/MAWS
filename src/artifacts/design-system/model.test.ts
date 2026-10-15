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
  readOrigin,
  readSystem,
  setFile,
  setLaw,
  setToken,
  SystemFilesError,
  writeSystem,
  type SystemOrigin,
} from './model';
import { parseLaw } from './law';
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
    // Derived metadata is computed from the law on read, never stored (Decision Log 12): a titled law stores no name.
    expect(doc.get('meta').getAttrs()).toEqual({ formatVersion: 1, origin: { route: 'adopted', from: 'Harbor web', at: AT } });
  });

  it('reads the persona and the name off the converged law, so concurrent edits of the persona line agree on every replica', () => {
    const { human, agent } = scene();
    setLaw(human, LAW.replace('persona: quiet-editorial', 'persona: bold-poster'));
    setLaw(agent, LAW.replace('persona: quiet-editorial', 'persona: quiet-gallery').replace('# Harbor', '# Harbor Press'));
    sync(human, agent);
    const law = readSystem(human).law;
    expect(readSystem(agent).law).toBe(law);
    for (const doc of [human, agent]) {
      expect(readSystem(doc).meta!.persona).toBe(parseLaw(law).persona ?? undefined);
      expect(readSystem(doc).meta!.name).toBe('Harbor Press');
      expect(doc.get('meta').hasAttr('persona')).toBe(false);
    }
    setLaw(human, LAW.replace('persona: quiet-editorial\n', ''));
    expect(readSystem(human).meta!.persona).toBeUndefined();
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
    expect(doc.get('meta').getAttr('name')).toBe('Tidewater'); // stored at creation: the system has no law to title it
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

  it('bounds setFile as create and publish are bounded: a file’s size and the canon’s count', () => {
    const { human } = scene();
    expect(() => setFile(human, 'components/big.html', `<div>${'x'.repeat(64 * 1024)}</div>`)).toThrow(/components\/big\.html/);
    for (let i = 0; i < 61; i++) setFile(human, `components/c${i}.html`, CHIP); // 64 canon files with the scene's three
    expect(() => setFile(human, 'components/one-more.html', CHIP)).toThrow(/at most 64/);
    setFile(human, 'components/c0.html', CHIP.replace('Due', 'Done')); // replacing one keeps the count
    expect(readSystem(human).files['components/big.html']).toBeUndefined();
  });

  it('checks a set canon file’s structure when given a parser', () => {
    const { human } = scene(); // three canon files: well under the count, so only the parser can refuse
    const bad = '<div onclick="x()">x</div>';
    expect(() => setFile(human, 'components/chip.html', bad, { parser })).toThrow(/components\/chip\.html/);
    expect(readSystem(human).files['components/chip.html']).toBe(CHIP);
    setFile(human, 'components/chip.html', bad); // without a parser, only paths and limits are checked
    expect(readSystem(human).files['components/chip.html']).toBe(bad);
  });

  it('writes a token by its identity: `x` replaces `x.$root`, one stored key per token', () => {
    const { human } = scene();
    setToken(human, 'color.bg', color('#000000'));
    expect(human.get('tokens').hasAttr('color.bg.$root')).toBe(false);
    expect(tokenOf(human, 'color.bg.$root')).toEqual(color('#000000')); // read as the group's $root: color.bg holds raised
    expect(readFiles(human)['tokens.css']).toContain('--ds-color-bg: #000000');
  });

  it('accepts a token beneath a role from the page and from a publish: the role reads as its $root and the file validates', () => {
    const { human, agent, base } = scene();
    setToken(human, 'color.border.strong', color('#000000'));
    sync(human, agent);
    const out = readFiles(human);
    expect(validateTokenFile(out['tokens.tokens.json']).problems).toEqual([]);
    expect(parseTokens(out['tokens.tokens.json']).tokens!.tokens.has('color.border.$root')).toBe(true);
    expect(out['tokens.css']).toMatch(/--ds-color-border: #[0-9a-f]{6,8};/);
    expect(out['tokens.css']).toContain('--ds-color-border-strong: #000000;');
    expect(out['office-theme.json']).toBeDefined();
    // The agent, from its older read, adds another token beneath the same role (writing the role as its $root, as a
    // file must): one token by identity, unchanged, so it merges with no conflict.
    const border = parseTokens(base['tokens.tokens.json']!).tokens!.tokens.get('color.border')!;
    const sent = { 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.border': undefined, 'color.border.$root': border, 'color.border.subtle': color('#cccccc') }) };
    expect(publishSystem(agent, base, sent, false)).toEqual({ changed: ['tokens.tokens.json'], conflicts: [] });
    expect(validateTokenFile(readFiles(agent)['tokens.tokens.json']).problems).toEqual([]);
  });

  it('reads replicas that converged on a token and a token beneath it without loss, the parent as its group’s $root', () => {
    const { human, agent } = scene();
    setToken(human, 'color.branch', color('#112233'));
    setToken(agent, 'color.branch.light', color('#ddeeff'));
    sync(human, agent);
    for (const doc of [human, agent]) {
      const tokens = parseTokens(readFiles(doc)['tokens.tokens.json']!).tokens!;
      expect(tokens.tokens.get('color.branch.$root')).toEqual(color('#112233'));
      expect(tokens.tokens.get('color.branch.light')).toEqual(color('#ddeeff'));
      expect(readFiles(doc)['tokens.css']).toContain('--ds-color-branch: #112233');
      expect(readFiles(doc)['tokens.css']).toContain('--ds-color-branch-light: #ddeeff');
    }
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
    expect(readSystem(human).meta!.name).toBe('Harbor');
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

  it('with force, the agent wins only on the units both sides changed, and everything else still merges', () => {
    const { human, agent, base } = scene();
    setToken(human, 'color.accent.$root', color('#0055aa'));
    setToken(human, 'color.bg.$root', color('#fafafa'));
    setLaw(human, LAW.replace('Flat paper.', 'Flat grey paper.').replace('Plain words.', 'Plain, short words.'));
    setFile(human, 'components/chip.html', CHIP.replace('Due Friday', 'Due Monday'));
    setFile(human, 'layouts/title.html', TITLE.replace('Lab safety', 'Lab rules'));
    sync(human, agent);
    const sentTokens = tokensWith(base['tokens.tokens.json']!, { 'color.accent.$root': color('#cc3300') });
    const sent = {
      'tokens.tokens.json': sentTokens,
      'DESIGN.md': LAW.replace('Flat paper.', 'Flat white paper.'),
      'components/chip.html': CHIP, // sent as read: not the agent's change
      'layouts/title.html': TITLE.replace('Lab safety', 'Lab hazards'),
    };
    expect(publishSystem(agent, base, sent, false).conflicts.map((c) => c.path)).toEqual(['DESIGN.md', 'tokens.tokens.json', 'layouts/title.html']);
    expect(publishSystem(agent, base, sent, true)).toEqual({ changed: ['DESIGN.md', 'tokens.tokens.json', 'layouts/title.html'], conflicts: [] });
    sync(human, agent);
    for (const doc of [human, agent]) {
      expect(tokenOf(doc, 'color.accent.$root')).toEqual(color('#cc3300')); // colliding token: the agent's
      expect(tokenOf(doc, 'color.bg.$root')).toEqual(color('#fafafa')); // a token the agent never touched: the human's
      expect(readSystem(doc).law).toBe(LAW.replace('Flat paper.', 'Flat white paper.').replace('Plain words.', 'Plain, short words.'));
      expect(readSystem(doc).files['components/chip.html']).toBe(CHIP.replace('Due Friday', 'Due Monday'));
      expect(readSystem(doc).files['layouts/title.html']).toBe(TITLE.replace('Lab safety', 'Lab hazards'));
    }
  });

  it('with force, the agent’s law hunk replaces every live change it collides with, and only those', () => {
    const { human, agent, base } = scene();
    // Live changes before, inside and after the agent's colliding hunk; the agent also changes a line after it.
    setLaw(human, LAW.replace('warm paper.', 'warm, heavy paper.').replace('Two columns on wide pages.', 'Three columns on wide pages.').replace('None.', 'Nothing moves.'));
    sync(human, agent);
    const sent = { 'DESIGN.md': LAW.replace('Two columns on wide pages.', 'One column, always.').replace('Plain words.', 'Short words.') };
    expect(publishSystem(agent, base, sent, false).conflicts).toHaveLength(1);
    expect(publishSystem(agent, base, sent, true).changed).toEqual(['DESIGN.md']);
    sync(human, agent);
    const expected = LAW.replace('warm paper.', 'warm, heavy paper.').replace('Two columns on wide pages.', 'One column, always.').replace('Plain words.', 'Short words.').replace('None.', 'Nothing moves.');
    expect(readSystem(agent).law).toBe(expected);
    expect(readSystem(human).law).toBe(expected);
  });

  it('merges a token and a token the other side made beneath it, losslessly: the parent reads as its group’s $root', () => {
    const { human, agent, base } = scene();
    setToken(human, 'color.branch.light', color('#ddeeff'));
    sync(human, agent);
    const sent = { 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.branch': color('#112233') }) };
    expect(publishSystem(agent, base, sent, false)).toEqual({ changed: ['tokens.tokens.json'], conflicts: [] });
    sync(human, agent);
    const tokens = parseTokens(readFiles(human)['tokens.tokens.json']!).tokens!;
    expect(tokens.tokens.get('color.branch.$root')).toEqual(color('#112233'));
    expect(tokens.tokens.get('color.branch.light')).toEqual(color('#ddeeff'));
    // The agent's next publish, from a read of that file, sees `color.branch.$root` as the same token it wrote.
    const reread = readFiles(agent);
    expect(publishSystem(agent, reread, { 'tokens.tokens.json': reread['tokens.tokens.json']! }, false)).toEqual({ changed: [], conflicts: [] });
  });

  it('keys tokens by identity: a token both sides created with different values conflicts, though a stale base hides one form', () => {
    // The agent read only the child; a human then made the parent; the agent converts the child into the parent.
    const { human, agent } = scene();
    setToken(human, 'color.branch.light', color('#ddeeff'));
    sync(human, agent);
    const base = readFiles(agent);
    const other = newDoc();
    sync(human, agent, other);
    setToken(other, 'color.branch', color('#112233'));
    sync(other, agent);
    const before = stateVector(agent);
    const sent = { 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.branch.light': undefined, 'color.branch': color('#445566') }) };
    const result = publishSystem(agent, base, sent, false);
    expect(result).toEqual({ changed: [], conflicts: [{ path: 'tokens.tokens.json', detail: expect.stringContaining('the token color.branch changed') }] });
    expect(stateVector(agent)).toEqual(before);
    expect(tokenOf(agent, 'color.branch.$root')).toEqual(color('#112233'));
    // With force the agent wins that token: one stored key, its value, the child it removed gone.
    expect(publishSystem(agent, base, sent, true).changed).toEqual(['tokens.tokens.json']);
    expect(tokenOf(agent, 'color.branch')).toEqual(color('#445566'));
    expect(tokenOf(agent, 'color.branch.light')).toBeUndefined();
    expect([...agent.get('tokens').attrKeys()].filter((key) => String(key).startsWith('color.branch'))).toEqual(['color.branch']);
  });

  it('takes a token stored under both `x` and `x.$root` with different values as changed live, so an agent change to it conflicts', () => {
    const { human, agent, base } = scene();
    human.get('tokens').setAttr('color.highlight.$root', color('#123456')); // a second replica's write of the same token
    sync(human, agent);
    expect(tokenOf(agent, 'color.highlight.$root')).toEqual(color('#123456')); // the $root form is the one read
    const sent = { 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.highlight': color('#abcdef') }) };
    expect(publishSystem(agent, base, sent, false).conflicts).toEqual([{ path: 'tokens.tokens.json', detail: expect.stringContaining('color.highlight') }]);
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

// M7's live run: the agent's `artifact_create {kind: 'design_system', files}` is A's create, whose `initial(doc)` is this
// kind's publish over an empty doc with an empty base. A doc that holds no system yet is written whole, as a create.
describe('publish over a doc that holds no system yet: the agent’s create', () => {
  it('writes the whole system with its meta, so it reads, renders and mirrors as a system', () => {
    const doc = newDoc();
    const result = publishSystem(doc, {}, FILES, false);
    expect(result.conflicts).toEqual([]);
    expect(result.changed.sort()).toEqual(Object.keys(FILES).sort());
    expect(readSystem(doc).meta).toMatchObject({ formatVersion: 1, name: 'Harbor', origin: { route: 'derived' } });
    expect(readFiles(doc)).toMatchObject({ 'DESIGN.md': LAW, 'tokens.tokens.json': TOKENS, 'layouts/title.html': TITLE });
  });

  it('records the adopt route when the law says what the system was adopted from', () => {
    const doc = newDoc();
    publishSystem(doc, {}, { ...FILES, 'DESIGN.md': LAW.replace('Quiet print on warm paper.', 'Adopted from the Harbor site’s CSS variables. Quiet print on warm paper.') }, false);
    expect(readOrigin(doc)).toMatchObject({ route: 'adopted', from: 'the Harbor site’s CSS variables' });
    // the live run's wording: a bullet naming the file, whose dot does not end the sentence
    const bullet = newDoc();
    publishSystem(bullet, {}, { ...FILES, 'DESIGN.md': LAW.replace('Quiet print on warm paper.', 'Quiet print.\n- Adopted from the site’s CSS variables (`src/styles/variables.css`).') }, false);
    expect(readOrigin(bullet)).toMatchObject({ route: 'adopted', from: 'the site’s CSS variables (`src/styles/variables.css`)' });
  });

  it('imports files in Claude’s shape, as a create does', () => {
    const doc = newDoc();
    publishSystem(doc, {}, TIDEWATER_FILES, false);
    expect(readOrigin(doc)).toMatchObject({ route: 'imported' });
    expect(Object.keys(readFiles(doc)).some((path) => path.startsWith(CLAUDE_SOURCES))).toBe(true);
  });

  // Review M7a I1: a removal the system cannot take is refused as it is over a live system, before anything is written
  it.each([
    ['tokens.css', 'generated'],
    [`${CLAUDE_SOURCES}README.md`, 'read-only'],
    ['assets/logo.png', 'an asset'],
    ['notes.txt', 'not a design-system file'],
    ['DESIGN.md', 'cannot be removed'],
  ])('refuses %s sent as null, naming it, and writes nothing, with or without force', (path, words) => {
    for (const force of [false, true]) {
      const doc = newDoc();
      const sent: Record<string, string | null> = { ...FILES, [path]: null };
      let refused: unknown = null;
      try {
        publishSystem(doc, {}, sent, force);
      } catch (error) {
        refused = error;
      }
      expect(refused).toBeInstanceOf(SystemFilesError);
      expect((refused as SystemFilesError).message).toContain(`${path}: `);
      expect((refused as SystemFilesError).message).toContain(words);
      const held = readSystem(doc);
      expect([held.meta, held.tokens.tokens.size, held.law, held.files]).toEqual([null, 0, '', {}]);
    }
  });

  it('takes a canon removal as nothing to remove', () => {
    const doc = newDoc();
    const result = publishSystem(doc, {}, { ...FILES, 'layouts/old.html': null }, false);
    expect(result.changed).not.toContain('layouts/old.html');
    expect(Object.keys(readFiles(doc))).not.toContain('layouts/old.html');
  });

  it('refuses a system without its token file, naming it, and writes nothing', () => {
    const doc = newDoc();
    expect(() => publishSystem(doc, {}, { 'DESIGN.md': LAW }, false)).toThrow(SystemFilesError);
    expect(readSystem(doc).meta).toBeNull();
  });
});

describe('converged hierarchies: replicas that each wrote a valid file converge on overlapping tokens (Decision Log 12)', () => {
  /** Replicas `n` more beside the scene's, all in sync with it, each a separate Yjs client. */
  function replicas(n: number, ...docs: Doc[]): Doc[] {
    const out = Array.from({ length: n }, () => newDoc());
    sync(...docs, ...out);
    return out;
  }
  const tokensOf = (doc: Doc) => parseTokens(readFiles(doc)['tokens.tokens.json']!);

  it('concurrent setters: the file view keeps the parent and the child on both replicas, and publish sees the parent', () => {
    const { human, agent, base } = scene(); // the agent's base predates both edits
    setToken(human, 'color.branch', color('#112233'));
    setToken(agent, 'color.branch.light', color('#ddeeff'));
    sync(human, agent);
    for (const doc of [human, agent]) {
      const read = tokensOf(doc);
      expect(read.problems).toEqual([]);
      expect(read.tokens!.tokens.get('color.branch.$root')).toEqual(color('#112233'));
      expect(read.tokens!.tokens.get('color.branch.light')).toEqual(color('#ddeeff'));
      expect(validateTokenFile(readFiles(doc)['tokens.tokens.json']).problems).toEqual([]);
    }
    // An agent that never saw the parent and creates it with another value conflicts on it.
    const before = stateVector(agent);
    const create = { 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.branch': color('#445566') }) };
    expect(publishSystem(agent, base, create, false)).toEqual({ changed: [], conflicts: [{ path: 'tokens.tokens.json', detail: expect.stringContaining('the token color.branch changed') }] });
    expect(stateVector(agent)).toEqual(before);
    // An unrelated change from that stale base lands and keeps both.
    const other = { 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.accent.$root': color('#cc3300') }) };
    expect(publishSystem(agent, base, other, false)).toEqual({ changed: ['tokens.tokens.json'], conflicts: [] });
    sync(human, agent);
    expect(tokensOf(human).tokens!.tokens.get('color.branch.$root')).toEqual(color('#112233'));
    expect(tokensOf(human).tokens!.tokens.get('color.branch.light')).toEqual(color('#ddeeff'));
    // The agent's read of the converged file, sent back unchanged, is no change.
    const reread = readFiles(agent);
    expect(publishSystem(agent, reread, { 'tokens.tokens.json': reread['tokens.tokens.json']! }, false)).toEqual({ changed: [], conflicts: [] });
  });

  it('at depth: a token, a token two groups beneath it and one between, from three replicas, all read', () => {
    const { human, agent, base } = scene();
    const [third] = replicas(1, human, agent);
    setToken(human, 'color.branch', color('#112233'));
    setToken(agent, 'color.branch.tint.light', color('#ddeeff'));
    setToken(third!, 'color.branch.tint', color('#778899'));
    sync(human, agent, third!);
    for (const doc of [human, agent, third!]) {
      const read = tokensOf(doc);
      expect(read.problems).toEqual([]);
      expect(read.tokens!.tokens.get('color.branch.$root')).toEqual(color('#112233'));
      expect(read.tokens!.tokens.get('color.branch.tint.$root')).toEqual(color('#778899'));
      expect(read.tokens!.tokens.get('color.branch.tint.light')).toEqual(color('#ddeeff'));
      const css = readFiles(doc)['tokens.css']!;
      for (const line of ['--ds-color-branch: #112233', '--ds-color-branch-tint: #778899', '--ds-color-branch-tint-light: #ddeeff']) expect(css).toContain(line);
    }
    const sent = { 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.branch.tint': color('#000000') }) };
    expect(publishSystem(agent, base, sent, false).conflicts).toEqual([{ path: 'tokens.tokens.json', detail: expect.stringContaining('color.branch.tint') }]);
  });

  it('a token where another replica made a group with its own properties: both read, the token as the group’s $root', () => {
    const { human, agent, base } = scene();
    setToken(human, 'color.branch', { $value: color('#112233').$value }); // its type inherited from `color`
    const set = parseTokens(base['tokens.tokens.json']!).tokens!;
    const sent = serializeTokens({
      tokens: new Map(set.tokens).set('color.branch.light', { $value: color('#ddeeff').$value }),
      groups: new Map(set.groups).set('color.branch', { $description: 'Branch tints' }),
    });
    expect(publishSystem(agent, base, { 'tokens.tokens.json': sent }, false).conflicts).toEqual([]);
    sync(human, agent);
    for (const doc of [human, agent]) {
      const read = tokensOf(doc);
      expect(read.problems).toEqual([]);
      expect(read.tokens!.tokens.get('color.branch.$root')).toEqual({ $value: color('#112233').$value });
      expect(read.tokens!.groups.get('color.branch')).toEqual({ $description: 'Branch tints' });
      expect(read.tokens!.tokens.get('color.branch.light')).toEqual({ $value: color('#ddeeff').$value });
    }
  });

  it('a token whose type a group made over it would change: the file view keeps the token’s value and type', () => {
    const { human, agent, base } = scene();
    setToken(human, 'color.branch', { $value: color('#112233').$value }); // a colour by inheritance from `color`
    const set = parseTokens(base['tokens.tokens.json']!).tokens!;
    const sent = serializeTokens({
      tokens: new Map(set.tokens).set('color.branch.gap', { $value: { value: 4, unit: 'px' } }),
      groups: new Map(set.groups).set('color.branch', { $type: 'dimension' }),
    });
    expect(publishSystem(agent, base, { 'tokens.tokens.json': sent }, false).conflicts).toEqual([]);
    sync(human, agent);
    for (const doc of [human, agent]) {
      const read = tokensOf(doc);
      expect(read.problems).toEqual([]);
      expect(read.tokens!.tokens.get('color.branch.gap')).toEqual({ $value: { value: 4, unit: 'px' } });
      expect(read.tokens!.tokens.get('color.branch.$root')).toEqual({ $type: 'color', $value: color('#112233').$value }); // the type it inherited, written on it
      expect(read.tokens!.tokens.get('color.branch.gap')).toEqual({ $value: { value: 4, unit: 'px' } });
      expect(readFiles(doc)['tokens.css']).toContain('--ds-color-branch: #112233');
      expect(readFiles(doc)['tokens.css']).toContain('--ds-color-branch-gap: 4px');
    }
    // The agent's read, sent back, is no change; a change to that token from it lands with no conflict.
    const reread = readFiles(agent);
    expect(publishSystem(agent, reread, { 'tokens.tokens.json': reread['tokens.tokens.json']! }, false)).toEqual({ changed: [], conflicts: [] });
    const recolour = tokensWith(reread['tokens.tokens.json']!, { 'color.branch.$root': color('#445566') });
    expect(publishSystem(agent, reread, { 'tokens.tokens.json': recolour }, false)).toEqual({ changed: ['tokens.tokens.json'], conflicts: [] });
    expect(tokensOf(agent).tokens!.tokens.get('color.branch.$root')).toEqual(color('#445566'));
  });

  it('a group with its own type published over a live token the agent never read: merged, the token keeping its type', () => {
    const { human, agent, base } = scene();
    setToken(human, 'color.branch', { $value: color('#112233').$value });
    sync(human, agent);
    const set = parseTokens(base['tokens.tokens.json']!).tokens!;
    const sent = serializeTokens({
      tokens: new Map(set.tokens).set('color.branch.gap', { $value: { value: 4, unit: 'px' } }),
      groups: new Map(set.groups).set('color.branch', { $type: 'dimension' }),
    });
    expect(publishSystem(agent, base, { 'tokens.tokens.json': sent }, false)).toEqual({ changed: ['tokens.tokens.json'], conflicts: [] });
    sync(human, agent);
    const read = tokensOf(human);
    expect(read.problems).toEqual([]);
    expect(read.tokens!.tokens.get('color.branch.$root')).toEqual({ $type: 'color', $value: color('#112233').$value });
    expect(validateTokenFile(readFiles(human)['tokens.tokens.json']).problems).toEqual([]);
  });

  it('`x` and `x.$root` both stored, with something beneath: one token read, and an agent change to it conflicts', () => {
    const { human, agent, base } = scene();
    setToken(human, 'color.branch.$root', color('#112233'));
    setToken(agent, 'color.branch', color('#445566'));
    const [third] = replicas(1, human, agent);
    setToken(third!, 'color.branch.light', color('#ddeeff'));
    sync(human, agent, third!);
    for (const doc of [human, agent]) {
      const read = tokensOf(doc);
      expect(read.problems).toEqual([]);
      expect(read.tokens!.tokens.get('color.branch.$root')).toEqual(color('#112233'));
      expect(read.tokens!.tokens.get('color.branch.light')).toEqual(color('#ddeeff'));
    }
    const sent = { 'tokens.tokens.json': tokensWith(base['tokens.tokens.json']!, { 'color.branch': color('#000000') }) };
    expect(publishSystem(agent, base, sent, false).conflicts).toEqual([{ path: 'tokens.tokens.json', detail: expect.stringContaining('color.branch') }]);
    const reread = readFiles(agent);
    expect(publishSystem(agent, reread, { 'tokens.tokens.json': tokensWith(reread['tokens.tokens.json']!, { 'color.branch.$root': color('#000000') }) }, false).conflicts).toEqual([
      { path: 'tokens.tokens.json', detail: expect.stringContaining('color.branch') },
    ]);
  });
});

describe('the page’s token writes are canonical (Decision Log 19)', () => {
  const canonical = (hex: string) => parseTokens({ c: { $type: 'color', $value: hex } }).tokens!.tokens.get('c')!.$value;

  it('stores a lenient token in its canonical form, keeping the type it inherits implicit', () => {
    const { human } = scene();
    setToken(human, 'color.accent.$root', { $value: '#C93' });
    expect(human.get('tokens').getAttr('color.accent.$root')).toEqual({ $value: canonical('#cc9933') });
    setToken(human, 'space.3', { $value: 12 }); // a bare number for a px dimension
    expect(human.get('tokens').getAttr('space.3')).toEqual({ $value: { value: 12, unit: 'px' } });
    setToken(human, 'color.highlight', { $type: 'color', $value: '#ffee00' }); // a type of its own stays
    expect(human.get('tokens').getAttr('color.highlight')).toEqual({ $type: 'color', $value: canonical('#ffee00') });
    setToken(human, 'color.accent.text', { $value: '{color.bg.$root}' }); // a reference stays as written
    expect(human.get('tokens').getAttr('color.accent.text')).toEqual({ $value: '{color.bg.$root}' });
  });

  it('after a lenient write, an agent publish merges cleanly: another token’s change lands, and so does a change of that token', () => {
    const { human, agent } = scene();
    setToken(human, 'color.accent.$root', { $value: '#c9663f' });
    sync(human, agent);
    const base = readFiles(agent);
    const other = tokensWith(base['tokens.tokens.json']!, { 'color.border': color('#123456') });
    expect(publishSystem(agent, base, { 'tokens.tokens.json': other }, false)).toEqual({ changed: ['tokens.tokens.json'], conflicts: [] });
    const reread = readFiles(agent);
    const same = tokensWith(reread['tokens.tokens.json']!, { 'color.accent.$root': color('#0055aa') });
    expect(publishSystem(agent, reread, { 'tokens.tokens.json': same }, false)).toEqual({ changed: ['tokens.tokens.json'], conflicts: [] });
    expect(readFiles(agent)['tokens.css']).toContain('--ds-color-accent: #0055aa');
  });

  it('refuses a token that does not parse, naming its path, and writes nothing', () => {
    const { human } = scene();
    const before = stateVector(human);
    const refusal = (token: Token) => {
      try {
        setToken(human, 'color.accent.$root', token);
      } catch (error) {
        return error;
      }
      return null;
    };
    for (const token of [{ $value: 'not a colour' }, { $type: 'colour', $value: '#000000' }, { $value: '#000000', $extra: 1 }] as Token[]) {
      const error = refusal(token);
      expect(error).toBeInstanceOf(SystemFilesError);
      expect((error as SystemFilesError).problems).toEqual([expect.objectContaining({ path: 'tokens.tokens.json', message: expect.stringContaining('color.accent.$root') })]);
    }
    expect(() => setToken(human, 'size.free', { $value: 3 })).toThrow(/size\.free: no \$type/); // nothing above it gives one
    expect(stateVector(human)).toEqual(before);
  });
});

describe('publish compares tokens by meaning, whatever form their type is written in (Decision Log 20)', () => {
  it('a recolour from a read older than a typed group converging over the token merges', () => {
    const { human, agent, base: older } = scene();
    setToken(human, 'color.branch', { $value: color('#112233').$value }); // a colour by inheritance from `color`
    sync(human, agent);
    const base = readFiles(agent); // the agent reads the parent before the typed group arrives
    // Another session, from a read that predates the parent, publishes a dimension group over it with a child.
    const set = parseTokens(older['tokens.tokens.json']!).tokens!;
    const typed = serializeTokens({
      tokens: new Map(set.tokens).set('color.branch.gap', { $value: { value: 4, unit: 'px' } }),
      groups: new Map(set.groups).set('color.branch', { $type: 'dimension' }),
    });
    expect(publishSystem(human, older, { 'tokens.tokens.json': typed }, false).conflicts).toEqual([]);
    sync(human, agent);
    const recolour = tokensWith(base['tokens.tokens.json']!, { 'color.branch': { $value: color('#445566').$value } });
    expect(publishSystem(agent, base, { 'tokens.tokens.json': recolour }, false)).toEqual({ changed: ['tokens.tokens.json'], conflicts: [] });
    const read = parseTokens(readFiles(agent)['tokens.tokens.json']!);
    expect(read.problems).toEqual([]);
    expect(read.tokens!.tokens.get('color.branch.$root')).toEqual({ $type: 'color', $value: color('#445566').$value });
    expect(read.tokens!.tokens.get('color.branch.gap')).toEqual({ $value: { value: 4, unit: 'px' } });
    expect(agent.get('tokens').getAttr('color.branch')).toEqual({ $value: color('#445566').$value }); // written as authored
  });

  it('an explicit type equal to the inherited one is no change, and a type changed live under the token still conflicts', () => {
    const { human, agent, base } = scene();
    const explicit = tokensWith(base['tokens.tokens.json']!, { 'color.border': { $type: 'color', ...parseTokens(base['tokens.tokens.json']!).tokens!.tokens.get('color.border')! } });
    expect(publishSystem(agent, base, { 'tokens.tokens.json': explicit }, false)).toEqual({ changed: [], conflicts: [] });
    // A number token whose group's type the human changes to fontWeight: same value, another meaning.
    const set = parseTokens(base['tokens.tokens.json']!).tokens!;
    const withScale = serializeTokens({ tokens: new Map(set.tokens).set('scale.x', { $value: 400 }), groups: new Map(set.groups).set('scale', { $type: 'number' }) });
    expect(publishSystem(agent, base, { 'tokens.tokens.json': withScale }, false).conflicts).toEqual([]);
    sync(human, agent);
    const read = readFiles(agent);
    const retyped = parseTokens(read['tokens.tokens.json']!).tokens!;
    expect(publishSystem(human, read, { 'tokens.tokens.json': serializeTokens({ tokens: retyped.tokens, groups: new Map(retyped.groups).set('scale', { $type: 'fontWeight' }) }) }, false).conflicts).toEqual([]);
    sync(human, agent);
    const change = tokensWith(read['tokens.tokens.json']!, { 'scale.x': { $value: 500 } });
    expect(publishSystem(agent, read, { 'tokens.tokens.json': change }, false).conflicts).toEqual([{ path: 'tokens.tokens.json', detail: expect.stringContaining('the token scale.x') }]);
  });
});
