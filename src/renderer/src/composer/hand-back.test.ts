// Ticket 733a, the branch's review (finding 1; docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Design 5):
// an edit's text goes back into the composer by one helper, `handBackEdit`, which hands it over as its form's reader says
// (`composedPrefill`), as a Send from the bubble sends it, and by no other way. This guard reads the renderer's source:
// every file that names the composer's raw setter, `prefillComposer`, is listed with what it hands the composer, and the
// helper's calls are counted by file, so a new place that puts text back into the composer is classified before it can
// skip the helper. A comment on a line of its own is not read. What a file reaches by a computed name is outside what a reading of the text can
// see.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));
const RENDERER = join(REPOSITORY, 'src/renderer/src');

// Every product file of the renderer that names the raw setter, and what it hands the composer
const SETTER_FILES: Record<string, string> = {
  'src/renderer/src/stores/composer.ts': 'the setter itself, and `clearComposer`, an empty prefill',
  'src/renderer/src/composer/index.tsx': 'the composer’s public surface, which re-exports it',
  'src/renderer/src/composer/hand-back.ts': 'the helper: an edit, as its form’s reader says (`composedPrefill`)',
  'src/renderer/src/library/MakeSomethingNew.tsx': 'the words the person chose in the dialog; no stored row',
  'src/renderer/src/sessions/connect.ts': 'a first message a card or a failed start hands back, the composer’s own draft as it serialised it; no stored row',
  'src/renderer/src/widgets/MemoryWidget.tsx': 'the memory mode’s mark; no stored row',
  'src/renderer/src/widgets/RewindWidget.tsx': 'the engine’s text for the message rewound to, which holds no frame: the documented exclusion (the tech-debt tracker’s row 970, board ticket 740)',
};
// The helper's calls, by file: the resubmit seam's Cancel after a rewind, and its rewind whose target was gone
const HAND_BACKS: Record<string, number> = { 'src/renderer/src/composer/resubmit-seam.ts': 2 };

type Source = { file: string; text: string };

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
// A file's code: the comments that stand on lines of their own taken out (one after code on its line is read, which can
// only list a file more)
const codeOf = (text: string) => text.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');
const scan = (): Source[] => files(RENDERER).map((path) => ({ file: relative(REPOSITORY, path).split(sep).join('/'), text: codeOf(readFileSync(path, 'utf8')) }));

// What the list does not account for: a file naming the setter that it does not hold, a listed file that no longer names it
function unlisted(sources: readonly Source[]): string[] {
  const naming = new Set(sources.filter(({ text }) => /\bprefillComposer\b/.test(text)).map(({ file }) => file));
  return [...[...naming].filter((file) => !(file in SETTER_FILES)).map((file) => `${file}: names the composer’s raw setter, and is not listed`), ...Object.keys(SETTER_FILES).filter((file) => !naming.has(file)).map((file) => `${file}: listed, but no longer names the setter`)];
}

// The helper's calls by file, its own module left out
function handBacks(sources: readonly Source[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { file, text } of sources) {
    if (file === 'src/renderer/src/composer/hand-back.ts') continue;
    const calls = text.match(/\bhandBackEdit\s*\(/g)?.length ?? 0;
    if (calls > 0) out[file] = calls;
  }
  return out;
}

describe('an edit goes back into the composer by one helper (ticket 733a, the branch’s review)', () => {
  it('every file that names the composer’s raw setter is listed with what it hands the composer; the resubmit seam is not among them', () => {
    const sources = scan();
    expect(unlisted(sources)).toEqual([]);
    expect(sources.find(({ file }) => file === 'src/renderer/src/composer/resubmit-seam.ts')?.text).not.toMatch(/\bprefillComposer\b/);
  });

  it('the hand-back sites are the helper’s calls: the resubmit seam’s two, Cancel after a rewind and a rewind whose target was gone', () => {
    expect(handBacks(scan())).toEqual(HAND_BACKS);
  });

  it('goes red on a file that names the setter and is not listed, on a listed file that no longer names it, and on a new call of the helper; a comment naming the setter is not read', () => {
    const sources = scan();
    const added = (more: Source[]) => unlisted([...sources, ...more]).filter((problem) => !unlisted(sources).includes(problem));
    const planted = { file: 'src/renderer/src/planted.ts', text: codeOf("import { prefillComposer } from './stores/composer';\nexport const put = (id, row) => prefillComposer(id, { text: row.text });") };
    expect(added([planted])).toEqual(['src/renderer/src/planted.ts: names the composer’s raw setter, and is not listed']);
    expect(unlisted(sources.filter(({ file }) => file !== 'src/renderer/src/widgets/MemoryWidget.tsx'))).toContain('src/renderer/src/widgets/MemoryWidget.tsx: listed, but no longer names the setter');
    expect(added([{ file: 'src/renderer/src/commented.ts', text: codeOf('// what goes back through `prefillComposer`\nexport const x = 1;') }])).toEqual([]);
    expect(handBacks([...sources, { file: 'src/renderer/src/planted.ts', text: 'handBackEdit(id, edit);' }])).toEqual({ ...handBacks(sources), 'src/renderer/src/planted.ts': 1 });
  });
});
