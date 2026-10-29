// P5 O6 M5 (docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The derivation"; acceptance 10): an org
// project follows sminos's rule, held to sminos 1.15.0's own vectors (test/fixtures/sminos/, PROVENANCE.md there), and
// each derivation case is pinned on real temporary repositories under the OS temp dir, removed after each test.
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import { runGit } from '../../../test/support/git-fixture';
import { tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';
import { repoProjectId } from '@shared/machine/project-ids';
import { deriveOrg, machineProject, remoteKey, remoteName, type Enrollment } from './org-project';
import type { ProjectOrg } from '@shared/ipc/schema/session';

const FIXTURES = join(__dirname, '../../../test/fixtures/sminos');
const readVectors = <T>(file: string): { namespace: string; vectors: T[] } => JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
const MACHINE = 'OrgTestMachine00000000' as MachineRef;
const ENROLLED: Enrollment = { org: 'ssfskim', machine: 'MacBook' };

describe("sminos 1.15.0's vectors", () => {
  it('derives every remote key, name and project id of remote-key.json', () => {
    const { vectors } = readVectors<{ org: string; url: string; key: string; name: string; hashed?: string; id?: string }>('remote-key.json');
    expect(vectors.length).toBeGreaterThan(20);
    for (const vector of vectors) {
      expect({ url: vector.url, key: remoteKey(vector.url), name: remoteName(vector.url) }).toEqual({ url: vector.url, key: vector.key, name: vector.name });
      if (vector.id !== undefined) expect(repoProjectId(vector.org, vector.key)).toBe(vector.id);
    }
  });
});

describe('the derivation, on real repositories', () => {
  let root: ReturnType<typeof tempDir>;
  beforeEach(() => {
    root = tempDir('maws-org-project-');
  });
  afterEach(() => root.dispose());

  const folder = (...parts: string[]) => {
    const path = join(root.path, ...parts);
    mkdirSync(path, { recursive: true });
    return path;
  };
  const repo = async (name: string, remotes: [string, string][] = []) => {
    const path = folder(name);
    await runGit(path, ['init', '-q', '-b', 'main']);
    for (const [remote, url] of remotes) await runGit(path, ['remote', 'add', remote, url]);
    return path;
  };
  const derive = (directory: string, enrollment: Enrollment | null = null, name = basename(directory)) =>
    deriveOrg({ directory, machine: MACHINE, projectId: 'p-1', name }, enrollment);
  const repoKey = (path: string) => `repo:${MACHINE}:${createHash('sha256').update(path).digest('hex').slice(0, 16)}`;

  it('a .smns names the project, found walking up, its id kept for joins', async () => {
    const path = await repo('declared', [['origin', 'https://github.com/example/declared.git']]);
    writeFileSync(join(path, '.smns'), JSON.stringify({ project: 'declared-id', name: 'Declared' }));
    const sub = folder('declared', 'packages', 'web');
    for (const directory of [path, sub]) {
      expect(await derive(directory)).toEqual({ key: 'smns:declared-id', name: 'Declared', source: 'smns', smnsId: 'declared-id' });
    }
  });

  it('a .smns that names no valid project is passed over, as sminos warns and goes on', async () => {
    const path = await repo('broken', [['origin', 'git@github.com:example/broken.git']]);
    writeFileSync(join(path, '.smns'), JSON.stringify({ project: '../escape' }));
    expect(await derive(path)).toMatchObject({ key: 'remote:github.com/example/broken', source: 'remote' });
  });

  // sminos's `read_smns` takes `str(d.get(k) or "")`: a truthy non-string is its Python text, a falsy one is absent
  it('a .smns field that is no string reads as sminos reads it', async () => {
    const path = await repo('coerced', [['origin', 'https://github.com/example/coerced.git']]);
    const smns = (body: object) => writeFileSync(join(path, '.smns'), JSON.stringify(body));
    smns({ project: 42, name: 123 });
    expect(await derive(path)).toEqual({ key: 'smns:42', name: '123', source: 'smns', smnsId: '42' });
    smns({ project: 'p', name: true });
    expect(await derive(path)).toMatchObject({ key: 'smns:p', name: 'True' });
    smns({ project: 'p', name: 0 }); // falsy: the project stands for the name
    expect(await derive(path)).toMatchObject({ key: 'smns:p', name: 'p' });
    smns({ project: 'p', name: ['a', 1, null] });
    expect(await derive(path)).toMatchObject({ key: 'smns:p', name: "['a', 1, None]" });
    smns({ project: false });
    expect(await derive(path)).toMatchObject({ key: 'remote:github.com/example/coerced', source: 'remote' });
  });

  it("a linked worktree whose head predates the .smns reads its main checkout's", async () => {
    const main = await repo('shared', [['origin', 'https://github.com/example/shared.git']]);
    await runGit(main, ['commit', '-q', '--allow-empty', '-m', 'first']);
    const linked = join(root.path, 'shared-b');
    await runGit(main, ['worktree', 'add', '-q', '-b', 'standin-b', linked]);
    expect(await derive(linked)).toMatchObject({ key: 'remote:github.com/example/shared', name: 'shared', source: 'remote' });
    writeFileSync(join(main, '.smns'), JSON.stringify({ project: 'shared-id', name: 'Shared' }));
    expect(await derive(linked)).toEqual({ key: 'smns:shared-id', name: 'Shared', source: 'smns', smnsId: 'shared-id' });
  });

  it('origin, else the only remote, derives the key; a linked worktree reads its main checkout’s config', async () => {
    const both = await repo('both', [['upstream', 'https://gitlab.com/other/thing.git'], ['origin', 'git@github.com:Example/Both.git']]);
    expect(await derive(both)).toEqual({ key: 'remote:github.com/example/both', name: 'Both', source: 'remote', smnsId: null });
    const only = await repo('only', [['upstream', 'https://gitlab.com/Group/Sub/Only.git']]);
    expect(await derive(only)).toEqual({ key: 'remote:gitlab.com/group/sub/only', name: 'Only', source: 'remote', smnsId: null });
    await runGit(both, ['commit', '-q', '--allow-empty', '-m', 'first']);
    const linked = join(root.path, 'both-linked');
    await runGit(both, ['worktree', 'add', '-q', '-b', 'side', linked]);
    expect(await derive(linked)).toMatchObject({ key: 'remote:github.com/example/both' });
  });

  it('two remotes and no origin, a local-path remote and no remote key by the owning repository', async () => {
    const two = await repo('two', [['a', 'https://github.com/example/a.git'], ['b', 'https://github.com/example/b.git']]);
    const local = await repo('local', [['origin', '/srv/git/local.git']]);
    const none = await repo('none');
    for (const path of [two, local, none]) {
      expect(await derive(path)).toEqual({ key: repoKey(path), name: basename(path), source: 'repository', smnsId: null });
    }
    // a subfolder is its repository's
    expect(await derive(folder('none', 'src'))).toMatchObject({ key: repoKey(none), name: 'none' });
  });

  it('a folder in no repository is a project of its own on its machine, named as the project is', async () => {
    const plain = folder('plain');
    expect(await derive(plain, null, 'My notes')).toEqual({ key: `folder:${MACHINE}:p-1`, name: 'My notes', source: 'folder', smnsId: null });
  });

  it('an enrolled machine joins by sminos’s id; the key is the same as an unenrolled one’s', async () => {
    const path = await repo('enrolled', [['origin', 'git@github.com:SSFSKIM/MAWS.git']]);
    const before = await derive(path, null);
    const after = await derive(path, ENROLLED);
    expect(before).toEqual({ key: 'remote:github.com/ssfskim/maws', name: 'MAWS', source: 'remote', smnsId: null });
    expect(after).toEqual({ ...before, smnsId: 'f5c49acd-50a8-59e5-81d7-a5dd4c5e40bd' }); // remote-key.json's first vector
    const plain = folder('plain-enrolled');
    expect(await derive(plain, ENROLLED)).toEqual(await derive(plain, null));
  });

  // M6 (hosted e2e:machines): a cold `/usr/bin/git` shim outlasted the 2 s timeout on every try, each try killed
  // before it could warm; a derivation takes the timeout its caller gives, so a retry can wait longer.
  it('git slower than the given timeout gives no answer; a longer timeout lets it answer', async () => {
    const path = await repo('slow-git', [['origin', 'https://github.com/example/slow.git']]);
    const slowGit = join(folder('bin'), 'git');
    writeFileSync(slowGit, '#!/bin/sh\nsleep 0.5\nexec /usr/bin/git "$@"\n');
    chmodSync(slowGit, 0o755);
    const was = process.env.MAWS_GIT;
    process.env.MAWS_GIT = slowGit;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const subject = { directory: path, machine: MACHINE, projectId: 'p-1', name: 'slow-git' };
      expect(await deriveOrg(subject, null, 100)).toBeNull();
      expect(await deriveOrg(subject, null, 5_000)).toMatchObject({ key: 'remote:github.com/example/slow' });
      // no answer says why, so a hosted run's red names its cause
      expect(warn.mock.calls.map(([line]) => String(line))).toEqual([expect.stringMatching(/^\[index\] git config .* gave no answer: timed out after 100 ms$/)]);
      warn.mockClear();
      process.env.MAWS_GIT = join(root.path, 'no-such-git');
      expect(await deriveOrg(subject, null, 5_000)).toBeNull();
      expect(warn.mock.calls.map(([line]) => String(line))).toEqual([expect.stringMatching(/ gave no answer: it could not run \(ENOENT\)$/)]);
    } finally {
      warn.mockRestore();
      if (was === undefined) delete process.env.MAWS_GIT;
      else process.env.MAWS_GIT = was;
    }
  });

  it("the machine's own project: its key, its name, sminos's machine project id once enrolled", () => {
    expect(machineProject(MACHINE, 'macbook', null)).toEqual({ key: `machine:${MACHINE}`, name: 'macbook', smnsId: null });
    expect(machineProject(MACHINE, 'macbook', ENROLLED)).toEqual({ key: `machine:${MACHINE}`, name: 'macbook', smnsId: '6f2b2401-d443-52fb-a4cd-c9ebd370306b' });
  });
});

