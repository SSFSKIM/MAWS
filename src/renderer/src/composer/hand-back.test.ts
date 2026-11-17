// Ticket 733a, the branch's review (finding 1; docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Design 5):
// an edit's text goes back into the composer by one helper, `handBackEdit`, which hands it over as its form's reader says
// (`composedPrefill`), as a Send from the bubble sends it, and by no other way. This guard reads the renderer's source:
// every file that names the composer's raw setter, `prefillComposer`, is listed with what it hands the composer, and the
// helper's calls are counted by file, so a new place that puts text back into the composer is classified before it can
// skip the helper. A comment on a line of its own is not read. What a file reaches by a computed name is outside what a reading of the text can
// see.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { storedRowPrefill } from './composed-prefill'; // the architect's ruling 4366

const REPOSITORY = join(__dirname, '../../../..');
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

// The architect's ruling on history recall (2026-11-17): the guard is built from the callers. Every product module of the
// renderer that reads a stored row's text, by `typedFromRowText`, `rowPrefill` or the bubble's `editPrefill` (gone), or by
// any successor of them, is found by scanning: a successor is a definition, in a module that defines a reading, whose body
// names a reading (to a fixed point), so a new wrapper is a reading too; a module that takes such a module whole (a
// namespace import or re-export, a wildcard re-export, a dynamic import, a require) reads every one of them. A reading
// outside the modules that define one fails the guard unless excluded below; the helpers are what any module may call.
const READING_ROOTS = ['typedFromRowText', 'rowPrefill', 'editPrefill'];
const HELPERS = new Set(['composedPrefill', 'storedRowPrefill', 'handBackEdit']);
// The modules that define a reading, and why each may
const DEFINING: Record<string, string> = {
  'src/renderer/src/composer/composed-prefill.ts': 'the helper: a stored row read back as its form’s reader says',
  'src/renderer/src/composer/hand-back.ts': 'the helper’s way into the composer',
  'src/renderer/src/composer/editor/recall.ts': 'defines `typedFromRowText`; loads only the prefill it is handed',
  'src/renderer/src/composer/edit-prefill.ts': 'defines `rowPrefill`, the row’s raw reading; loads nothing',
};
// The readings outside them that put nothing of a stored row into the composer as typed, one reason each
const EXCLUDED: Record<string, string> = {
  'src/renderer/src/widgets/RewindWidget.tsx': 'the engine’s text for the message rewound to, which holds no frame: the documented exclusion (the tech-debt tracker’s row 970, board ticket 740)',
  'src/renderer/src/composer/resubmit-seam.ts': 'opens the bubble’s own editor, not the composer: the edit goes out through `composedPrefill` and back through `handBackEdit`',
  'src/renderer/src/composer/queue/entry-text.ts': 'reads a queued entry’s wire text, no stored row: the stack’s line prefills nothing, and the take-back (`entryDoc`) turns every segment into an atom',
};

