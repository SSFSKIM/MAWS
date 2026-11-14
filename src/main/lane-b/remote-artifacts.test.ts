// Remote artifacts over a fake link (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5a's "Proves"
// for this file): the id-to-machine table filled from requests and answered rows, the third act shape (an engine-host act
// on no session), the local refusals, the `session.capabilities` substitute, the machine's `artifacts` feed, open-a-copy
// paging a file, a library file and an export into the temporary directory, and Save As of a remote artifact.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import { endableClientRef } from '@shared/ipc/client';
import type { CommandName, CommandResult, EventName } from '@shared/ipc/schema';
import { REMOTE_COPY_MAX_BYTES } from '@shared/ipc/schema/remote';
import { validateEventPayload } from '@shared/ipc/validate';
import type { MachineRef } from '@shared/machine/ref';
import { FakeLink, MINI } from '../../../test/lane-b/fake-link';
import { ArtifactMachines } from '../artifacts/machines';
import type { MainContext } from '../ipc/router';
import { createLibraryFiles } from '../library/files';
import { createRemoteLaneB, routeLaneB } from './remote';
import { TOO_LARGE_WORDS } from './remote-outcomes';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const OTHER = 'OtherMachineRef0000000' as MachineRef;
const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const A3 = '33333333-3333-4333-8333-333333333333';
const LOCAL_ID = '44444444-4444-4444-8444-444444444444';

const row = (id: string, fields: Record<string, unknown> = {}) => ({ id, kind: 'document', title: `artifact ${id.slice(0, 4)}`, createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 3, ...fields });
const libraryRow = (id: string) => ({ ...row(id), lastEditor: { kind: 'human' }, lastEditedAt: 1, sessions: [] });

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const scratch = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