describe("the index's org projects", () => {
  let dir: ReturnType<typeof tempDir>;
  let tree: ReturnType<typeof tempDir>;
  let index: Index;
  beforeEach(() => {
    dir = tempDir();
    tree = tempDir('maws-org-index-');
    index = new Index(join(dir.path, 'index.sqlite'));
  });
  afterEach(() => {
    index.close();
    dir.dispose();
    tree.dispose();
  });

  const columns = (id: string) => {
    const db = new DatabaseSync(join(dir.path, 'index.sqlite'), { readOnly: true });
    try {
      return db.prepare('SELECT org_key, org_name, org_source, org_smns_id FROM projects WHERE id = ?').get(id);
    } finally {
      db.close();
    }
  };

  it('refreshes every project at start, persists it in the project row, and tells the change once', async () => {
    const path = join(tree.path, 'app');
    mkdirSync(path);
    await runGit(path, ['init', '-q']);
    await runGit(path, ['remote', 'add', 'origin', 'https://github.com/example/app.git']);
    const added = index.projects.add(path);
    expect(added.org).toBeUndefined(); // not derived before the refresh starts
    let changes = 0;
    index.projects.onChange(() => (changes += 1));
    await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => null });
    expect(changes).toBe(1);
    expect(index.projects.list()[0].org).toEqual({ key: 'remote:github.com/example/app', name: 'app', source: 'remote', smnsId: null });
    expect(columns(added.id)).toEqual({ org_key: 'remote:github.com/example/app', org_name: 'app', org_source: 'remote', org_smns_id: null });
    await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => null });
    expect(changes).toBe(1); // nothing changed, nothing told

    // the same key after enrollment: only the join id moves
    await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => ENROLLED });
    expect(columns(added.id)).toMatchObject({ org_key: 'remote:github.com/example/app', org_smns_id: repoProjectId('ssfskim', 'github.com/example/app') });
    expect(changes).toBe(2);
  });

  // M6 (hosted e2e:machines): git that gives no answer while two apps start (its 2 s timeout) left a project underived
  // for the whole run. Such a derivation is asked again later in the run, a bounded number of times.
  it('asks again later in the run when git gave no answer, and stops after its last try', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const path = join(tree.path, 'slow');
      mkdirSync(path);
      const added = index.projects.add(path);
      const org: ProjectOrg = { key: `folder:${MACHINE}:${added.id}` as ProjectOrg['key'], name: 'slow', source: 'folder', smnsId: null };
      const answers: (ProjectOrg | null)[] = [null, null, org];
      const derive = vi.fn<typeof deriveOrg>(async () => answers.shift() ?? null);
      await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => null, derive });
      expect(index.projects.list()[0].org).toBeUndefined();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(derive).toHaveBeenCalledTimes(3);
      // the first try keeps the short timeout, so a slow git never holds up a start; a retry waits as long as the git
      // runner does, long enough for a cold `/usr/bin/git` shim to answer once
      expect(derive.mock.calls.map((call) => call[2]), 'the git timeout of each try').toEqual([2_000, 10_000, 10_000]);
      expect(index.projects.list()[0].org).toEqual(org);

      const never = join(tree.path, 'never');
      mkdirSync(never);
      const silent = vi.fn(async () => null);
      const other = new Index(join(dir.path, 'other.sqlite'));
      try {
        other.projects.add(never);
        await other.refreshOrgProjects({ machine: MACHINE, enrollment: () => null, derive: silent });
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(silent.mock.calls.length, 'a bounded number of tries').toBeLessThanOrEqual(5);
        expect(other.projects.list()[0].org).toBeUndefined();
      } finally {
        other.close();
      }
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  // The branch review of the retry: the retries go through the same four derivations at a time as the start's queue, so
  // many projects unanswered at start do not all ask git again at once.
  it('asks again through the start’s limit: no more than four derivations in flight, retries included', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (let k = 0; k < 20; k++) {
        const path = join(tree.path, `many-${k}`);
        mkdirSync(path);
        index.projects.add(path);
      }
      let inFlight = 0;
      let most = 0;
      let calls = 0;
      const derive = vi.fn(async () => {
        calls += 1;
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 100)); // git's answer takes a while
        inFlight -= 1;
        return null;
      });
      const refreshed = index.refreshOrgProjects({ machine: MACHINE, enrollment: () => null, derive });
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await refreshed;
      expect(calls, 'every project asked four times').toBe(80);
      expect(most, 'at most four in flight, retries included').toBeLessThanOrEqual(4);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('derives a project created after the refresh started, and keeps a folder project’s name with its rename', async () => {
    await index.refreshOrgProjects({ machine: MACHINE, enrollment: () => null });
    const path = join(tree.path, 'notes');
    mkdirSync(path);
    const changed = new Promise<void>((resolve) => {
      const off = index.projects.onChange(() => {
        if (index.projects.list().some((p) => p.org !== undefined)) {
          off();
          resolve();
        }
      });
    });
    const added = index.projects.add(path);
    await changed;
    expect(index.projects.list()[0].org).toEqual({ key: `folder:${MACHINE}:${added.id}`, name: 'notes', source: 'folder', smnsId: null });
    index.projects.update(added.id, { name: 'Notes' });
    expect(index.projects.list()[0].org).toMatchObject({ name: 'Notes', source: 'folder' });
  });
});