const DEFINITION = /^(?:export\s+)?(?:async\s+)?(?:function\*?\s+([\w$]+)|(?:const|let)\s+([\w$]+)\s*[=:])/gm;
const names = (text: string, set: ReadonlySet<string>) => [...set].some((name) => new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(text));
// The readings: the roots, and every definition of a defining module whose body names one, to a fixed point
function readings(sources: readonly Source[]): Set<string> {
  const found = new Set(READING_ROOTS);
  const definitions = sources
    .filter(({ file }) => file in DEFINING)
    .flatMap(({ text }) => {
      const starts = [...text.matchAll(DEFINITION)];
      return starts.map((match, i) => ({ name: (match[1] ?? match[2])!, body: text.slice(match.index + match[0].length, starts[i + 1]?.index ?? text.length) }));
    });
  for (let grew = true; grew; ) {
    grew = false;
    for (const { name, body } of definitions)
      if (!found.has(name) && !HELPERS.has(name) && names(body, found)) {
        found.add(name);
        grew = true;
      }
  }
  return found;
}
const WHOLE = /(?:\bimport\s*\*\s*as\s+[\w$]+\s+from|\bexport\s*\*\s*(?:as\s+[\w$]+\s+)?from|\bimport\s*\(|\brequire\s*\()\s*(['"`])([^'"`]+)\1/g;
const moduleOf = (file: string, specifier: string) => (specifier.startsWith('.') ? relative(REPOSITORY, resolve(join(REPOSITORY, dirname(file)), specifier)).split(sep).join('/').replace(/\.[cm]?[jt]sx?$/, '') : specifier);
// The modules that read a stored row's text, outside the ones that define a reading
function readers(sources: readonly Source[]): string[] {
  const found = readings(sources);
  const defining = new Set(Object.keys(DEFINING).map((file) => file.replace(/\.tsx?$/, '')));
  return sources
    .filter(({ file }) => !(file in DEFINING))
    .filter(({ file, text }) => names(text, found) || [...text.matchAll(WHOLE)].some((match) => defining.has(moduleOf(file, match[2]!))))
    .map(({ file }) => file)
    .sort();
}
const unexcluded = (sources: readonly Source[]) => {
  const found = readers(sources);
  return [...found.filter((file) => !(file in EXCLUDED)).map((file) => `${file}: reads a stored row’s text, outside the helper`), ...Object.keys(EXCLUDED).filter((file) => !found.includes(file)).map((file) => `${file}: excluded, but no longer reads a stored row’s text`)];
};

describe('a stored row’s text goes back into the composer only through the helper (ticket 733a, the architect’s ruling on history recall)', () => {
  it('every module that reads a stored row’s text, by a reading or a successor of one, is the helper, a module that defines a reading, or excluded with its reason', () => {
    expect(unexcluded(scan())).toEqual([]);
  });

  it('goes red on a planted caller: of a reading, of a new successor, of a module taken whole, or of a reading renamed; a caller of the helper is not one', () => {
    const sources = scan();
    const recall = sources.find(({ file }) => file === 'src/renderer/src/composer/editor/recall.ts')!;
    const before = unexcluded(sources);
    // what the planted caller adds to what the scan already finds
    const planted = (text: string, more: Source[] = []) => unexcluded([...sources.filter(({ file }) => !more.some((other) => other.file === file)), ...more, { file: 'src/renderer/src/planted.ts', text: codeOf(text) }]).filter((problem) => !before.includes(problem));
    const red = ['src/renderer/src/planted.ts: reads a stored row’s text, outside the helper'];
    expect(planted("import { typedFromRowText } from './composer/editor/recall';\nexport const put = (row) => typedFromRowText(row.text);"), 'a reading').toEqual(red);
    expect(planted("import { typedFromRowText as asTyped } from './composer/editor/recall';\nexport const put = (row) => asTyped(row.text);"), 'a reading renamed').toEqual(red);
    expect(planted("import { plantedRowWordsOfTheGuard } from './composer/editor/recall';\nexport const put = (row) => plantedRowWordsOfTheGuard(row);", [{ ...recall, text: `${recall.text}\nexport const plantedRowWordsOfTheGuard = (row) => typedFromRowText(row.text);\n` }]), 'a new successor').toEqual(red);
    expect(planted("import * as recall from './composer/editor/recall';\nexport const put = (row) => recall['typed' + 'FromRowText'](row.text);"), 'a module taken whole').toEqual(red);
    expect(planted("export const load = () => import('./composer/edit-prefill');"), 'a module taken by a dynamic import').toEqual(red);
    expect(planted("import { storedRowPrefill } from './composer/composed-prefill';\nexport const put = (row) => storedRowPrefill(row).prefill;"), 'the helper: the control').toEqual([]);
  });
});

// The architect's ruling 4366 (the delta review): the row as drawn leaves `storedRowPrefill` only as strings, the search's
// text and the history's key, never as a prefill anything could load. Its result is read here in two ways: at run time,
// every field but `prefill` is a string; in the source, a module that calls it takes `prefill`, `search` or `key` and
// nothing else (a field by name, by destructuring, or off a binding), and never the result whole. A successor that hands
// the drawn row out is a reading by the scan above.
const RESULT_FIELDS = new Set(['prefill', 'search', 'key']);
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return text.length;
}
// What each module takes of the helper's result that is not one of its three fields
function resultTaken(sources: readonly Source[]): string[] {
  const problems: string[] = [];
  for (const { file, text } of sources) {
    if (file in DEFINING) continue;
    for (const call of text.matchAll(/\bstoredRowPrefill\s*\(/g)) {
      const after = text.slice(closingParen(text, call.index + call[0].length - 1) + 1);
      const before = text.slice(0, call.index);
      const field = /^\s*\.\s*([\w$]+)/.exec(after)?.[1];
      const destructured = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*$/.exec(before)?.[1];
      const bound = /(?:const|let|var)\s+([\w$]+)\s*=\s*$/.exec(before)?.[1];
      const taken: string[] = [];
      if (field !== undefined) taken.push(field);
      else if (/^\s*\[/.test(after)) taken.push('a computed field');
      else if (destructured !== undefined) taken.push(...destructured.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => (entry.startsWith('...') ? 'the rest' : entry.split(':')[0]!.trim())));
      else if (bound !== undefined) for (const use of after.matchAll(new RegExp(`\\b${bound.replace(/\$/g, '\\$')}\\b(\\s*\\.\\s*([\\w$]+))?`, 'g'))) taken.push(use[2] ?? 'the result whole');
      else taken.push('the result whole');
      for (const name of taken) if (!RESULT_FIELDS.has(name)) problems.push(`${file}: takes \`${name}\` of storedRowPrefill’s result`);
    }
  }
  return problems;
}

describe('the row as drawn leaves the helper only as strings (ticket 733a, the architect’s ruling 4366)', () => {
  const row = { kind: 'user', id: 'r-1', messageUuid: 'u-1', turnId: null, text: 'Implement this plan:\n\nStart.\n[Pasted text #1 +1 lines]', attachments: [{ kind: 'text', name: 'Pasted text #1', bytes: 10, dataUrl: null, mediaType: 'text/plain', text: 'ATTACHMENT' }], placeholders: [29], lines: 4, editable: true, steer: false, dropped: false } as never;

  it('every field of its result but the prefill is a string', () => {
    const result = storedRowPrefill(row, (text, bodies) => `${text}|${bodies.join('|')}`) as unknown as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual([...RESULT_FIELDS].sort());
    expect(Object.entries(result).filter(([field, value]) => field !== 'prefill' && typeof value !== 'string').map(([field]) => field)).toEqual([]);
  });

  it('no module takes any other field of its result, or the result whole', () => {
    expect(resultTaken(scan())).toEqual([]);
  });

  it('goes red on a planted load of the drawn row: by its field, destructured, off a binding, the result whole, or a successor that hands it out; the three fields are not one', () => {
    const sources = scan();
    const at = 'src/renderer/src/planted.ts';
    const taken = (text: string) => resultTaken([{ file: at, text: codeOf(text) }]);
    expect(taken('export const load = (row) => prefillToDoc(storedRowPrefill(row, keyOf).drawn);'), 'by its field').toEqual([`${at}: takes \`drawn\` of storedRowPrefill’s result`]);
    expect(taken('const { prefill, drawn } = storedRowPrefill(row, keyOf);\nload(drawn);'), 'destructured').toEqual([`${at}: takes \`drawn\` of storedRowPrefill’s result`]);
    expect(taken('const recalled = storedRowPrefill(row, keyOf);\nload(recalled.prefill);\nload(recalled.drawn);'), 'off a binding').toEqual([`${at}: takes \`drawn\` of storedRowPrefill’s result`]);
    expect(taken('load(storedRowPrefill(row, keyOf));'), 'the result whole').toEqual([`${at}: takes \`the result whole\` of storedRowPrefill’s result`]);
    expect(taken('const { prefill, search, key } = storedRowPrefill(row, keyOf);\nconst again = storedRowPrefill(row, keyOf).prefill;'), 'the three fields: the control').toEqual([]);
    // a successor in the helper's module that hands the drawn row out is a reading, and its caller a reader
    const helper = sources.find(({ file }) => file === 'src/renderer/src/composer/composed-prefill.ts')!;
    const withSuccessor = [...sources.filter(({ file }) => file !== helper.file), { ...helper, text: `${helper.text}\nexport const plantedDrawnOfTheGuard = (row) => rowPrefill(row);\n` }];
    const before = unexcluded(sources);
    expect(unexcluded([...withSuccessor, { file: at, text: codeOf("import { plantedDrawnOfTheGuard } from './composer/composed-prefill';\nexport const load = (row) => prefillToDoc(plantedDrawnOfTheGuard(row));") }]).filter((problem) => !before.includes(problem)), 'a successor').toEqual([`${at}: reads a stored row’s text, outside the helper`]);
  });
});