function lab(options: { env?: NodeJS.ProcessEnv } = {}) {
  const link = new FakeLink();
  link.peers = ['rl2.executor.machine', 'rl2.feeds', 'rl2.artifacts', 'rl2.bytes'];
  const links = new Map<MachineRef, FakeLink>([[MINI, link]]);
  const remoteListeners = new Set<(machines: readonly MachineRef[]) => void>();
  const emitted: Array<{ machine: MachineRef; name: EventName; payload: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const machines = new ArtifactMachines();
  const temp = scratch('maws-remote-artifacts-');
  const adapter = createRemoteLaneB({
    local: LOCAL,
    layout: { get: () => null, onChange: () => () => {} },
    remote: (machine) => links.get(machine) ?? null,
    onRemote: (listener) => (remoteListeners.add(listener), () => void remoteListeners.delete(listener)),
    emit: (machine, name, payload) => {
      const checked = validateEventPayload(name, payload);
      if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
      emitted.push({ machine, name, payload: payload as Record<string, unknown> });
    },
    artifactMachines: machines,
    openPath: async (path) => (opened.push(path), ''),
    tempDir: () => temp,
    env: options.env ?? {},
    timing: { sendPendingMs: 2_000, feedRetryMs: [10, 50] },
    log: () => {},
  });
  const route = routeLaneB(async () => ({ ok: true, value: 'base' }) as unknown as CommandResult<CommandName>, (m) => links.get(m) ?? null, adapter);
  const ctx: MainContext = { client: endableClientRef('page-1'), target: MINI };
  return {
    link,
    links,
    adapter,
    machines,
    emitted,
    opened,
    temp,
    cmd: (name: string, input: unknown) => route(MINI, name as CommandName, input, ctx),
    roster: () => remoteListeners.forEach((listener) => listener([...links.keys()])),
    of: (name: EventName) => emitted.filter((e) => e.name === name),
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('the machine an artifact is on', () => {
  it('records the artifact of each request sent to an RL2 machine and each row or record answered', async () => {
    const l = lab();
    l.link.answers.set('artifacts.versions', () => ({ ok: true, output: { versions: [] } }));
    l.link.answers.set('artifacts.list', () => ({ ok: true, output: { artifacts: [row(A2)] } }));
    l.link.answers.set('library.list', () => ({ ok: true, output: { rows: [libraryRow(A3)], counts: { ...Object.fromEntries(ARTIFACT_KINDS.map((kind) => [kind, 0])), document: 1 } } }));
    l.link.answers.set('artifacts.get', (input) => ({ ok: true, output: { artifact: row(String(input.artifactId)) } }));
    expect(l.machines.machineOf(A1)).toBeNull();
    expect(await l.cmd('artifacts.versions', { artifactId: A1 })).toEqual({ ok: true, value: { versions: [] } });
    expect(l.machines.machineOf(A1)).toBe(MINI);
    expect(await l.cmd('artifacts.list', { filter: { appSessionId: 'app-1' } })).toMatchObject({ ok: true });
    expect(await l.cmd('library.list', {})).toMatchObject({ ok: true });
    expect([l.machines.machineOf(A2), l.machines.machineOf(A3)]).toEqual([MINI, MINI]);
    expect(l.machines.machineOf(LOCAL_ID)).toBeNull(); // a local id never enters it
  });

  it('keeps the later answer for an id two machines answer', async () => {
    const l = lab();
    const other = new FakeLink(OTHER);
    other.peers = l.link.peers;
    l.links.set(OTHER, other);
    for (const link of [l.link, other]) link.answers.set('artifacts.get', (input) => ({ ok: true, output: { artifact: row(String(input.artifactId)) } }));
    const ctx: MainContext = { client: endableClientRef('page-1'), target: OTHER };
    await l.cmd('artifacts.get', { artifactId: A1 });
    await l.adapter.dispatch(other, 'artifacts.get' as CommandName, { artifactId: A1 }, ctx);
    expect(l.machines.machineOf(A1)).toBe(OTHER);
  });
});

describe('artifact writes', () => {
  it('seal an engine-host act on no session and no context (the third shape), needing the peer’s `rl2.artifacts`', async () => {
    const l = lab();
    l.link.onAct = (act) => act.settle({ state: 'done', result: { artifact: row(A1, { title: 'Renamed' }) } });
    expect(await l.cmd('artifacts.update', { artifactId: A1, title: 'Renamed' })).toEqual({ ok: true, value: { artifact: row(A1, { title: 'Renamed' }) } });
    const [act] = l.link.acts;
    expect(act!.request).toEqual({ action: 'artifacts.update', args: { artifactId: A1, title: 'Renamed' }, executor: 'engine-host', sendBy: expect.any(Number), requires: 'rl2.artifacts' });
    expect(l.machines.machineOf(A1)).toBe(MINI);
  });

  it('record what `create` and `duplicate` answer', async () => {
    const l = lab();
    l.link.onAct = (act) => act.settle({ state: 'done', result: { artifact: row(act.request.action === 'artifacts.create' ? A2 : A3) } });
    await l.cmd('artifacts.create', { kind: 'document', title: 'New' });
    await l.cmd('artifacts.duplicate', { artifactId: A1 });
    expect([l.machines.machineOf(A2), l.machines.machineOf(A3)]).toEqual([MINI, MINI]);
  });

  it('say an engine host that took the act and predates `host.artifactOp` in its words', async () => {
    const l = lab();
    l.link.onAct = (act) => {
      act.move('accepted');
      act.settle({ state: 'refused', reason: 'unavailable' });
    };
    expect(await l.cmd('artifacts.update', { artifactId: A1, pinned: true })).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: 'mini’s engine host predates remote artifact edits; it is replaced when idle' } });
    // refused before it was taken (the endpoint's own `unavailable`): the machine's word, as any refusal
    l.link.onAct = (act) => act.settle({ state: 'refused', reason: 'unavailable' });
    expect(await l.cmd('artifacts.update', { artifactId: A1, pinned: true })).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: 'artifacts.update: machine mini is unavailable' } });
  });

  it('refuse locally a copy between machines, an asset or bytes past the channel, and a path on this Mac', async () => {
    const l = lab();
    l.machines.record(A1, MINI);
    l.machines.record(A2, OTHER);
    expect(await l.cmd('artifacts.copyAsset', { from: A2, ref: 'assets/a.png', to: A1 })).toMatchObject({ ok: false, error: { code: 'invalid_input', message: 'an asset can’t be copied between machines yet' } });
    expect(await l.cmd('artifacts.copyAsset', { from: LOCAL_ID, ref: 'assets/a.png', to: A1 })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    const big = new Uint8Array(3 * 1024 * 1024); // 4 MiB as base64
    expect(await l.cmd('artifacts.uploadAsset', { artifactId: A1, name: 'a.png', mime: 'image/png', bytes: big })).toMatchObject({ ok: false, error: { code: 'invalid_input', message: TOO_LARGE_WORDS } });
    expect(await l.cmd('artifacts.create', { kind: 'file', title: 'f', content: { bytes: big } })).toMatchObject({ ok: false, error: { code: 'invalid_input', message: TOO_LARGE_WORDS } });
    expect(await l.cmd('artifacts.create', { kind: 'file', title: 'f', content: { path: '/Users/me/f.pdf' } })).toMatchObject({ ok: false, error: { code: 'internal', issues: { refusal: 'malformed' } } });
    expect(l.link.acts).toEqual([]);
    // both on the act's machine: sent
    l.machines.record(A2, MINI);
    l.link.onAct = (act) => act.settle({ state: 'done', result: { assetId: '55555555-5555-4555-8555-555555555555', ref: 'assets/a.png' } });
    expect(await l.cmd('artifacts.copyAsset', { from: A2, ref: 'assets/a.png', to: A1 })).toMatchObject({ ok: true });
  });
});

