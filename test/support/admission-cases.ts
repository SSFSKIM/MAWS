// The admission's one table of cases (UX wave U8c-2, M3; docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md,
// §G "The cases"). A folder that comes from one of the record's two facts (the launch folder, the working folder) is a root
// of a read or a write only when the work tree git finds for it is itself a work tree of the repository the record's
// directory is in. The predicate has two readers, git's own files (the files service, uploads, `git.lsFiles`, Source
// control: `admittedFolder`) and the machine's `git.worktree.list` (the endpoint: `CheckoutBounds.of`), and both suites
// run every row here over the same repositories on disk, which `admissionRepos` makes in a scratch folder.
import { accessSync, chmodSync, constants, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionRecord } from '../../src/shared/graph/session';
import { runGit } from './git-fixture';

export type AdmissionRecord = Pick<SessionRecord, 'directory' | 'additionalDirectories' | 'worktree'> & Partial<Pick<SessionRecord, 'launchFolder' | 'agentFolder'>>;

/** The scratch repositories, each a realpath. */
export interface AdmissionPaths {
  base: string;
  main: string; // the repository's main work tree, on `main`, with `packages/app`
  w1: string; // a linked worktree inside it, `.claude/worktrees/w1`
  beside: string; // a linked worktree beside it, outside the main checkout, with `packages`
  nested: string; // a repository made by `git init` inside the main checkout
  submodule: string; // a submodule's folder inside the main checkout
  removed: string; // a worktree beside the checkout removed with `git worktree remove` and made again as a plain folder
  removedInside: string; // the same, inside the main checkout (`.claude/worktrees/removed-in`)
  copy: string; // a folder beside the checkout holding a copy of `beside`'s `.git` pointer
  copyInside: string; // the same, inside the main checkout
  stale: string; // a worktree beside the checkout whose folder was replaced by a new repository, its registration not pruned
  linkToWorktree: string; // a link to `beside`
  linkToPlain: string; // a link to `plain`
  other: string; // a folder of another repository
  locked: string; // the main work tree of a repository whose config cannot be read (mode 000)
  lockedWt: string; // a registered linked worktree of that repository, beside it
  separate: string; // the main work tree of a repository whose git dir is apart from it (`git init --separate-git-dir`)
  separateWt: string; // a linked worktree inside it, `.claude/worktrees/sep`
  plain: string; // a folder in no repository
  missing: string; // a folder that does not exist
}

export interface AdmissionCase {
  record: AdmissionRecord;
  which: 'launch' | 'path';
  folder: string; // the fact's folder as the record names it
  admitted: string | null; // the realpath admitted, or null
}

/** A record anchored in the main checkout whose agent is in `folder` (a `cd`). */
const agentAt = (p: AdmissionPaths, folder: string, admitted: string | null): AdmissionCase => ({
  record: { directory: p.main, additionalDirectories: [], worktree: null, agentFolder: { checkout: folder, cwd: folder, branch: null, linked: true } },
  which: 'path',
  folder,
  admitted,
});

/** A record filed in the worktree beside the checkout (the engine's tool moved it there) and launched in `folder`. */
const launchedIn = (p: AdmissionPaths, folder: string, admitted: string | null): AdmissionCase => ({
  record: { directory: p.beside, additionalDirectories: [], worktree: { path: p.beside, branch: 'beside' }, launchFolder: folder },
  which: 'launch',
  folder,
  admitted,
});

/** §G's table, row by row, with the record and the answer each reader must give. */
export const ADMISSION_CASES: readonly [string, (p: AdmissionPaths) => AdmissionCase][] = [
  ['a registered linked worktree of the anchor’s repository, beside the checkout', (p) => agentAt(p, p.beside, p.beside)],
  ['a registered linked worktree of the anchor’s repository, inside the checkout', (p) => agentAt(p, p.w1, p.w1)],
  ['the repository’s main work tree, the anchor being in a linked worktree', (p) => launchedIn(p, p.main, p.main)],
  ['a sub-folder of a linked worktree: the root is the sub-folder', (p) => agentAt(p, join(p.beside, 'packages'), join(p.beside, 'packages'))],
  ['a sub-folder of the main work tree: the root is the sub-folder', (p) => launchedIn(p, join(p.main, 'packages/app'), join(p.main, 'packages/app'))],
  ['a repository made inside a listed work tree', (p) => agentAt(p, p.nested, null)],
  ['a repository made inside a listed work tree, named by a launch fact written before', (p) => launchedIn(p, p.nested, null)],
  ['a submodule’s folder inside a listed work tree', (p) => agentAt(p, p.submodule, null)],
  ['a worktree removed and made again as a plain folder, outside every listed work tree', (p) => agentAt(p, p.removed, null)],
  ['a worktree removed and made again as a plain folder, inside a listed work tree: a sub-folder of it', (p) => agentAt(p, p.removedInside, p.removedInside)],
  ['a folder that holds a copy of a registered worktree’s .git pointer, beside the checkout', (p) => agentAt(p, p.copy, null)],
  ['a folder that holds a copy of a registered worktree’s .git pointer, inside a listed work tree', (p) => agentAt(p, p.copyInside, null)],
  ['a repository made at a registered worktree’s path, its registration not pruned', (p) => agentAt(p, p.stale, null)],
  ['a link to a registered worktree: judged, and used, where it lands', (p) => agentAt(p, p.linkToWorktree, p.beside)],
  ['a link to a folder in no repository', (p) => agentAt(p, p.linkToPlain, null)],
  ['a folder of another repository', (p) => agentAt(p, p.other, null)],
  ['a folder of no repository', (p) => agentAt(p, p.plain, null)],
  ['a folder that does not resolve', (p) => agentAt(p, p.missing, null)],
  // git lists the main work tree of such a repository at its git dir; both readers take the checkout the worktree is under
  ['the main work tree of a repository whose git dir is apart from it, the anchor being a linked worktree under it', (p) => ({
    record: { directory: p.separateWt, additionalDirectories: [], worktree: { path: p.separateWt, branch: 'sep' }, launchFolder: p.separate },
    which: 'launch',
    folder: p.separate,
    admitted: p.separate,
  })],
  ['a registered linked worktree of a repository whose config cannot be read: a read that fails refuses', (p) => ({
    record: { directory: p.locked, additionalDirectories: [], worktree: null, agentFolder: { checkout: p.lockedWt, cwd: p.lockedWt, branch: null, linked: true } },
    which: 'path',
    folder: p.lockedWt,
    admitted: null,
  })],
];

