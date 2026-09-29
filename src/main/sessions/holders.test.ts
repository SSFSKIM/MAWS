import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { record } from '../../../test/support/builders';
import { FakeHolderHost } from '../../../test/support/holder-host';
import { canonicalPath, holderAuthority, occupancyOf, type HolderDeps } from './holders';

const id = (s: string) => s as AppSessionId;
const sid = (s: string) => s as SessionId;

describe('holder authority', () => {
  let host: FakeHolderHost;
  let records: SessionRecord[];
  let deps: HolderDeps;
  beforeEach(() => {
    host = new FakeHolderHost();
    records = [];
    deps = { dispatch: host.dispatch, sessions: { list: () => records } };
  });

  it('answers self for a MAWS reservation, which wins over a registry holder, without asking the registry', async () => {
    host.reserve('app-1', '/work/a');
    host.hold('eng-app-1', { kind: 'terminal', pid: 41 }, '/work/a');
    await expect(holderAuthority(deps, { engineSessionId: sid('eng-app-1'), appSessionId: id('app-1') })).resolves.toEqual({
      holder: { kind: 'self' },
      live: 'self',
      source: 'reservation',
    });
    expect(host.queries).toEqual([]);
  });

  it('counts a reservation until the OS reports the exit: exiting is self, exited is not', async () => {
    host.reserve('app-1', '/work/a', { process: 'exiting' });
    await expect(holderAuthority(deps, { engineSessionId: null, appSessionId: id('app-1') })).resolves.toMatchObject({ live: 'self' });
    host.reservations[0].process = 'exited';
    await expect(holderAuthority(deps, { engineSessionId: null, appSessionId: id('app-1') })).resolves.toMatchObject({ live: 'none' });
  });

  it('answers a reservation of the same engine session under another app id as self: MAWS never becomes a second writer', async () => {
    host.reserve('app-2', '/work/a', { engineSessionId: sid('eng-1') });
    await expect(holderAuthority(deps, { engineSessionId: sid('eng-1'), appSessionId: id('app-1') })).resolves.toMatchObject({ live: 'self' });
  });

  it('answers foreign from a fresh registry read even when the index record says none', async () => {
    records.push(record('app-1', { holder: { kind: 'none' } }));
    host.hold('eng-app-1', { kind: 'background_job', pid: 42, jobId: '1a2b3c4d' }, '/work/a');
    await expect(holderAuthority(deps, { engineSessionId: sid('eng-app-1'), appSessionId: id('app-1') })).resolves.toEqual({
      holder: { kind: 'background_job', pid: 42, jobId: '1a2b3c4d' },
      live: 'foreign',
      source: 'registry',
    });
    expect(host.queries).toEqual([{ sessionIds: ['eng-app-1'], directories: null }]);
  });

  it('answers none when nothing holds the session, and asks no registry for a session with no engine id', async () => {
    records.push(record('app-1', { holder: { kind: 'terminal', pid: 9 } })); // a stale projection is never read
    await expect(holderAuthority(deps, { engineSessionId: sid('eng-app-1'), appSessionId: id('app-1') })).resolves.toEqual({
      holder: { kind: 'none' },
      live: 'none',
      source: 'none',
    });
    await expect(holderAuthority(deps, { engineSessionId: null, appSessionId: id('app-2') })).resolves.toMatchObject({ live: 'none' });
    expect(host.queries).toHaveLength(1);
  });

  it('refuses with C4’s message when the registry fails closed, never reading it as no holders', async () => {
    host.registryFailure = 'holder registry unreadable: EACCES';
    await expect(holderAuthority(deps, { engineSessionId: sid('eng-1'), appSessionId: id('app-1') })).rejects.toThrow('holder registry unreadable: EACCES');
  });

  it('refuses when the process table cannot be read', async () => {
    deps.dispatch = async () => ({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is not running' } });
    await expect(holderAuthority(deps, { engineSessionId: sid('eng-1'), appSessionId: id('app-1') })).rejects.toThrow('engine-host is not running');
  });
});

describe('occupancy of a directory', () => {
  let temp: string;
  let host: FakeHolderHost;
  let records: SessionRecord[];
  let deps: HolderDeps;
  let wt: string;
  beforeEach(() => {
    temp = realpathSync(mkdtempSync(join(tmpdir(), 'maws-holders-')));
    wt = join(temp, 'wt');
    mkdirSync(wt);
    mkdirSync(join(temp, 'elsewhere'));
    symlinkSync(wt, join(temp, 'link'));
    host = new FakeHolderHost();
    records = [];
    deps = { dispatch: host.dispatch, sessions: { list: (opts) => (opts?.includeArchived ? records : records.filter((r) => !r.archived)) } };
  });
  afterEach(() => rmSync(temp, { recursive: true, force: true }));

  const empty = { self: 0, foreign: 0, unbound: 0, idle: 0, archived: 0, idleAppSessionIds: [], liveAppSessionIds: [] };

  it('is empty for a directory nobody is in, and reads every live registry holder fresh', async () => {
    records.push(record('app-x', { directory: join(temp, 'elsewhere') }));
    host.hold('eng-elsewhere', { kind: 'terminal', pid: 70 }, join(temp, 'elsewhere'));
    await expect(occupancyOf(deps, wt)).resolves.toEqual(empty);
    expect(host.queries).toEqual([{ sessionIds: null, directories: null }]);
  });

  it('counts processes and records in a subdirectory, but not inside a nested worktree the caller names', async () => {
    mkdirSync(join(wt, 'src'));
    mkdirSync(join(wt, 'nested', 'deep'), { recursive: true });
    host.hold('eng-sub', { kind: 'terminal', pid: 71 }, join(temp, 'link', 'src')); // `cd src && claude`
    host.reserve('in-sub', join(wt, 'src'));
    host.hold('eng-nested', { kind: 'terminal', pid: 72 }, join(wt, 'nested', 'deep'));
    host.reserve('in-nested', join(wt, 'nested'));
    records.push(record('sub', { directory: join(wt, 'src'), engineSessionId: sid('eng-sub-record') }), record('nest', { directory: join(wt, 'nested') }));
    await expect(occupancyOf(deps, wt, { nested: [join(wt, 'nested')] })).resolves.toEqual({ ...empty, self: 1, unbound: 1, idle: 1, idleAppSessionIds: ['sub'] });
    await expect(occupancyOf(deps, join(temp, 'wtx'))).resolves.toEqual(empty); // a sibling sharing the prefix is not under it
  });

  it('counts a registry holder whose cwd is the directory and whose session the index has not seen as unbound', async () => {
    host.hold('eng-terminal', { kind: 'terminal', pid: 77 }, join(temp, 'link')); // reached through a symlink
    await expect(occupancyOf(deps, wt)).resolves.toEqual({ ...empty, unbound: 1 });
  });

  it('counts a reservation whose cwd is the directory as self with no record for it (a trust bootstrap in flight)', async () => {
    host.reserve('bootstrap-1', join(temp, 'link'));
    host.reserve('other', join(temp, 'elsewhere'));
    await expect(occupancyOf(deps, wt)).resolves.toEqual({ ...empty, self: 1 });
  });

  it('partitions the non-archived records here into idle and live, counts archived ones, and ignores records elsewhere', async () => {
    records.push(
      record('a', { directory: wt, engineSessionId: sid('eng-a') }),
      record('b', { directory: join(temp, 'elsewhere'), worktree: { path: wt, branch: 'worktree-wt' }, engineSessionId: sid('eng-b') }),
      record('c', { directory: wt, engineSessionId: null }),
      record('d', { directory: wt, archived: true, engineSessionId: sid('eng-d') }),
      record('e', { directory: join(temp, 'elsewhere'), engineSessionId: sid('eng-e') }),
    );
    host.reserve('a', wt, { engineSessionId: sid('eng-a') });
    const answer = await occupancyOf(deps, join(temp, 'link'));
    expect(answer).toEqual({ ...empty, self: 1, idle: 2, archived: 1, idleAppSessionIds: ['b', 'c'], liveAppSessionIds: ['a'] });
  });

  it('counts a registry holder of a record here as foreign and names the record live', async () => {
    records.push(record('a', { directory: wt, engineSessionId: sid('eng-a') }), record('b', { directory: wt, engineSessionId: sid('eng-b') }));
    host.hold('eng-a', { kind: 'terminal', pid: 5 }, wt, 'a');
    host.hold('eng-known-elsewhere', { kind: 'terminal', pid: 6 }, wt); // the index knows it, bound to a record elsewhere
    records.push(record('z', { directory: join(temp, 'elsewhere'), engineSessionId: sid('eng-known-elsewhere') }));
    await expect(occupancyOf(deps, wt)).resolves.toEqual({ ...empty, foreign: 2, idle: 1, idleAppSessionIds: ['b'], liveAppSessionIds: ['a'] });
  });

  it('fails with C4’s message when the registry fails closed, never answering an empty directory', async () => {
    host.registryFailure = 'holder registry unreadable: EACCES';
    await expect(occupancyOf(deps, wt)).rejects.toThrow('holder registry unreadable: EACCES');
  });
});

describe('canonical paths', () => {
  it('resolves symlinks, and a missing path through its nearest existing ancestor, in NFC', async () => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'maws-canon-')));
    try {
      mkdirSync(join(temp, 'real'));
      symlinkSync(join(temp, 'real'), join(temp, 'link'));
      await expect(canonicalPath(join(temp, 'link'))).resolves.toBe(join(temp, 'real'));
      await expect(canonicalPath(join(temp, 'link', 'gone', 'deeper/'))).resolves.toBe(join(temp, 'real', 'gone', 'deeper'));
      await expect(canonicalPath(join(temp, 'Café'))).resolves.toBe(join(temp, 'Café'));
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