describe('session.capabilities', () => {
  const offline = { artifact_screenshot: { available: false, reason: 'mini is offline' }, artifact_export: { available: false, reason: 'mini is offline' }, browser: { available: false, reason: 'mini is offline' } };

  it('is read from the machine, and substituted for one that predates it and while the link is down', async () => {
    const l = lab();
    l.link.answers.set('session.capabilities', () => ({ ok: true, output: { browser: { available: false, reason: 'no tab engine on mini' } } }));
    expect(await l.cmd('session.capabilities', { appSessionId: 'app-1' })).toEqual({ ok: true, value: { browser: { available: false, reason: 'no tab engine on mini' } } });
    l.link.answers.delete('session.capabilities'); // the fake answers `not-offered`, as an endpoint before M5a
    const predates = 'mini predates session capabilities; update it';
    expect(await l.cmd('session.capabilities', { appSessionId: 'app-1' })).toEqual({ ok: true, value: { artifact_screenshot: { available: false, reason: predates }, artifact_export: { available: false, reason: predates }, browser: { available: false, reason: predates } } });
    l.link.set('down');
    expect(await l.cmd('session.capabilities', { appSessionId: 'app-1' })).toEqual({ ok: true, value: offline });
    l.link.set('up');
    l.link.answers.set('session.capabilities', () => (l.link.set('down'), { ok: false, error: { code: 'offline' } })); // down while asked
    expect(await l.cmd('session.capabilities', { appSessionId: 'app-1' })).toEqual({ ok: true, value: offline });
  });
});