const readable = (path: string) => {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const git = (cwd: string, ...args: string[]) => runGit(cwd, args);

async function repository(path: string, branch: string, files: string[]): Promise<void> {
  mkdirSync(path, { recursive: true });
  await git(path, 'init', '-q', '-b', branch);
  for (const file of files) {
    mkdirSync(join(path, file, '..'), { recursive: true });
    writeFileSync(join(path, file), 'hello\n');
  }
  await git(path, 'add', '.');
  await git(path, 'commit', '-q', '-m', 'initial');
}

/** The repositories of the table, made in a scratch folder; `dispose` removes them. */
export async function admissionRepos(): Promise<{ paths: AdmissionPaths; dispose(): void }> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'maws-admission-')));
  const at = (rel: string) => join(base, rel);
  const p: AdmissionPaths = {
    base,
    main: at('main'),
    w1: at('main/.claude/worktrees/w1'),
    beside: at('beside'),
    nested: at('main/nested'),
    submodule: at('main/sub-mod'),
    removed: at('removed'),
    removedInside: at('main/.claude/worktrees/removed-in'),
    copy: at('copy'),
    copyInside: at('main/copy'),
    stale: at('stale'),
    linkToWorktree: at('link-wt'),
    linkToPlain: at('link-plain'),
    other: at('other'),
    locked: at('locked'),
    lockedWt: at('locked-wt'),
    separate: at('separate'),
    separateWt: at('separate/.claude/worktrees/sep'),
    plain: at('plain'),
    missing: at('missing'),
  };
  await repository(p.main, 'main', ['README.md', 'packages/app/index.ts']);
  await repository(p.other, 'main', ['README.md']);
  await git(p.main, 'worktree', 'add', '-q', '-b', 'w1', p.w1);
  await git(p.main, 'worktree', 'add', '-q', '-b', 'beside', p.beside);
  for (const [path, branch] of [[p.removed, 'removed'], [p.removedInside, 'removed-in']] as const) {
    await git(p.main, 'worktree', 'add', '-q', '-b', branch, path);
    await git(p.main, 'worktree', 'remove', path);
    mkdirSync(path, { recursive: true });
  }
  await git(p.main, 'worktree', 'add', '-q', '-b', 'stale', p.stale);
  rmSync(p.stale, { recursive: true, force: true });
  mkdirSync(p.stale);
  await git(p.stale, 'init', '-q', '-b', 'stale');
  mkdirSync(p.nested);
  await git(p.nested, 'init', '-q', '-b', 'nested');
  await git(p.main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', p.other, 'sub-mod');
  await git(p.main, 'commit', '-q', '-m', 'the submodule');
  for (const folder of [p.copy, p.copyInside]) {
    mkdirSync(folder);
    copyFileSync(join(p.beside, '.git'), join(folder, '.git'));
  }
  await repository(p.locked, 'main', ['README.md']);
  await git(p.locked, 'worktree', 'add', '-q', '-b', 'locked-wt', p.lockedWt);
  const config = join(p.locked, '.git', 'config');
  chmodSync(config, 0o000); // git itself then exits 128 ("unable to access '.git/config': Permission denied")
  if (readable(config)) throw new Error('the admission cases need a user whom mode 000 denies (not root): the locked row would not be locked');
  await git(base, 'init', '-q', '-b', 'main', `--separate-git-dir=${at('separate.git')}`, p.separate);
  writeFileSync(join(p.separate, 'README.md'), 'hello\n');
  await git(p.separate, 'add', '.');
  await git(p.separate, 'commit', '-q', '-m', 'initial');
  await git(p.separate, 'worktree', 'add', '-q', '-b', 'sep', p.separateWt);
  mkdirSync(p.plain);
  symlinkSync(p.beside, p.linkToWorktree);
  symlinkSync(p.plain, p.linkToPlain);
  return { paths: p, dispose: () => rmSync(base, { recursive: true, force: true }) };
}
