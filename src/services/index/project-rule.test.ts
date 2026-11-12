// Design §8's rule in MAWS against the shared vectors (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces
// §B; design acceptance 10, MAWS's half). Each case's tree is made on disk under a fresh directory, git's files written
// directly with no git command; its statements reach the rule as they do in production, through the index's lookup,
// each restored at its canonical path onto a row anchored to the folder there (a replaced one to another folder, a
// removed one hidden); and every asked directory, spelled as written, gives the vector's project, deciding source and
// deciding folder.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import type { KeptStatement } from '@shared/machine/registry';
import { machineProjectId, repoProjectId } from '@shared/machine/project-ids';
import { tempDir } from '../../../test/support/index-fixture';
import { readAnchor } from './anchor';
import { Index } from './index';
import { deriveProject } from './org-project';

type Entry =
  | { dir: string }
  | { repo: string; remote?: string; remotes?: Record<string, string> }
  | { worktree: string; of: string }
  | { smns: string; project: string; name?: string; hub?: true | false | 'other-org' }
  | { symlink: string; to: string };
type Statement = { path: string; minted?: string; linked?: string; removed?: true; replaced?: true };
type Ask = { dir: string; project: string | { remote: string }; by: string; at?: string };
type Case = { name: string; platform?: NodeJS.Platform; under?: string; tree: Entry[]; statements: Statement[]; ask: Ask[] };

const VECTORS = join(__dirname, '../../../apps/org-protocol/vectors/project-rule.json');
const file = JSON.parse(readFileSync(VECTORS, 'utf8')) as { version: number; org: string; machine: string; cases: Case[] };
const MACHINE = 'RuleTestMachine0000000' as MachineRef;
const ENROLLMENT = { org: file.org, machine: file.machine };

// git's files for a main checkout, written directly: HEAD, the object and ref folders, and a config naming the remotes
function writeRepo(path: string, remotes: Record<string, string>): void {
  mkdirSync(join(path, '.git', 'objects'), { recursive: true });
  mkdirSync(join(path, '.git', 'refs', 'heads'), { recursive: true });
  writeFileSync(join(path, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const sections = Object.entries(remotes).map(([name, url]) => `[remote "${name}"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/${name}/*\n`);
  writeFileSync(join(path, '.git', 'config'), `[core]\n\trepositoryformatversion = 0\n\tbare = false\n${sections.join('')}`);
}

// a linked worktree as `git worktree add` lays it out: its admin folder in the main checkout's `.git/worktrees/`, and a
// `.git` file pointing at it
function writeWorktree(path: string, of: string): void {
  const admin = join(of, '.git', 'worktrees', basename(path));
  mkdirSync(admin, { recursive: true });
  mkdirSync(path, { recursive: true });
  writeFileSync(join(admin, 'HEAD'), 'ref: refs/heads/wt\n');
  writeFileSync(join(admin, 'commondir'), '../..\n');
  writeFileSync(join(admin, 'gitdir'), `${join(path, '.git')}\n`);
  writeFileSync(join(path, '.git'), `gitdir: ${admin}\n`);
}

function build(root: string, tree: Entry[]): void {
  for (const entry of tree) {
    if ('dir' in entry) mkdirSync(join(root, entry.dir), { recursive: true });
    else if ('repo' in entry) writeRepo(join(root, entry.repo), entry.remotes ?? (entry.remote === undefined ? {} : { origin: entry.remote }));
    else if ('worktree' in entry) writeWorktree(join(root, entry.worktree), join(root, entry.of));
    else if ('smns' in entry) {
      mkdirSync(join(root, entry.smns), { recursive: true });
      const hub = entry.hub === true ? { hub: { org: file.org } } : entry.hub === 'other-org' ? { hub: { org: 'another-org' } } : {};
      writeFileSync(join(root, entry.smns, '.smns'), JSON.stringify({ project: entry.project, ...(entry.name === undefined ? {} : { name: entry.name }), ...hub }));
    } else {
      mkdirSync(dirname(join(root, entry.symlink)), { recursive: true });
      symlinkSync(join(root, entry.to), join(root, entry.symlink));
    }
  }
}

const canonical = (path: string) => realpathSync.native(path).normalize('NFC');

describe(`the shared vectors of design §8's rule (version ${file.version})`, () => {
  const made: string[] = [];
  const indexes: Index[] = [];
  afterEach(() => {
    for (const index of indexes.splice(0)) index.close();
    for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it('holds the cases §B lists', () => {
    expect(file.cases.length).toBeGreaterThanOrEqual(25);
  });

  it.each(file.cases)('$name', async (vector) => {
    if (vector.platform !== undefined && vector.platform !== process.platform) return;
    const root = vector.under === undefined ? tempDir('maws-rule-').path : mkdtempSync(join(vector.under, 'maws-rule-'));
    made.push(root);
    const store = tempDir('maws-rule-index-');
    made.push(store.path);
    build(root, vector.tree);
    const home = canonical(root);
    const other = join(home, '.replaced-elsewhere');
    mkdirSync(other);
    const index = new Index(join(store.path, 'index.sqlite'));
    indexes.push(index);
    const statements: KeptStatement[] = vector.statements.map((s) => {
      const path = canonical(join(root, s.path));
      return { path, minted: s.minted ?? null, linked: s.linked ?? null, anchor: readAnchor(s.replaced ? other : path), name: basename(path), nameRev: null, hidden: s.removed === true };
    });
    index.projects.restore(statements);
    const lookup = (path: string) => index.projects.statementAt(path);

    for (const ask of vector.ask) {
      const directory = join(root, ask.dir);
      const derived = await deriveProject({ directory, machine: MACHINE, projectId: 'p-rule', name: basename(directory) }, ENROLLMENT, { statements: lookup });
      expect(derived, ask.dir).not.toBeNull();
      const project = ask.project === 'machine' ? machineProjectId(file.org, file.machine) : typeof ask.project === 'string' ? ask.project : repoProjectId(file.org, ask.project.remote);
      expect({
        dir: ask.dir,
        project: derived!.org.smnsId ?? machineProjectId(file.org, file.machine),
        by: derived!.by,
        at: derived!.at === null ? undefined : relative(home, derived!.at),
      }).toEqual({ dir: ask.dir, project, by: ask.by, at: ask.at });
      if (ask.by === 'machine') expect(derived!.org.smnsId, `${ask.dir}: the machine's own project is carried as none`).toBeNull();
    }
  });
});