describe('the machine’s artifacts feed', () => {
  it('says each change from the machine, and re-reads after a lost feed: an omission, a reopening or an end', async () => {
    const l = lab();
    l.roster();
    await flush();
    const feed = () => l.link.open().find((s) => s.request.feed === 'artifacts')!;
    expect(feed().request).toEqual({ feed: 'artifacts' });
    feed().sink.subbed('snapshot', { epoch: 'artifacts:boot1', seq: 0 });
    feed().sink.event({ epoch: 'artifacts:boot1', seq: 1 }, { name: 'artifacts.changed', payload: { artifactId: A1, kind: 'document', revision: 4, change: 'updated' } });
    feed().sink.event({ epoch: 'artifacts:boot1', seq: 2 }, { name: 'library.changed', payload: { revision: 9 } });
    // the UX wave, U9 (M5): the machine's settled word, said at the roster's `up` (./remote.ts), is no artifact's
    expect(l.emitted.filter((e) => e.name !== 'remote.settled').map((e) => [e.machine, e.name])).toEqual([
      [MINI, 'artifacts.resync'], // every opening: what changed before it reached no one
      [MINI, 'artifacts.changed'],
      [MINI, 'library.changed'],
    ]);
    expect(l.machines.machineOf(A1)).toBe(MINI);

    // an event too large to carry: lost, the feed opened again, and its reopening a re-read
    const first = feed();
    first.sink.event({ epoch: 'artifacts:boot1', seq: 3 }, { omitted: 'too-large', bytes: 5_000_000 });
    expect(first.closed).toBe(true);
    await flush();
    feed().sink.subbed('snapshot', { epoch: 'artifacts:boot1', seq: 3 });
    expect(l.of('artifacts.resync').map((e) => e.machine)).toEqual([MINI, MINI]);

    // a new channel's opening (a new epoch: the endpoint restarted) and an end `behind`: each a re-read
    feed().sink.subbed('snapshot', { epoch: 'artifacts:boot2', seq: 0 });
    feed().sink.ended('behind');
    await new Promise((resolve) => setTimeout(resolve, 30));
    feed().sink.subbed('snapshot', { epoch: 'artifacts:boot2', seq: 1 });
    expect(l.of('artifacts.resync')).toHaveLength(4);
  });

  it('is asked of no peer without `rl2.artifacts`', async () => {
    const l = lab();
    l.link.peers = ['rl2.executor.machine', 'rl2.feeds'];
    l.roster();
    await flush();
    expect(l.link.subs.filter((s) => s.request.feed === 'artifacts')).toEqual([]);
  });
});

describe('remote.openCopy', () => {
  const sha = (source: unknown) => createHash('sha256').update(JSON.stringify(source)).digest('hex');
  const pageOf = (bytes: Buffer, offset: number, length: number) => {
    const chunk = bytes.subarray(offset, offset + length);
    return { ok: true as const, output: { encoding: 'base64', content: chunk.toString('base64'), bytes: bytes.length, offset, length: chunk.length, truncated: offset + chunk.length < bytes.length, mime: 'application/pdf', hash: null, utf8: null } };
  };

  it('pages a checkout file into the temporary directory and opens it', async () => {
    const l = lab();
    const file = Buffer.from(Array.from({ length: 12 * 1024 * 1024 }, (_, i) => i % 251)); // past one call's 8 MiB
    l.link.answers.set('files.read', (input) => pageOf(file, Number(input.offset ?? 0), Math.min(Number(input.length ?? 1024 * 1024), 3 * 1024 * 1024)));
    const source = { appSessionId: 'app-1', path: '/work/m8/docs/report.pdf' };
    expect(await l.adapter.artifacts.openCopy({ machine: MINI, source: source as never })).toEqual({ ok: true, value: { opened: true, message: null } });
    const copy = join(l.temp, 'maws-remote-copies', MINI, sha(source), 'report.pdf');
    expect(l.opened).toEqual([copy]);
    expect(readFileSync(copy).equals(file)).toBe(true);
    expect(statSync(copy).mode & 0o111).toBe(0);
  });

  it('pages a library file and an export, named as Save As names them', async () => {
    const l = lab();
    const stored = Buffer.from('a stored docx');
    const exported = Buffer.from('%PDF-1.7 an export');
    l.link.answers.set('library.content', () => ({ ok: true, output: { revision: 3, kind: 'file', name: 'brief.docx', path: '/m/brief.docx' } }));
    l.link.answers.set('artifacts.get', () => ({ ok: true, output: { artifact: row(A1, { title: 'Q3 plan' }) } }));
    l.link.answers.set('library.read', (input) => pageOf(input.export === undefined ? stored : exported, Number(input.offset ?? 0), Number(input.length ?? 1024 * 1024)));
    const file = { artifactId: A1, revision: 3 };
    const pdf = { artifactId: A1, export: { revision: 3, format: 'pdf' } };
    expect(await l.adapter.artifacts.openCopy({ machine: MINI, source: file })).toMatchObject({ ok: true, value: { opened: true } });
    expect(await l.adapter.artifacts.openCopy({ machine: MINI, source: pdf as never })).toMatchObject({ ok: true, value: { opened: true } });
    expect(l.opened).toEqual([join(l.temp, 'maws-remote-copies', MINI, sha(file), 'brief.docx'), join(l.temp, 'maws-remote-copies', MINI, sha(pdf), 'Q3 plan.pdf')]);
    expect(readFileSync(l.opened[0]!).equals(stored)).toBe(true);
    expect(readFileSync(l.opened[1]!).equals(exported)).toBe(true);
    expect(l.link.calls.filter((c) => c.name === 'library.read').map((c) => c.input)).toContainEqual(expect.objectContaining({ artifactId: A1, export: { revision: 3, format: 'pdf' } }));
  });

  it('refuses a file past the bound before reading it whole, and a kind MAWS doesn’t open outside', async () => {
    const l = lab();
    l.link.answers.set('files.read', (input) => ({ ...pageOf(Buffer.alloc(16), Number(input.offset ?? 0), 16), output: { ...pageOf(Buffer.alloc(16), 0, 16).output, bytes: REMOTE_COPY_MAX_BYTES + 1, truncated: true } }));
    expect(await l.adapter.artifacts.openCopy({ machine: MINI, source: { appSessionId: 'app-1', path: '/work/big.pdf' } as never })).toEqual({ ok: true, value: { opened: false, message: 'too large to copy from mini' } });
    expect(l.link.calls.filter((c) => c.name === 'files.read')).toHaveLength(1);
    expect(await l.adapter.artifacts.openCopy({ machine: MINI, source: { appSessionId: 'app-1', path: '/work/run.sh' } as never })).toEqual({ ok: true, value: { opened: false, message: 'Not opened outside MAWS: run.sh' } });
    expect(l.opened).toEqual([]);
  });

  it('writes the copy’s path to the e2e open log in place of the OS', async () => {
    const log = join(scratch('maws-open-log-'), 'open.log');
    const l = lab({ env: { MAWS_E2E: '1', MAWS_E2E_OPEN_LOG: log } });
    l.link.answers.set('files.read', (input) => pageOf(Buffer.from('hello'), Number(input.offset ?? 0), 5));
    expect(await l.adapter.artifacts.openCopy({ machine: MINI, source: { appSessionId: 'app-1', path: '/work/notes.txt' } as never })).toMatchObject({ ok: true, value: { opened: true } });
    expect(readFileSync(log, 'utf8')).toMatch(/maws-remote-copies\/.+\/notes\.txt\n$/);
    expect(l.opened).toEqual([]);
  });
});

