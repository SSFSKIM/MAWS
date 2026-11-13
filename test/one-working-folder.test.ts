// One working folder (UX wave U8, contract UC-4, acceptance A9): no file reads the session's folder except through the
// selector, `workingFolder` in src/shared/sessions/working-folder.ts (or its renderer hook `useWorkingFolder`), so that
// when the answer follows the agent into a worktree every surface follows together. This test reads every .ts and .tsx
// file under src/, suites and comments included, and fails on a file that spells the folder itself outside the
// exceptions below. It sees the usual forms (a fallback, a conditional either way round); a spelling spread over
// statements or made through other names it cannot see, and the rule holds there all the same.
//
// The second rule (UX wave U8c-2, §F): the record's two facts, `launchFolder` and `agentFolder`, are read only by the
// selector's module, which answers from them (`workingFolder`, `workingWorktree`, `workingBranch`). Product source outside
// it, suites and test support aside, holds no member access of either key outside the counted table below. An object
// literal that sets one (the index builds the record that way) is no read and is not counted.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SELECTOR = 'src/shared/sessions/working-folder.ts';

const CHAIN = String.raw`(?:[A-Za-z_$][\w$]*\s*(?:\?\.|!\.|\.)\s*)*`; // a member chain, possibly empty
const WORKTREE_PATH = String.raw`worktree\s*(?:\?\.|!\.|\.)\s*path`;
const SPELLINGS = [
  // a fallback: x.worktree?.path ?? x.directory, with || too, with any receiver or none
  new RegExp(String.raw`${CHAIN}${WORKTREE_PATH}\s*(?:\?\?|\|\|)\s*${CHAIN}directory\b`, 'g'),
  // a conditional, the worktree first: … ? x.worktree.path : x.directory
  new RegExp(String.raw`(?<![?.])\?(?![?.])\s*${CHAIN}${WORKTREE_PATH}\s*:\s*${CHAIN}directory\b`, 'g'),
  // a conditional, the directory first: … ? x.directory : x.worktree.path
  new RegExp(String.raw`(?<![?.])\?(?![?.])\s*${CHAIN}directory\s*:\s*${CHAIN}${WORKTREE_PATH}\b`, 'g'),
];

const spellings = (text: string): number => (text.includes('worktree') ? SPELLINGS.reduce((n, re) => n + (text.match(re)?.length ?? 0), 0) : 0);

// An exception is about the session's record, not about where the agent is working now. Adding one is an edit here,
// with its count and its reason.
const EXCEPTIONS: Record<string, { count: number; why: string }> = {
  'src/renderer/src/sessions/ArchiveDialog.tsx': { count: 1, why: "whether another session's record still names the worktree being archived" },
  'src/renderer/src/sessions/ArchivedSessionsDialog.tsx': { count: 1, why: 'the folder an archived record names' },
  'src/renderer/src/sessions/DeleteDialog.tsx': { count: 1, why: 'the folder of the record about to be deleted' },
  'src/renderer/src/resume/ResumeChooser.tsx': { count: 1, why: "the Resume picker's folder badge: where a past session was" },
};

const FACT_READS = [
  /(?:\?\.|!\.|\.)\s*(?:agentFolder|launchFolder)\b/g, // record.agentFolder, record?.launchFolder, record!.agentFolder
  /\[\s*['"](?:agentFolder|launchFolder)['"]\s*\]/g, // record['agentFolder']
];
const factReads = (text: string): number => FACT_READS.reduce((n, re) => n + (text.match(re)?.length ?? 0), 0);

// A read outside the selector's module that cannot go through it. Adding one is an edit here, with its count and its reason.
const FACT_EXCEPTIONS: Record<string, { count: number; why: string }> = {};

const isProductSource = (file: string) => !/\.test\.tsx?$/.test(file) && !file.split('/').includes('test-support');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [relative(ROOT, path).split('\\').join('/')] : [];
  });
}

