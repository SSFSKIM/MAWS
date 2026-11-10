// The stored statements and the project acts on one machine, with no network (docs/doperpowers/plans/2026-11-10-project-
// registry.md, M8, "It proves"; Interfaces §F and §G): the index's new columns, the minting table of §F.4 case by case,
// links, removals, relocations, states, renames, the `.smns` declaration and the refusals, against a stand-in registry
// seam (§H) on real folders and repositories under the OS temp dir.
import { chmodSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Enrollment } from '@shared/machine/identity';
import { repoProjectId } from '@shared/machine/project-ids';
import type { MachineRef } from '@shared/machine/ref';
import { assembleProjects } from 'org-protocol';
import { NO_REGISTRY, type DeclaredRow, type RegistrySeam, type StatementsState } from '@shared/machine/registry';
import { setupGuarded } from '../machine/setup';
import { readAnchor } from './anchor';
import { runGit } from '../../../test/support/git-fixture';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { openDb } from './db';
import { Index } from './index';
import { deriveProject } from './org-project';
import type { DeriveRule } from './statements';
import { ADDED_COLUMNS, ADDED_TABLES, MIGRATIONS, REPAIRS } from './migrations';

const MACHINE = 'StatementsTestMachine0' as MachineRef;
const ENROLLED: Enrollment = { org: 'org-test', machine: 'test-mac' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// A stand-in for the endpoint's seam: statements possible or not, the verified records' projects, and the restatements asked.
function standIn(possible = true) {
  const listeners = new Set<() => void>();
  const seam = {
    state: (possible ? { possible: true } : { possible: false, reason: 'sminos-too-old' }) as StatementsState,
    projects: new Map<string, { hub: boolean; nameRev: number }>(),
    fit: true,
    limit: Infinity,
    fitted: [] as DeclaredRow[][],
    restates: 0,
    turn(state: StatementsState) {
      seam.state = state;
      for (const listener of listeners) listener();
    },
  };
  const registry: RegistrySeam = {
    statements: () => seam.state,
    onStatements: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    project: (id) => seam.projects.get(id) ?? null,
    fits: (rows) => {
      seam.fitted.push([...rows]);
      return seam.fit && rows.length <= seam.limit;
    },
    published: async () => {
      seam.restates += 1;
      return { restated: true };
    },
  };
  return { seam, registry };
}

const refusal = (code: string) => expect.objectContaining({ ipcError: expect.objectContaining({ code: 'invalid_input', message: expect.stringMatching(new RegExp(`^${code}: `)) }) });

describe('the stored statements', () => {
  let dir: ReturnType<typeof tempDir>;
  let tree: ReturnType<typeof tempDir>;
  let index: Index;
  let seam: ReturnType<typeof standIn>['seam'];
  let home: string;

  const folder = (...parts: string[]) => {
    const path = join(tree.path, ...parts);
    mkdirSync(path, { recursive: true });
    return path;
  };
  const repo = async (name: string, remote?: string) => {
    const path = folder(name);
    await runGit(path, ['init', '-q', '-b', 'main']);
    if (remote !== undefined) await runGit(path, ['remote', 'add', 'origin', remote]);
    return path;
  };
  const open = async ({ possible = true, enrolled = true }: { possible?: boolean; enrolled?: boolean } = {}) => {
    const made = standIn(possible);
    seam = made.seam;
    index = new Index(join(dir.path, 'index.sqlite'), { registry: made.registry });
    await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => (enrolled ? ENROLLED : null), home, folderCheckMs: 60 * 60_000 });
  };
  const row = (path: string) => index.projects.list({ includeHidden: true }).find((p) => p.directory === path);
  const columns = (path: string) => {
    const db = new DatabaseSync(join(dir.path, 'index.sqlite'), { readOnly: true });
    try {
      return db.prepare('SELECT stated_minted, stated_linked, anchor FROM projects WHERE directory = ?').get(path) as { stated_minted: string | null; stated_linked: string | null; anchor: string | null } | undefined;
    } finally {
      db.close();
    }
  };
  const minted = (path: string) => columns(path)?.stated_minted ?? null;
  const add = (path: string, acts: { into?: string; own?: true } = {}) => index.statements.addFolder(path, acts);

  beforeEach(() => {
    dir = tempDir();
    tree = tempDir('maws-statements-');
    home = folder('home', 'me');
  });
  afterEach(() => {
    index?.close();
    dir.dispose();
    tree.dispose();
  });

  describe("the index's new columns", () => {
    it('are added to a current database without moving its version, and the build before still opens it', () => {
      const path = join(dir.path, 'before.sqlite');
      const beforeColumns = ADDED_COLUMNS.filter((c) => c.table !== 'projects');
      const beforeTables = ADDED_TABLES.filter((t) => t.table !== 'index_meta');
      const before = openDb(path, MIGRATIONS, REPAIRS, beforeColumns, beforeTables);
      before.insert('projects', { id: 'p-1', directory: '/w/one', name: 'one', slug: '-w-one', origin: 'user', hidden: 0, sort_order: 0, created_at: 't', org_key: 'smns:x', org_name: 'x', org_source: 'smns', org_smns_id: 'x' });
      before.close();
      const version = () => {
        const raw = new DatabaseSync(path, { readOnly: true });
        try {
          return (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
        } finally {
          raw.close();
        }
      };
      const was = version();
      const now = new Index(path);
      expect(now.projects.indexId()).toMatch(UUID);
      expect(now.projects.statementsGen()).toBe(0);
      expect(now.projects.list()).toEqual([expect.objectContaining({ id: 'p-1', directory: '/w/one', org: { key: 'smns:x', name: 'x', source: 'smns', smnsId: 'x' } })]);
      const id = now.projects.indexId();
      now.close();
      expect(version()).toBe(was);
      const again = openDb(path, MIGRATIONS, REPAIRS, beforeColumns, beforeTables);
      expect(again.unavailable).toBeNull();
      expect(again.all('SELECT id, directory FROM projects')).toEqual([{ id: 'p-1', directory: '/w/one' }]);
      again.close();
      const reopened = new Index(path);
      expect(reopened.projects.indexId()).toBe(id); // the id is written once
      reopened.close();
    });
  });

  describe('minting (§F.4)', () => {
    it('(a) an explicit add mints a folder the rule leaves in the machine’s project, and answers how it decided', async () => {
      await open();
      const plain = folder('plain');
      const answer = await add(plain);
      expect(minted(plain)).toMatch(UUID);
      expect(answer).toMatchObject({ by: 'minted', at: plain, restated: true, project: { stated: 'minted', org: { smnsId: minted(plain) } } });
      expect(JSON.parse(columns(plain)!.anchor!)).toMatchObject({ dev: expect.any(String), ino: expect.any(String), birth: expect.any(String) });
      // the same folder again: the same id
      await add(plain);
      expect(index.projects.list().filter((p) => p.directory === plain)).toHaveLength(1);
      expect(minted(plain)).toBe(answer.project.org!.smnsId);
    });

    it('(a) is not taken where the rule gives a project: a clone, a .smns, a subfolder of a minted folder', async () => {
      await open();
      const clone = await repo('clone', 'https://github.com/example/alpha.git');
      expect(await add(clone)).toMatchObject({ by: 'remote', at: clone });
      expect(minted(clone)).toBeNull();
      const filed = folder('filed');
      writeFileSync(join(filed, '.smns'), JSON.stringify({ project: 'filed-id' }));
      expect(await add(filed)).toMatchObject({ by: 'smns', at: filed, project: { org: { smnsId: 'filed-id' } } });
      expect(minted(filed)).toBeNull();
      const parent = folder('parent');
      await add(parent);
      const sub = folder('parent', 'sub');
      const inside = await add(sub);
      expect(inside).toMatchObject({ by: 'minted', at: parent, project: { org: { smnsId: minted(parent) } } });
      expect(minted(sub)).toBeNull();
      // `own` makes it a project of its own there
      const own = await add(sub, { own: true });
      expect(own).toMatchObject({ by: 'minted', at: sub });
      expect(minted(sub)).not.toBe(minted(parent));
    });

    it('never mints a worktree a plain add made a row of: it is in its owning checkout’s project', async () => {
      await open();
      const main = await repo('wt-main');
      writeFileSync(join(main, 'README'), 'readme\n');
      await runGit(main, ['add', 'README']);
      await runGit(main, ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', 'first']);
      const linked = join(tree.path, 'wt-linked');
      await runGit(main, ['worktree', 'add', '-q', '-b', 'side', linked]);
      await index.statements.declare(linked, () => ({ project: index.projects.add(linked) }));
      expect(minted(linked)).toBeNull();
    });

    it('(a) mints the home directory only by an explicit add of it', async () => {
      await open();
      await add(home);
      expect(minted(home)).toMatch(UUID);
    });

    it('(b) a first MAWS use mints, but never the home directory, a folder above it or a filesystem root', async () => {
      await open();
      const used = folder('used');
      const above = join(tree.path, 'home');
      for (const path of [used, home, above]) {
        const record = index.projects.ensureForDirectory(path, 'discovered');
        index.projects.usedByMaws(record.id);
      }
      await vi.waitFor(() => expect(minted(used)).toMatch(UUID));
      await vi.waitFor(() => expect(row(used)?.stated).toBe('minted'));
      expect(minted(home)).toBeNull();
      expect(minted(above)).toBeNull();
    });

    it('is not taken while statements are not possible, and is at (c) when they become so: nested folders alike', async () => {
      await open({ possible: false });
      const outer = folder('outer');
      const inner = folder('outer', 'inner');
      const clone = await repo('outer-clone', 'https://github.com/example/beta.git');
      expect(await add(outer)).not.toHaveProperty('by'); // today's answer
      await add(inner);
      await add(clone);
      const used = index.projects.ensureForDirectory(folder('used-before'), 'discovered');
      index.projects.usedByMaws(used.id);
      expect([minted(outer), minted(inner)]).toEqual([null, null]);
      seam.turn({ possible: true });
      await vi.waitFor(() => expect(minted(inner)).toMatch(UUID));
      expect(minted(outer)).toMatch(UUID); // evaluated before either was minted: the order decides nothing
      expect(minted(join(tree.path, 'used-before'))).toMatch(UUID);
      expect(minted(clone)).toBeNull();
      await vi.waitFor(() => expect(row(inner)?.org?.smnsId).toBe(minted(inner)));
    });

    it('is taken at (c) once: a declared folder that later falls to the machine’s project keeps its id until (c) again', async () => {
      await open();
      const parent = folder('p');
      await add(parent);
      const sub = folder('p', 'sub');
      expect(await add(sub)).toMatchObject({ by: 'minted', at: parent }); // a location of the parent's project
      await index.statements.remove(row(parent)!.id);
      await vi.waitFor(() => expect(row(sub)?.org?.smnsId ?? null).toBeNull()); // the rows beneath derived again
      await index.statements.statementsChanged();
      await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => ENROLLED, home, folderCheckMs: 60 * 60_000 }); // a restart
      expect(minted(sub)).toBeNull();
      // statements stop being possible and become so again: every declared row is considered
      seam.turn({ possible: false, reason: 'endpoint-off' });
      seam.turn({ possible: true });
      await vi.waitFor(() => expect(minted(sub)).toMatch(UUID));
    });

    it('a statement made while enrolled is not in force once the machine is not', async () => {
      await open();
      const plain = folder('plain');
      await add(plain);
      expect(row(plain)).toMatchObject({ stated: 'minted' });
      await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => null, home });
      expect(row(plain)?.org).toMatchObject({ source: 'folder', smnsId: null });
      expect(row(plain)).not.toHaveProperty('stated');
    });
  });

  describe('the acts (§G)', () => {
    it('a removed row’s statement does not count, and adding the folder again restores the same id', async () => {
      await open();
      const plain = folder('kept');
      const sub = folder('kept', 'sub');
      const id = (await add(plain)).project.org!.smnsId;
      const child = index.projects.ensureForDirectory(sub, 'discovered');
      await vi.waitFor(() => expect(row(sub)?.org?.smnsId).toBe(id));
      await index.statements.remove(row(plain)!.id);
      await vi.waitFor(() => expect(row(sub)?.org?.smnsId ?? null).toBeNull());
      expect(index.projects.statementAt(plain)).toBeNull();
      expect(row(sub)?.id).toBe(child.id);
      const again = await add(plain);
      expect(again.project.org!.smnsId).toBe(id);
      await vi.waitFor(() => expect(row(sub)?.org?.smnsId).toBe(id));
    });

    it('a link and its removal return the folder to its minted id; a link never mints', async () => {
      await open();
      seam.projects.set('target-id', { hub: true, nameRev: 0 });
      const plain = folder('linked');
      const own = (await add(plain)).project.org!.smnsId;
      const linked = await index.statements.link(row(plain)!.id, 'target-id');
      expect(linked).toMatchObject({ restated: true, project: { stated: 'linked', org: { smnsId: 'target-id' } } });
      const unlinked = await index.statements.link(row(plain)!.id, null);
      expect(unlinked.project).toMatchObject({ stated: 'minted', org: { smnsId: own } });
      // a clone linked and unlinked returns to its remote: no minted id was made for it
      const clone = await repo('clone-l', 'https://github.com/example/gamma.git');
      await add(clone);
      await index.statements.link(row(clone)!.id, 'target-id');
      expect(minted(clone)).toBeNull();
      expect((await index.statements.link(row(clone)!.id, null)).project.org!.smnsId).toBe(repoProjectId(ENROLLED.org, 'github.com/example/gamma'));
    });

    it('`into` declares and links in one act, minting where the rule would leave the folder in the machine’s project', async () => {
      await open();
      seam.projects.set('target-id', { hub: true, nameRev: 0 });
      const plain = folder('into');
      expect(await add(plain, { into: 'target-id' })).toMatchObject({ by: 'link', at: plain, project: { stated: 'linked', org: { smnsId: 'target-id' } } });
      expect(minted(plain)).toMatch(UUID);
      await index.statements.link(row(plain)!.id, null);
      expect(row(plain)?.org?.smnsId).toBe(minted(plain));
    });

    it('refuses what §G names', async () => {
      await open();
      seam.projects.set('git-id', { hub: false, nameRev: 0 });
      const plain = folder('refused');
      await expect(add(plain, { into: 'x', own: true })).rejects.toEqual(refusal('into-and-own'));
      await expect(add(plain, { into: 'nowhere-id' })).rejects.toEqual(refusal('unknown-project'));
      await expect(add(plain, { into: 'git-id' })).rejects.toEqual(refusal('not-a-hub-project'));
      await expect(add(join(tree.path, 'none'), { into: 'git-id' })).rejects.toEqual(refusal('not-a-directory'));
      // a link to the id the folder's own .smns names needs no record ("Follow the file"), when the file names this org's hub
      writeFileSync(join(plain, '.smns'), JSON.stringify({ project: 'file-id', hub: { org: ENROLLED.org } }));
      expect(await add(plain, { into: 'file-id' })).toMatchObject({ by: 'link', project: { org: { smnsId: 'file-id' } } });
      const discovered = index.projects.ensureForDirectory(folder('discovered'), 'discovered');
      await expect(index.statements.link(discovered.id, 'file-id')).rejects.toEqual(refusal('not-declared'));
      await expect(index.statements.relocate(discovered.id, plain)).rejects.toEqual(refusal('not-declared'));
      seam.fit = false;
      await expect(add(folder('over'))).rejects.toEqual(refusal('too-many-locations'));
      seam.fit = true;
      seam.turn({ possible: false, reason: 'sminos-too-old' });
      await expect(add(folder('later'), { own: true })).rejects.toEqual(refusal('statements-unavailable: sminos-too-old'));
      await expect(index.statements.link(row(plain)!.id, 'file-id')).rejects.toEqual(refusal('statements-unavailable: sminos-too-old'));
      // a plain add still declares the folder, as before
      expect((await add(folder('later'))).project).toMatchObject({ directory: join(tree.path, 'later') });
    });

    it('relocate points a row at its folder’s new path, merges an unstated row there and refuses a stated one', async () => {
      await open();
      const old = folder('before');
      const id = (await add(old)).project.org!.smnsId;
      const pid = row(old)!.id;
      const moved = join(tree.path, 'after');
      renameSync(old, moved);
      await index.statements.checkFolders();
      expect(row(old)).toMatchObject({ state: 'missing' });
      // a session already filed at the new path, under a row of its own with no statement
      const there = index.projects.ensureForDirectory(moved, 'discovered');
      index.sessions.upsertFromSummary(summary({ directory: moved }));
      const answer = await index.statements.relocate(pid, moved);
      expect(answer).toMatchObject({ merged: true, restated: true, project: { id: pid, directory: moved, stated: 'minted', org: { smnsId: id } } });
      expect(answer.project).not.toHaveProperty('state');
      expect(index.projects.list({ includeHidden: true }).some((p) => p.id === there.id)).toBe(false);
      expect(index.sessions.list({ includeArchived: true }).every((s) => s.projectId === pid)).toBe(true);
      const stated = folder('stated');
      await add(stated);
      await expect(index.statements.relocate(pid, stated)).rejects.toEqual(refusal('has-statement'));
      await expect(index.statements.relocate(pid, join(tree.path, 'gone'))).rejects.toEqual(refusal('not-a-directory'));
    });

    it('a rename sets the name counter one above the highest the seam and this machine hold', async () => {
      await open();
      const plain = folder('named');
      const id = (await add(plain)).project.org!.smnsId!;
      seam.projects.set(id, { hub: true, nameRev: 7 });
      expect(index.statements.update(row(plain)!.id, { name: 'Named' })).toMatchObject({ name: 'Named', nameRev: 8 });
      seam.projects.set(id, { hub: true, nameRev: 2 });
      expect(index.statements.update(row(plain)!.id, { name: 'Again' })).toMatchObject({ nameRev: 9 }); // this machine's 8
      expect(index.statements.update(row(plain)!.id, { order: 3 })).toMatchObject({ nameRev: 9, order: 3 });
    });

    it('a checked removal hides only while the path and the rule’s project are the expected ones', async () => {
      await open();
      seam.projects.set('target-id', { hub: true, nameRev: 0 });
      const plain = folder('checked');
      const id = (await add(plain)).project.org!.smnsId;
      const pid = row(plain)!.id;
      await expect(index.statements.remove(pid, { path: join(tree.path, 'elsewhere'), project: id })).rejects.toEqual(refusal('changed'));
      await index.statements.link(pid, 'target-id');
      await expect(index.statements.remove(pid, { path: plain, project: id })).rejects.toEqual(refusal('changed'));
      expect(row(plain)).not.toHaveProperty('hidden');
      await index.statements.remove(pid, { path: plain, project: 'target-id' });
      expect(row(plain)).toMatchObject({ hidden: true });
    });

    it('resolve answers the rule and changes nothing', async () => {
      await open();
      const plain = folder('asked');
      const sub = folder('asked', 'deep');
      expect(await index.statements.resolve(sub)).toMatchObject({ project: null, by: 'machine', at: null, label: { source: 'folder' } });
      await add(plain);
      expect(await index.statements.resolve(sub)).toEqual({ project: minted(plain), by: 'minted', at: plain, label: expect.objectContaining({ source: 'folder', smnsId: minted(plain) }) });
      expect(row(sub)).toBeUndefined();
      await expect(index.statements.resolve(join(tree.path, 'nowhere'))).rejects.toEqual(refusal('not-a-directory'));
    });
  });

  describe('states (§F.6)', () => {
    it('a deleted folder reads missing, a different folder at the path replaced, an unreadable one present', async () => {
      await open();
      const gone = folder('gone');
      const swapped = folder('swapped');
      const locked = folder('locked', 'inner');
      for (const path of [gone, swapped, locked]) await add(path);
      rmSync(gone, { recursive: true });
      rmSync(swapped, { recursive: true });
      mkdirSync(swapped);
      chmodSync(join(tree.path, 'locked'), 0o000);
      try {
        await index.statements.checkFolders();
        expect(row(gone)).toMatchObject({ state: 'missing' });
        expect(row(swapped)).toMatchObject({ state: 'replaced' });
        expect(row(locked)).not.toHaveProperty('state');
      } finally {
        chmodSync(join(tree.path, 'locked'), 0o755);
      }
      // a replaced folder's statement counts on neither side: a session there is not filed in the old project
      expect(index.projects.statementAt(swapped)).toBeNull();
      expect((await index.statements.resolve(swapped)).by).toBe('machine');
      // "Use this folder": relocate at its own path
      const used = await index.statements.relocate(row(swapped)!.id, swapped);
      expect(used.project).toMatchObject({ stated: 'minted' });
      expect(used.project).not.toHaveProperty('state');
      // a folder moved away is missing, and present again when it is back
      const away = folder('away');
      await add(away);
      renameSync(away, `${away}-moved`);
      await index.statements.checkFolders();
      expect(row(away)).toMatchObject({ state: 'missing' });
      renameSync(`${away}-moved`, away);
      await index.statements.checkFolders();
      expect(row(away)).not.toHaveProperty('state');
      // a folder made anew where one was deleted is another folder
      mkdirSync(gone);
      await index.statements.checkFolders();
      expect(row(gone)).toMatchObject({ state: 'replaced' });
    });

    it('a start that failed has its folder checked at once', async () => {
      await open();
      const plain = folder('started');
      await add(plain);
      const appId = index.sessions.upsertFromSummary(summary({ directory: plain })).record.appId;
      rmSync(plain, { recursive: true });
      index.startFailed(appId);
      await vi.waitFor(() => expect(row(plain)).toMatchObject({ state: 'missing' }));
    });

    it('a .smns written into a minted folder, and removed again, changes no row’s project', async () => {
      await open();
      const plain = folder('stable');
      const sub = folder('stable', 'sub');
      const id = (await add(plain)).project.org!.smnsId;
      index.projects.ensureForDirectory(sub, 'discovered');
      await vi.waitFor(() => expect(row(sub)?.org?.smnsId).toBe(id));
      writeFileSync(join(plain, '.smns'), JSON.stringify({ project: 'pulled-id', name: 'Pulled' }));
      await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => ENROLLED, home });
      expect([row(plain)?.org?.smnsId, row(sub)?.org?.smnsId]).toEqual([id, id]);
      expect(row(plain)?.org).toMatchObject({ key: 'smns:pulled-id', source: 'smns' }); // the label follows the file
      rmSync(join(plain, '.smns'));
      await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => ENROLLED, home });
      expect([row(plain)?.org?.smnsId, row(sub)?.org?.smnsId]).toEqual([id, id]);
    });
  });

  describe('a .smns declares its folder (§F.5)', () => {
    it('when a session runs in or beneath it, creating the row, never un-hiding one', async () => {
      await open();
      const filed = folder('filed-repo');
      writeFileSync(join(filed, '.smns'), JSON.stringify({ project: 'filed-id' }));
      const sub = folder('filed-repo', 'pkg');
      index.sessions.upsertFromSummary(summary({ directory: sub }));
      await vi.waitFor(() => expect(row(filed)).toMatchObject({ org: { smnsId: 'filed-id' } }));
      expect(row(filed)).not.toHaveProperty('discovered');
      expect(row(sub)).toMatchObject({ discovered: true });

      const hidden = folder('hidden-repo');
      writeFileSync(join(hidden, '.smns'), JSON.stringify({ project: 'hidden-id' }));
      index.projects.hide(index.projects.add(hidden).id);
      index.sessions.upsertFromSummary(summary({ directory: hidden }));
      await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => ENROLLED, home });
      expect(row(hidden)).toMatchObject({ hidden: true });
    });

    it('not on a machine that is not enrolled', async () => {
      await open({ enrolled: false });
      const filed = folder('filed-plain');
      writeFileSync(join(filed, '.smns'), JSON.stringify({ project: 'filed-id' }));
      index.sessions.upsertFromSummary(summary({ directory: folder('filed-plain', 'pkg') }));
      await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => null, home });
      expect(row(filed)).toBeUndefined();
    });
  });

  describe('what the endpoint reads (§H’s ProjectsSource)', () => {
    it('states the declared rows, keeps the statements whole and gives a rebuilt index its statements back', async () => {
      await open();
      seam.projects.set('target-id', { hub: true, nameRev: 0 });
      const plain = folder('stated-a');
      const linked = folder('stated-b');
      const removed = folder('stated-c');
      await add(plain);
      await add(linked, { into: 'target-id' });
      await add(removed);
      await index.statements.remove(row(removed)!.id);
      const source = index.projectsSource();
      const snapshot = source.snapshot()!;
      expect(snapshot.indexId).toBe(index.projects.indexId());
      expect(snapshot.rows.map((r) => [r.path, r.stated, r.org.smnsId])).toEqual([
        [plain, 'minted', minted(plain)],
        [linked, 'linked', 'target-id'],
      ]);
      expect(snapshot.statements.map((s) => [s.path, s.hidden, s.linked])).toEqual([
        [plain, false, null],
        [linked, false, 'target-id'],
        [removed, true, null],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

      // a rebuilt index: a fresh file, the statements restored, the same ids
      index.close();
      for (const suffix of ['', '-wal', '-shm']) rmSync(join(dir.path, `index.sqlite${suffix}`), { force: true });
      await open();
      expect(index.projects.indexId()).not.toBe(snapshot.indexId);
      index.projectsSource().restore(snapshot.statements);
      await vi.waitFor(() => expect(row(plain)?.org?.smnsId).toBe(snapshot.rows[0].org.smnsId));
      await vi.waitFor(() => expect(row(linked)?.org?.smnsId).toBe('target-id'));
      expect(row(removed)).toMatchObject({ hidden: true });
    });

    it('is null while the index is unavailable', () => {
      const refused = new Index(join(dir.path, 'refused.sqlite'), { refused: 'another run holds the spine', registry: NO_REGISTRY });
      expect(refused.projectsSource().snapshot()).toBeNull();
      refused.close();
      index = undefined as unknown as Index;
    });
  });

  describe('with the seam’s default', () => {
    it('makes no stored statement, and a declaration answers as before', async () => {
      index = new Index(join(dir.path, 'index.sqlite'));
      await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => ENROLLED, home });
      const plain = folder('default');
      const answer = await index.statements.addFolder(plain);
      expect(Object.keys(answer).sort()).toEqual(['location', 'project']);
      expect(minted(plain)).toBeNull();
      await expect(index.statements.addFolder(folder('default-own'), { own: true })).rejects.toEqual(refusal('statements-unavailable: endpoint-off'));
      expect(index.projects.statementAt(plain)).toBeNull();
    });
  });

  // M8's review 1 (.doperpowers/sde/2026-11-10-project-registry/task-8-review-1.md): each finding, reproduced
  describe('review 1', () => {
    const settle = async () => {
      for (let k = 0; k < 100; k++) await new Promise((resolve) => setImmediate(resolve));
    };

    it('F1: a remote add derives through the checked reader alone, never reading a protected folder it was not opened', async () => {
      await open();
      const guardHome = folder('guard-home');
      const opened = folder('guard-home', 'open');
      const desktop = folder('guard-home', 'Desktop');
      writeFileSync(join(desktop, 'private-smns'), JSON.stringify({ project: 'private-id', name: 'private label' }));
      symlinkSync(join(desktop, 'private-smns'), join(opened, '.smns'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const answer = await setupGuarded(opened, [], { where: { home: guardHome, platform: 'darwin' } }, (checked, files) => index.statements.addFolder(checked, { files }));
        await settle();
        expect(JSON.stringify(answer)).not.toMatch(/private-id|private label/);
        expect(JSON.stringify(index.projects.list({ includeHidden: true }))).not.toMatch(/private-id|private label/);
      } finally {
        warn.mockRestore();
        error.mockRestore();
      }
    });

    it('F2: a missing declared folder keeps its identity across a start’s refresh', async () => {
      await open();
      const plain = folder('missing');
      const id = (await add(plain)).project.org!.smnsId;
      renameSync(plain, `${plain}-moved`);
      await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => ENROLLED, home, folderCheckMs: 60 * 60_000 });
      expect(row(plain)).toMatchObject({ stated: 'minted', state: 'missing', org: { smnsId: id } });
      expect(index.projectsSource().snapshot()!.rows.find((r) => r.path === plain)).toMatchObject({ stated: 'minted', state: 'missing', org: { smnsId: id } });
    });

    it('F3: a session filed into a stated row whose folder was replaced is not filed under the old project', async () => {
      await open();
      const plain = folder('swapped-in');
      const id = (await add(plain)).project.org!.smnsId;
      renameSync(plain, `${plain}-old`);
      mkdirSync(plain);
      const record = index.sessions.upsertFromSummary(summary({ directory: plain })).record;
      expect(index.projects.record(record.projectId!)).toMatchObject({ state: 'replaced' });
      expect(index.projects.record(record.projectId!).org?.smnsId).not.toBe(id);
      expect(index.projects.record(record.projectId!)).not.toHaveProperty('stated');
      await vi.waitFor(() => expect(row(plain)?.org).toMatchObject({ source: 'folder', smnsId: null }));
      // and the folder checks' finding is acted on the same way
      const other = folder('swapped-checked');
      const otherId = (await add(other)).project.org!.smnsId;
      renameSync(other, `${other}-old`);
      mkdirSync(other);
      await index.statements.checkFolders();
      expect(row(other)?.org?.smnsId).not.toBe(otherId);
    });

    it('F3b: a session filed into a row under a replaced folder’s statement is not filed under the old project', async () => {
      await open();
      const parent = folder('swapped-parent');
      const child = folder('swapped-parent', 'child');
      const found = folder('swapped-parent', 'found');
      const id = (await add(parent)).project.org!.smnsId!;
      await add(child);
      index.sessions.upsertFromSummary(summary({ directory: found }));
      await vi.waitFor(() => expect(row(found)?.org?.smnsId).toBe(id));
      expect(row(child)).toMatchObject({ stated: 'minted', org: { smnsId: id } });
      renameSync(parent, `${parent}-old`);
      mkdirSync(child, { recursive: true });
      mkdirSync(found);
      // a declared row and a discovered one, each deciding by the statement above it
      for (const directory of [child, found]) {
        const record = index.sessions.upsertFromSummary(summary({ directory })).record;
        expect(index.projects.record(record.projectId!).org?.smnsId).not.toBe(id);
        expect(index.projects.record(record.projectId!)).not.toHaveProperty('stated');
      }
      // and a statement above that no longer counts because its row was removed
      const kept = folder('kept-parent');
      const under = folder('kept-parent', 'under');
      const keptId = (await add(kept)).project.org!.smnsId!;
      index.sessions.upsertFromSummary(summary({ directory: under }));
      await vi.waitFor(() => expect(row(under)?.org?.smnsId).toBe(keptId));
      index.projects.hide(row(kept)!.id);
      const record = index.sessions.upsertFromSummary(summary({ directory: under })).record;
      expect(index.projects.record(record.projectId!).org?.smnsId).not.toBe(keptId);
    });

    it('F4: a link that cannot be anchored to a folder is refused', async () => {
      await open({ possible: false });
      seam.projects.set('target-id', { hub: true, nameRev: 0 });
      const vacant = folder('vacant');
      await add(vacant);
      renameSync(vacant, `${vacant}-old`);
      seam.turn({ possible: true });
      await expect(index.statements.link(row(vacant)!.id, 'target-id')).rejects.toEqual(refusal('not-a-directory'));
      mkdirSync(vacant);
      expect((await index.statements.resolve(vacant)).project).not.toBe('target-id');
    });

    it('F5: the id of the folder’s own .smns may be linked only when that file names a hub of this org', async () => {
      await open();
      const mirrored = folder('mirrored');
      writeFileSync(join(mirrored, '.smns'), JSON.stringify({ project: 'git-mirrored', name: 'Mirrored' }));
      await expect(add(mirrored, { into: 'git-mirrored' })).rejects.toEqual(refusal('not-a-hub-project'));
      const elsewhere = folder('other-org');
      writeFileSync(join(elsewhere, '.smns'), JSON.stringify({ project: 'other-org-id', hub: { org: 'another-org' } }));
      await expect(add(elsewhere, { into: 'other-org-id' })).rejects.toEqual(refusal('not-a-hub-project'));
      const hubbed = folder('hubbed');
      writeFileSync(join(hubbed, '.smns'), JSON.stringify({ project: 'hub-id', hub: { org: ENROLLED.org } }));
      expect(await add(hubbed, { into: 'hub-id' })).toMatchObject({ by: 'link', project: { org: { smnsId: 'hub-id' } } });
    });

    it('F6: after a restore the snapshot pairs no restored statement with an id from before it', async () => {
      await open();
      const restored = folder('restored');
      index.projects.ensureForDirectory(restored, 'discovered');
      await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => ENROLLED, home, folderCheckMs: 60 * 60_000 });
      const minted = '33333333-3333-4333-8333-333333333333';
      index.projectsSource().restore([{ path: restored, minted, linked: null, anchor: readAnchor(restored), name: 'restored', nameRev: null, hidden: false }]);
      const snapshot = index.projectsSource().snapshot();
      const stated = snapshot?.rows.find((r) => r.path === restored);
      if (stated !== undefined) expect(stated.org.smnsId).toBe(minted);
      await vi.waitFor(() => expect(index.projectsSource().snapshot()?.rows.find((r) => r.path === restored)?.org.smnsId).toBe(minted));
    });

    it('F7: a folder not found at (c) is minted when found, and no other row is', async () => {
      await open({ possible: false });
      const pending = folder('pending');
      await add(pending);
      renameSync(pending, `${pending}-away`);
      await index.statements.checkFolders();
      seam.turn({ possible: true });
      await settle();
      const parent = folder('parent');
      const sub = folder('parent', 'sub');
      await add(parent);
      await add(sub);
      await index.statements.remove(row(parent)!.id);
      await vi.waitFor(() => expect(row(sub)?.org?.smnsId ?? null).toBeNull());
      renameSync(`${pending}-away`, pending);
      await index.statements.checkFolders();
      await settle();
      expect(minted(pending)).toMatch(UUID);
      expect(minted(sub)).toBeNull();
    });

    it('F8: fits is asked with the real prospective rows, and a first use or a .smns promotion that would not fit is not made', async () => {
      await open();
      const clone = await repo('fit-clone', 'https://github.com/example/fit.git');
      await add(clone);
      const asked = seam.fitted.at(-1)!;
      expect(asked.find((r) => r.path === clone)).toMatchObject({ org: { key: 'remote:github.com/example/fit', source: 'remote' }, remote: 'github.com/example/fit', name: 'fit' });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        seam.fit = false;
        const used = index.projects.ensureForDirectory(folder('fit-used'), 'discovered');
        index.projects.usedByMaws(used.id);
        expect(row(join(tree.path, 'fit-used'))).toMatchObject({ discovered: true });
        const filed = folder('fit-filed');
        writeFileSync(join(filed, '.smns'), JSON.stringify({ project: 'fit-filed-id' }));
        index.sessions.upsertFromSummary(summary({ directory: folder('fit-filed', 'pkg') }));
        await settle();
        await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => ENROLLED, home, folderCheckMs: 60 * 60_000 });
        expect(row(filed)).toBeUndefined();
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('F9: a .smns made later in a discovered folder declares it at the next session there', async () => {
      await open();
      const late = folder('late');
      index.sessions.upsertFromSummary(summary({ directory: late }));
      await settle();
      expect(row(late)).toMatchObject({ discovered: true });
      writeFileSync(join(late, '.smns'), JSON.stringify({ project: 'late-id', name: 'Late' }));
      index.sessions.upsertFromSummary(summary({ directory: late }));
      await vi.waitFor(() => expect(row(late)).not.toHaveProperty('discovered'));
      expect(row(late)?.org?.smnsId).toBe('late-id');
    });

    it('F10: own on a linked row makes it a project of its own: the link cleared', async () => {
      await open();
      seam.projects.set('target-id', { hub: true, nameRev: 0 });
      const linked = folder('own-linked');
      await add(linked, { into: 'target-id' });
      const own = await add(linked, { own: true });
      expect(own).toMatchObject({ by: 'minted', at: linked, project: { stated: 'minted', org: { smnsId: minted(linked) } } });
      expect(columns(linked)?.stated_linked).toBeNull();
    });

    it('F11: an add that folds to the home directory does not mint it: only an add of that very folder does', async () => {
      await open();
      const side = folder('home', 'me', '.claude', 'worktrees', 'side');
      expect((await add(side)).project.directory).toBe(home);
      expect(minted(home)).toBeNull();
    });

    it('F12: a row under a parent’s statement carries `stated`, and where the statement is', async () => {
      await open();
      const parent = folder('name-parent');
      const child = folder('name-parent', 'child');
      const id = (await add(parent)).project.org!.smnsId!;
      await add(child);
      expect(row(child)).toMatchObject({ stated: 'minted', org: { smnsId: id } });
      index.statements.update(row(parent)!.id, { name: 'Chosen name' });
      writeFileSync(join(parent, '.smns'), JSON.stringify({ project: 'ignored-file-id', name: 'Ignored file' }));
      await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => ENROLLED, home, folderCheckMs: 60 * 60_000 });
      const rows = index.projectsSource().snapshot()!.rows;
      expect(rows.find((r) => r.path === parent)).toMatchObject({ stated: 'minted', statedAt: parent });
      expect(rows.find((r) => r.path === child)).toMatchObject({ stated: 'minted', statedAt: parent });
      const locations = rows.map((r) => ({ pid: r.pid, id: r.org.smnsId ?? 'machine-id', key: r.org.key, name: r.name, path: r.path, source: r.org.source, ...(r.stated ? { stated: r.stated } : {}), ...(r.nameRev ? { nameRev: r.nameRev } : {}) }));
      const [assembled] = assembleProjects([{ org: ENROLLED.org, machine: MACHINE, revision: 1, issued: new Date().toISOString(), locations, known: [] }], new Set(['machine-id'])).filter((p) => p.id === id);
      expect(assembled).toMatchObject({ name: 'Chosen name', renamable: true });
    });
  });

  // M8's review 2 (.doperpowers/sde/2026-11-10-project-registry/task-8-review-2.md): each finding, reproduced
  describe('review 2', () => {
    const settle = async () => {
      for (let k = 0; k < 100; k++) await new Promise((resolve) => setImmediate(resolve));
    };
    const refresh = (enrollment: Enrollment | null = ENROLLED) => index.refreshOrgProjects({ machine: MACHINE, enrollment: () => enrollment, home, folderCheckMs: 60 * 60_000 });
    // a row's size as a projects record carries it
    const bytes = (r: DeclaredRow) => Buffer.byteLength(JSON.stringify({ pid: r.pid, id: r.org.smnsId ?? 'machine-id', key: r.org.key, name: r.name, path: r.path, source: r.org.source, ...(r.stated ? { stated: r.stated } : {}), ...(r.remote ? { remote: r.remote } : {}), ...(r.hub === false ? { hub: false } : {}) }));
    const checked = (path: string) => seam.fitted.flat().filter((r) => r.path === path).at(-1);

    it('R1: a restored statement on a missing folder gives the row its identity, so the snapshot is published', async () => {
      await open();
      const missing = folder('missing-restored');
      const anchor = readAnchor(missing);
      renameSync(missing, `${missing}-away`);
      const restored = '44444444-4444-4444-8444-444444444444';
      index.projectsSource().restore([{ path: missing, minted: restored, linked: null, anchor, name: 'missing-restored', nameRev: null, hidden: false }]);
      await vi.waitFor(() => expect(index.projectsSource().snapshot()).not.toBeNull());
      expect(index.projectsSource().snapshot()!.rows.find((r) => r.path === missing)).toMatchObject({ org: { smnsId: restored }, stated: 'minted', statedAt: missing, state: 'missing' });
      await add(folder('available'));
      await settle();
      expect(index.projectsSource().snapshot()!.rows.map((r) => r.path)).toEqual(expect.arrayContaining([missing, join(tree.path, 'available')]));
    });

    it('R2: a session in a folder that cannot be read is filed, the .smns walk reading nothing there', async () => {
      await open();
      const locked = folder('locked');
      chmodSync(locked, 0);
      try {
        expect(() => index.sessions.upsertFromSummary(summary({ directory: locked }))).not.toThrow();
      } finally {
        chmodSync(locked, 0o755);
      }
    });

    it('R3: a replaced folder whose original returns is derived again, and its project is the minted one', async () => {
      await open();
      const back = folder('back');
      const under = folder('back', 'under');
      const id = (await add(back)).project.org!.smnsId!;
      index.sessions.upsertFromSummary(summary({ directory: under }));
      await vi.waitFor(() => expect(row(under)?.org?.smnsId).toBe(id));
      renameSync(back, `${back}-original`);
      mkdirSync(back);
      await index.statements.checkFolders();
      await settle();
      expect(row(back)?.org?.smnsId).toBeNull();
      expect(await index.statements.resolve(back)).toMatchObject({ by: 'machine' });
      rmSync(back, { recursive: true });
      renameSync(`${back}-original`, back);
      await index.statements.checkFolders();
      expect(row(back)).not.toHaveProperty('state');
      await vi.waitFor(() => expect(row(back)?.org?.smnsId).toBe(id));
      await vi.waitFor(() => expect(row(under)?.org?.smnsId).toBe(id));
      expect(await index.statements.resolve(back)).toMatchObject({ project: id, by: 'minted' });
    });

    it('R4: two declarations at once are admitted one at a time, an underived declared row counted', async () => {
      await open();
      await add(folder('first'));
      seam.limit = index.projects.declaredRows().length + 1;
      const answers = await Promise.allSettled([add(folder('concurrent-one')), add(folder('concurrent-two'))]);
      expect(answers.map((a) => a.status).sort()).toEqual(['fulfilled', 'rejected']);
      await settle();
      expect(index.projects.list({ includeHidden: true }).filter((p) => p.directory.includes('concurrent-')).filter((p) => !p.hidden && index.projects.declaredIds().includes(p.id))).toHaveLength(1);
    });

    it('R5: the bound is asked with each row as it is published: minted, linked, or as its deciding .smns says', async () => {
      await open();
      seam.projects.set('hub-target', { hub: true, nameRev: 0 });
      const mint = folder('to-mint');
      await add(mint);
      expect(bytes(checked(mint)!)).toBe(bytes(index.projects.declaredRows().find((r) => r.path === mint)!));
      const link = folder('to-link');
      await add(link, { into: 'hub-target' });
      expect(bytes(checked(link)!)).toBe(bytes(index.projects.declaredRows().find((r) => r.path === link)!));
      const fileRoot = folder('by-file');
      const fileChild = folder('by-file', 'sub');
      writeFileSync(join(fileRoot, '.smns'), JSON.stringify({ project: 'file-id', name: 'x'.repeat(128), hub: { org: ENROLLED.org } }));
      index.sessions.upsertFromSummary(summary({ directory: fileChild }));
      await vi.waitFor(() => expect(index.projects.declaredRows().find((r) => r.path === fileRoot)).toBeDefined());
      expect(bytes(checked(fileRoot)!)).toBe(bytes(index.projects.declaredRows().find((r) => r.path === fileRoot)!));
    });

    it('R6: on an unenrolled machine a missing folder keeps no statement-made identity', async () => {
      await open();
      const away = folder('unenroll');
      const id = (await add(away)).project.id;
      renameSync(away, `${away}-away`);
      await refresh(null);
      const record = index.projects.record(id);
      expect(record.org?.smnsId ?? null).toBeNull();
      expect(record).not.toHaveProperty('stated');
    });
  });

  // branch review 1, P2: the rows are derived again when the enrollment moves, whatever minting would take; a row's
  // identity from a stored statement holds on an enrolled machine alone
  describe('branch review 1', () => {
    let enrollment: Enrollment | null = ENROLLED;
    const start = () => index.refreshOrgProjects({ machine: MACHINE, enrollment: () => enrollment, home, folderCheckMs: 60 * 60_000 });
    /** The row at `path` as the endpoint reads it (§H's snapshot). */
    const published = (path: string) => index.projectsSource().snapshot()?.rows.find((r) => r.path === path);
    /** A minted folder and a discovered row beneath it, both in the minted project. */
    const mintedTree = async () => {
      const plain = folder('plain');
      await add(plain);
      const id = minted(plain)!;
      const sub = index.projects.ensureForDirectory(folder('plain', 'sub'), 'discovered').directory;
      await vi.waitFor(() => expect(row(sub)?.org?.smnsId).toBe(id));
      return { plain, sub, id };
    };
    const inForce = async ({ plain, sub, id }: Awaited<ReturnType<typeof mintedTree>>) => {
      await vi.waitFor(() => expect([row(plain)?.org?.smnsId, row(sub)?.org?.smnsId]).toEqual([id, id]));
      expect(row(plain)).toMatchObject({ stated: 'minted' });
      expect(published(plain)).toMatchObject({ stated: 'minted', statedAt: plain, org: { smnsId: id } });
    };
    const notInForce = async ({ plain, sub }: Awaited<ReturnType<typeof mintedTree>>) => {
      await vi.waitFor(() => expect([row(plain)?.org?.smnsId ?? null, row(sub)?.org?.smnsId ?? null]).toEqual([null, null]));
      expect(row(plain)).not.toHaveProperty('stated');
      expect(published(plain)?.org.smnsId ?? null).toBeNull();
      expect(published(plain)).not.toHaveProperty('stated');
    };

    it('P2: a minted row an unenrolled start derived takes its statement once the machine enrolls, with no restart', async () => {
      enrollment = ENROLLED;
      await open();
      const tree = await mintedTree();
      enrollment = null; // a start while not enrolled: the statement counts for nothing
      seam.state = { possible: false, reason: 'not-enrolled' };
      await start();
      await notInForce(tree);
      enrollment = ENROLLED;
      seam.turn({ possible: true });
      await inForce(tree);
      expect(minted(tree.plain)).toBe(tree.id);
    });

    it('P2: an enrolled machine unenrolled, and enrolled again, with no restart: the statement out of force, then in again', async () => {
      enrollment = ENROLLED;
      await open();
      await start();
      const tree = await mintedTree();
      enrollment = null;
      seam.turn({ possible: false, reason: 'not-enrolled' });
      await notInForce(tree);
      expect(minted(tree.plain), 'the statement itself is kept').toBe(tree.id);
      enrollment = ENROLLED;
      seam.turn({ possible: true });
      await inForce(tree);
    });
  });

  // The registry branch's xhigh panel 1 (.doperpowers/sde/2026-11-10-project-registry/registry-panel-1.md): each finding of
  // the index's, reproduced
  describe('panel 1', () => {
    const settle = async () => {
      for (let k = 0; k < 100; k++) await new Promise((resolve) => setImmediate(resolve));
    };
    const published = (path: string) => index.projectsSource().snapshot()?.rows.find((r) => r.path === path);

    it('sweep#1: a replaced location stays its stated project’s for the registry, with its state, and its Remove is the one asked', async () => {
      await open();
      const swapped = folder('swapped');
      const id = (await add(swapped)).project.org!.smnsId!;
      rmSync(swapped, { recursive: true });
      mkdirSync(swapped);
      await index.statements.checkFolders();
      await settle();
      // a session there is not in the old project
      expect(row(swapped)?.org?.smnsId ?? null).toBeNull();
      // but the location is: other devices list it under its project, replaced, with Use this folder and Remove
      expect(published(swapped)).toMatchObject({ org: { smnsId: id }, state: 'replaced' });
      expect(published(swapped)).not.toHaveProperty('stated');
      // Remove, as a held removal sends it: the location's path and project as the registry listed them
      await index.statements.remove(row(swapped)!.id, { path: swapped, project: id });
      expect(row(swapped)).toMatchObject({ hidden: true });
    });

    it('scalpel-2#2: a rename that would take the record past its bound is refused as admission refuses it, and nothing is written', async () => {
      await open();
      const plain = folder('renamed');
      await add(plain);
      const pid = row(plain)!.id;
      seam.fit = false; // the record is at its bound
      expect(() => index.statements.update(pid, { name: 'A much longer name' })).toThrow(refusal('too-many-locations'));
      expect(row(plain)).toMatchObject({ name: 'renamed' });
      expect(row(plain)).not.toHaveProperty('nameRev');
      // asked with the row as it would be published: its new name and counter
      expect(seam.fitted.at(-1)?.find((r) => r.pid === pid)).toMatchObject({ name: 'A much longer name', nameRev: 1 });
      // an order alone grows nothing, and is not asked
      const asked = seam.fitted.length;
      expect(index.statements.update(pid, { order: 4 })).toMatchObject({ order: 4 });
      expect(seam.fitted).toHaveLength(asked);
      seam.fit = true;
      expect(index.statements.update(pid, { name: 'A much longer name' })).toMatchObject({ name: 'A much longer name', nameRev: 1 });
    });

    it('scalpel-5#1: no snapshot pairs a changed statement with the project derived before it', async () => {
      await open();
      seam.projects.set('target-id', { hub: true, nameRev: 0 });
      const plain = folder('linking');
      const minted = (await add(plain)).project.org!.smnsId!;
      const source = index.projectsSource();
      const seen: Array<NonNullable<ReturnType<typeof source.snapshot>>> = [];
      const off = source.onChange(() => {
        const snapshot = source.snapshot();
        if (snapshot !== null) seen.push(snapshot);
      });
      const pid = row(plain)!.id;
      await index.statements.link(pid, 'target-id');
      await index.statements.link(pid, null);
      await settle();
      off();
      const pairs = seen.map((snapshot) => {
        const kept = snapshot.statements.find((s) => s.path === plain)!;
        return [kept.linked ?? kept.minted, snapshot.rows.find((r) => r.path === plain)?.org.smnsId ?? null];
      });
      expect(pairs.length).toBeGreaterThan(0);
      for (const [stated, derived] of pairs) expect(derived).toBe(stated);
      expect(pairs.at(-1)).toEqual([minted, minted]);
    });

    it('scalpel-5#2: a derivation read before a relocation never lands on the relocated row', async () => {
      const made = standIn();
      seam = made.seam;
      index = new Index(join(dir.path, 'index.sqlite'), { registry: made.registry });
      const gated = new Set<string>();
      let release = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const rule: DeriveRule = async (subject, enrollment, options) => {
        if (gated.has(subject.directory)) await gate;
        return deriveProject(subject, enrollment, options);
      };
      await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => ENROLLED, home, folderCheckMs: 60 * 60_000, rule });
      const before = folder('before');
      const after = folder('after');
      const id = (await add(before)).project.org!.smnsId!;
      const pid = row(before)!.id;
      gated.add(before);
      const stale = index.statements.deriveRow({ id: pid, directory: before, name: 'before' }); // a refresh's, reading the old folder
      await index.statements.relocate(pid, after);
      expect(row(after)?.org?.smnsId).toBe(id);
      release();
      await stale;
      await settle();
      expect(row(after)?.org?.smnsId).toBe(id);
      expect(published(after)).toMatchObject({ org: { smnsId: id }, stated: 'minted', statedAt: after });
    });
  });
});