describe('Save As of a remote artifact', () => {
  it('pages the export over the link into a temporary file and saves it through the port, as locally', async () => {
    const l = lab();
    const exported = Buffer.from('%PDF-1.7 remote');
    l.link.answers.set('artifacts.get', () => ({ ok: true, output: { artifact: row(A1, { title: 'Q3 plan' }) } }));
    l.link.answers.set('library.read', (input) => {
      const offset = Number(input.offset ?? 0);
      const chunk = exported.subarray(offset);
      return { ok: true, output: { encoding: 'base64', content: chunk.toString('base64'), bytes: exported.length, offset, length: chunk.length, truncated: false, mime: 'application/pdf', hash: null, utf8: null } };
    });
    const saves = scratch('maws-save-');
    const files = createLibraryFiles({
      call: async () => {
        throw new Error('nothing of this Mac’s store is read for a remote artifact');
      },
      exporters: { get: () => undefined },
      root: scratch('maws-root-'),
      downloads: () => saves,
      port: { save: async (_client, { defaultPath }) => ({ path: defaultPath }), confirm: async () => ({ confirmed: true }) },
      env: {},
      local: LOCAL,
      remote: (machine) => l.adapter.artifacts.files(machine),
    });
    expect(await files.saveAs({ artifactId: A1, source: { export: { revision: 3, format: 'pdf' } } }, null, MINI)).toEqual({ saved: true, path: join(saves, 'Q3 plan.pdf') });
    expect(readFileSync(join(saves, 'Q3 plan.pdf')).equals(exported)).toBe(true);
  });
});