describe('the recogniser', () => {
  it.each([
    'record.worktree?.path ?? record.directory',
    'record?.worktree?.path ?? record?.directory ?? null',
    'ctx.session.worktree?.path ?? ctx.session.directory',
    'worktree?.path ?? directory',
    'const folder = record.worktree?.path ??\n  record.directory;',
    'r.worktree?.path || r.directory',
    'record.worktree ? record.worktree.path : record.directory',
    'record.worktree !== null ? record.worktree.path : record.directory',
    'record.worktree === null ? record.directory : record.worktree.path',
    '// the folder: record.worktree?.path ?? record.directory',
  ])('counts one spelling in %j', (text) => {
    expect(spellings(text)).toBe(1);
  });

  it.each([
    'record.worktree?.path ?? null',
    'intent.progress.worktree?.path ?? location.repoRoot',
    '[r.directory, ...r.additionalDirectories, ...(r.worktree ? [r.worktree.path] : [])]',
    'isHere(r.directory) || (r.worktree !== null && isHere(r.worktree.path))',
    '({\n  worktree_path: init.worktree?.path ?? null,\n  directory: init.directory,\n})',
    'status?.cwd ?? record?.directory',
    'workingFolder(record).path',
  ])('counts none in %j', (text) => {
    expect(spellings(text)).toBe(0);
  });
});

describe('one working folder', () => {
  it("finds the session's folder spelled only in the selector's module and the exceptions", () => {
    const found = new Map(sources(resolve(ROOT, 'src')).filter((file) => file !== SELECTOR).map((file) => [file, spellings(readFileSync(resolve(ROOT, file), 'utf8'))] as const));
    const files = new Set([...[...found].filter(([, n]) => n > 0).map(([file]) => file), ...Object.keys(EXCEPTIONS)]);
    const differences = [...files]
      .sort()
      .flatMap((file) => {
        const count = found.get(file) ?? 0;
        const excepted = EXCEPTIONS[file]?.count ?? 0;
        return count === excepted ? [] : [`${file} ${count}${excepted > 0 ? ` (excepted: ${excepted})` : ''}`];
      });
    expect(
      differences,
      "These files spell the session's folder themselves (record.worktree?.path ?? record.directory or a form of it): read it " +
        'through workingFolder (src/shared/sessions/working-folder.ts) or useWorkingFolder (src/renderer/src/sessions/working-folder.ts). ' +
        'An exception is a place about the record and not about where the agent is working; adding one, or changing its count, ' +
        'is an edit to EXCEPTIONS in test/one-working-folder.test.ts with its reason. An entry whose spelling is gone is removed there.',
    ).toEqual([]);
  });
});

describe("the second rule's recogniser (the two facts)", () => {
  it.each([
    'record.agentFolder?.checkout',
    'const at = record?.launchFolder;',
    'value!.agentFolder',
    "record['launchFolder']",
    'record[ "agentFolder" ]',
    '// the launch folder: record.launchFolder',
  ])('counts one read in %j', (text) => {
    expect(factReads(text)).toBe(1);
  });

  it.each([
    '{ ...facts, agentFolder: at }',
    "field(value, 'agentFolder')",
    'launchFolder: z.string().optional(),',
    'const launchFolder = folders.launch;',
    'record.agentFolders',
    "record['launchFolders']",
  ])('counts none in %j', (text) => {
    expect(factReads(text)).toBe(0);
  });
});

describe('the two facts are read in one place', () => {
  it("finds a member access of either fact only in the selector's module and the counted exceptions", () => {
    const found = new Map(
      sources(resolve(ROOT, 'src'))
        .filter((file) => file !== SELECTOR && isProductSource(file))
        .map((file) => [file, factReads(readFileSync(resolve(ROOT, file), 'utf8'))] as const),
    );
    const files = new Set([...[...found].filter(([, n]) => n > 0).map(([file]) => file), ...Object.keys(FACT_EXCEPTIONS)]);
    const differences = [...files]
      .sort()
      .flatMap((file) => {
        const count = found.get(file) ?? 0;
        const excepted = FACT_EXCEPTIONS[file]?.count ?? 0;
        return count === excepted ? [] : [`${file} ${count}${excepted > 0 ? ` (excepted: ${excepted})` : ''}`];
      });
    expect(
      differences,
      "These files read the record's launchFolder or agentFolder themselves: read where the agent is through workingFolder, " +
        'workingWorktree or workingBranch (src/shared/sessions/working-folder.ts), or useWorkingFolder (src/renderer/src/sessions/working-folder.ts). ' +
        'A read that cannot go through them is an edit to FACT_EXCEPTIONS in test/one-working-folder.test.ts with its count and reason. ' +
        'An entry whose read is gone is removed there.',
    ).toEqual([]);
  });
});
