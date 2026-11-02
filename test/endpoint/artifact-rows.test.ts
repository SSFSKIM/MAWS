// M5a's offer rows (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, §L's M5a rows and M5 "What
// crosses, as what"; Constraints: "the offer table is the only door, and each row is tested"). An artifact's reads cross as
// calls and its writes as engine-host acts with no session, each under the `artifact` rule: admitted for a member who
// holds the grade on the artifact (B, who owns the session it is linked to), refused `grade` for one who doesn't, before
// anything runs. A write goes to the engine host's ledger as `host.artifactOp`, claimed once, its claim naming the
// artifact; an engine host built before that command answers it as a name outside its registry, read as `refused
// unavailable`. Bytes cross in json-bytes' tagged form for a device that listed `rl2.bytes`, and never for one that didn't.
// The library's listing is cut per row to the artifacts the member views, whole for a machine owner.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Action } from 'org-protocol';
import { fromWire, toWire } from '@shared/host/json-bytes';
import type { CommandName } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import { OFFERS } from '../../src/endpoint/offers';
import type { SessionRecord } from '../../src/endpoint/sources';
import { createFilesService } from '../../src/services/files/service';
import { registerLibraryReads } from '../../src/services/library/files';
import { act, done, makeOrg, openRemote, startEndpoint, stopAll, waitFor, type Fixture, type HostSession, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => stopAll(started));

const BYTES = ['rl2.bytes'];
const range = [{ start: { client: 1, clock: 0 }, end: { client: 1, clock: 2 } }];

/** M5a's reads, each keyed by its artifact. */
const CALLS: Record<string, (id: string) => Record<string, unknown>> = {
  'artifacts.get': (artifactId) => ({ artifactId }),
  'artifacts.versions': (artifactId) => ({ artifactId }),
  'artifacts.versionState': (artifactId) => ({ artifactId, versionId: 1 }),
  'artifacts.attributions': (artifactId) => ({ artifactId, fromSeq: 0, toSeq: 1 }),
  'artifacts.readDataset': (artifactId) => ({ artifactId, ref: 'assets/data.csv', format: 'csv' }),
  'artifacts.datasetFiles': (artifactId) => ({ artifactId }),
  'artifacts.markViewed': (artifactId) => ({ artifactId }),
  'artifacts.export': (artifactId) => ({ artifactId, format: 'pdf' }),
  'artifacts.connectorGrants': (artifactId) => ({ artifactId }),
  'library.get': (artifactId) => ({ artifactId }),
  'library.content': (artifactId) => ({ artifactId }),
  'library.read': (artifactId) => ({ artifactId }),
};

/** M5a's writes (`create` names no artifact: the orphan form, below). */
const ACTS: Record<string, (id: string) => Record<string, unknown>> = {
  'artifacts.update': (artifactId) => ({ artifactId, title: 'renamed' }),
  'artifacts.delete': (artifactId) => ({ artifactId }),
  'artifacts.duplicate': (artifactId) => ({ artifactId }),
  'artifacts.saveVersion': (artifactId) => ({ artifactId, label: 'Draft' }),
  'artifacts.nameVersion': (artifactId) => ({ artifactId, versionId: 1, label: 'Final' }),
  'artifacts.restore': (artifactId) => ({ artifactId, versionId: 1 }),
  'artifacts.pruneVersions': (artifactId) => ({ artifactId, olderThan: 0 }),
  'artifacts.acceptSuggestion': (artifactId) => ({ artifactId, ranges: range }),
  'artifacts.rejectSuggestion': (artifactId) => ({ artifactId, ranges: range }),
  'artifacts.uploadAsset': (artifactId) => toWire({ artifactId, name: 'logo.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }) as Record<string, unknown>,
  'artifacts.copyAsset': (artifactId) => ({ from: artifactId, ref: 'assets/a.png', to: artifactId }),
  'artifacts.rereadDatasetFile': (artifactId) => ({ artifactId, id: 'f1', baseRevision: 1 }),
};

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}
const codeOf = (m: Msg) => (m.ok === true ? 'ok' : (m.error as { code: string }).code);
const actOf = (f: Fixture, r: Remote, action: string, args: Record<string, unknown>): Action => r.device.action({ machine: f.ref, action, args });
/** Refusals that say a request never reached its executor. */
const AUTHORIZATION = ['grade', 'not-offered', 'act-required', 'ungraded', 'no-target', 'no-rule', 'malformed', 'class'];
/** Whether a write named `name` was handed to the engine host's ledger. */
const ran = (f: Fixture, name: string) => f.host.calls.some((c) => c.name === 'host.artifactOp' && (c.input as { name?: string }).name === name);
/** Whether a read named `name` reached the machine. */
const read = (f: Fixture, name: string, from: number) => f.host.calls.slice(from).some((c) => c.name === name);

function session(f: Fixture, app: string, owners: string[], fields: Partial<SessionRecord> = {}): HostSession {
  const s = f.host.add(app);
  f.spine.set(app, s.engineSessionId, { appId: app });
  f.records.set({ lane: 'B', session: s.engineSessionId!, owners, access: 'private', ...fields }, app);
  return s;
}

/** B owns `app-b` and its artifact `held`; `app-2` is the machine owners', and so is its artifact `other`. */
async function setup(options: { capabilities?: string[] } = {}) {
  const f = await startEndpoint(org, started);
  session(f, 'app-b', [org.B]);
  session(f, 'app-2', ['@machine']);
  const held = randomUUID();
  const other = randomUUID();
  f.host.artifact(held, ['app-b']);
  f.host.artifact(other, ['app-2']);
  return { f, held, other, a: await openRemote(f, org.a1, org.A, options), b: await openRemote(f, org.b1, org.B, options) };
}

describe('M5a’s rows', () => {
  it('are offered, each as its kind, executor and target', () => {
    const machine = new Set(['artifacts.export', 'artifacts.connectorGrants', 'library.get', 'library.content', 'library.read']);
    for (const name of Object.keys(CALLS)) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'call', executor: machine.has(name) ? 'machine' : 'engine-host', target: 'artifact' }]);
    for (const name of [...Object.keys(ACTS), 'artifacts.create']) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'act', executor: 'engine-host', target: 'artifact' }]);
    expect(OFFERS.commands['artifacts.list']).toEqual({ kind: 'call', executor: 'engine-host', target: 'artifact' });
    expect(OFFERS.commands['library.list']).toEqual({ kind: 'call', executor: 'machine', target: 'each-session', grade: 'list' });
    expect(OFFERS.commands['library.spaces']).toEqual({ kind: 'call', executor: 'machine', target: 'machine', grade: 'list' });
    expect(OFFERS.commands['session.capabilities']).toEqual({ kind: 'call', executor: 'machine', target: 'appSessionId' });
    for (const name of ['artifacts.search', 'artifacts.open', 'library.saveAs', 'library.openExternally', 'library.reveal', 'files.openExternal', 'artifacts.content']) expect([name, OFFERS.commands[name]]).toEqual([name, undefined]);
  });

  it('take inputs the registry’s schemas hold, decoded (so what follows is about the grade alone)', () => {
    const id = randomUUID();
    for (const [name, input] of [...Object.entries(CALLS), ...Object.entries(ACTS)]) expect([name, validateCommandInput(name as CommandName, fromWire(input(id))).ok]).toEqual([name, true]);
  });

  it('admit each read for a member who holds `view` on the artifact, and refuse it, unread, for one who doesn’t', async () => {
    const { f, held, other, b } = await setup();
    for (const [name, input] of Object.entries(CALLS)) {
      let from = f.host.calls.length;
      expect([name, codeOf(await call(b, name, input(other)))]).toEqual([name, 'grade']);
      expect([name, read(f, name, from)]).toEqual([name, false]);
      from = f.host.calls.length;
      const answered = await call(b, name, input(held));
      expect([name, answered.ok === true || !AUTHORIZATION.includes(codeOf(answered))]).toEqual([name, true]);
      expect([name, f.host.calls.slice(from).find((c) => c.name === name)?.owner]).toEqual([name, OFFERS.commands[name].executor]);
    }
  });

  it('admit each write for a member who holds `manage` on the artifact, handed to the ledger, and refuse it, unrun, for one who doesn’t; each refuses a call', async () => {
    const { f, held, other, b } = await setup({ capabilities: BYTES });
    for (const [name, args] of Object.entries(ACTS)) {
      expect([name, await act(b, actOf(f, b, name, args(other)))]).toEqual([name, 'grade']);
      expect([name, ran(f, name)]).toEqual([name, false]);
      const admitted = actOf(f, b, name, args(held));
      const from = b.inbox.length;
      expect([name, await act(b, admitted)]).toEqual([name, 'ok']);
      await waitFor(b, (m) => m.t === 'done' && m.opId === admitted.opId, `the done of ${name}`, from);
      expect([name, ran(f, name)]).toEqual([name, true]);
      expect([name, codeOf(await call(b, name, args(held)))]).toEqual([name, 'act-required']);
    }
  });

  it('admit `create` (the orphan form) for a machine owner alone, its claim naming no artifact yet', async () => {
    const { f, a, b } = await setup();
    f.host.handlers.set('artifacts.create', () => ({ artifact: f.host.artifact(randomUUID()) }));
    const args = { kind: 'document', title: 'Notes' };
    expect(await act(b, actOf(f, b, 'artifacts.create', args))).toBe('grade');
    const create = actOf(f, a, 'artifacts.create', args);
    const from = a.inbox.length;
    expect(await act(a, create)).toBe('ok');
    expect(await done(a, create, from)).toMatchObject({ state: 'done', result: { artifact: { kind: 'document' } } });
    expect(f.host.calls.find((c) => c.name === 'host.artifactOp')?.input).toMatchObject({ target: 'artifact:', name: 'artifacts.create' });
  });

  it('place `artifacts.list` on the session its filter names, and refuse a listing with none `no-target`', async () => {
    const { f, b } = await setup();
    f.host.reads.set('artifacts.list', () => ({ artifacts: [] }));
    expect(codeOf(await call(b, 'artifacts.list', { filter: { appSessionId: 'app-b' } }))).toBe('ok');
    expect(codeOf(await call(b, 'artifacts.list', { filter: { appSessionId: 'app-2' } }))).toBe('grade');
    expect(codeOf(await call(b, 'artifacts.list', { filter: { kind: 'document' } }))).toBe('no-target');
    expect(codeOf(await call(b, 'artifacts.list', {}))).toBe('no-target');
  });

  it('admit `session.capabilities` at `view` on its session, and `library.spaces` at `list` for any member but a web-cards device', async () => {
    const { f, b } = await setup();
    f.spine.handle('session.capabilities', () => ({ browser: { available: false, reason: 'no browser on this machine' } }));
    f.spine.handle('library.spaces', () => ({ spaces: [] }));
    expect(await call(b, 'session.capabilities', { appSessionId: 'app-b' })).toMatchObject({ ok: true, output: { browser: { available: false } } });
    expect(codeOf(await call(b, 'session.capabilities', { appSessionId: 'app-2' }))).toBe('grade');
    expect(await call(b, 'library.spaces', null)).toMatchObject({ ok: true, output: { spaces: [] } });
    const c = await openRemote(f, org.c1, org.C, { passkey: org.passkey });
    expect(codeOf(await call(c, 'library.spaces', null))).toBe('class');
  });
});

describe('an artifact write, an engine-host act with no session', () => {
  it('runs once through `host.artifactOp`, and a reseal answers the stored result', async () => {
    const { f, held, b } = await setup();
    const rename = actOf(f, b, 'artifacts.update', { artifactId: held, title: 'Renamed' });
    let from = b.inbox.length;
    expect(await act(b, rename)).toBe('ok');
    const first = await done(b, rename, from);
    expect(first).toMatchObject({ state: 'done', result: { artifact: { id: held, title: 'Renamed' } } });
    // No status read: the rule placed the artifact; the claim carries no context.
    const op = f.host.calls.find((c) => c.name === 'host.artifactOp');
    expect(op?.input).toEqual({ opId: rename.opId, opCreated: rename.opCreated, member: org.B, device: 'b1', fingerprint: expect.any(String), target: `artifact:${held}`, name: 'artifacts.update', input: { artifactId: held, title: 'Renamed' } });
    const resealed = b.device.reseal(rename);
    from = b.inbox.length;
    expect(await act(b, resealed)).toBe('ok');
    expect(await done(b, resealed, from)).toEqual(first);
    expect(f.host.artifactRuns.map((r) => r.name)).toEqual(['artifacts.update']);
  });

  it('carries an uploadAsset’s bytes tagged through the real schemas, the handler getting the bytes and the ledger keeping JSON', async () => {
    const { f, held, b } = await setup({ capabilities: BYTES });
    f.host.handlers.set('artifacts.uploadAsset', () => ({ assetId: randomUUID(), ref: 'assets/logo.png' }));
    const bytes = new Uint8Array(64 * 1024).map((_, i) => i % 251);
    const args = toWire({ artifactId: held, name: 'logo.png', mime: 'image/png', bytes }) as Record<string, unknown>;
    const upload = actOf(f, b, 'artifacts.uploadAsset', args);
    const from = b.inbox.length;
    expect(await act(b, upload)).toBe('ok');
    expect(await done(b, upload, from)).toMatchObject({ state: 'done', result: { ref: 'assets/logo.png' } });
    const op = f.host.calls.find((c) => c.name === 'host.artifactOp')!.input as { input: unknown };
    expect(validateCommandInput('host.artifactOp', op).ok).toBe(true); // forwarded tagged, a JSON value
    expect(op.input).toEqual(args);
    const given = (f.host.artifactRuns[0].input as { bytes: unknown }).bytes;
    expect(given).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(given as Uint8Array).equals(Buffer.from(bytes))).toBe(true);
    // The ledger's lines are JSON, its claim naming the artifact; nothing in them is a decoded byte.
    const ledger = readFileSync(join(f.services.machine.stateDir, 'host-ops.jsonl'), 'utf8');
    expect(ledger).not.toContain('"0":');
    expect(ledger.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)[0]).toMatchObject({ opId: upload.opId, claim: { target: `artifact:${held}`, name: 'artifacts.uploadAsset' } });
  });

  it('refuses bytes from a device that listed no `rl2.bytes` `malformed` (nothing decodes its args), and runs nothing', async () => {
    const { f, held, b } = await setup();
    const args = toWire({ artifactId: held, name: 'logo.png', mime: 'image/png', bytes: new Uint8Array([1]) }) as Record<string, unknown>;
    expect(await act(b, actOf(f, b, 'artifacts.uploadAsset', args))).toBe('malformed');
    expect(ran(f, 'artifacts.uploadAsset')).toBe(false);
  });

  it('is refused `unavailable` by an engine host built before `host.artifactOp` (its runtime’s own answer), running nothing', async () => {
    const { f, held, b } = await setup();
    f.host.predatesArtifactOp = true;
    const rename = actOf(f, b, 'artifacts.update', { artifactId: held, title: 'Renamed' });
    const from = b.inbox.length;
    expect(await act(b, rename)).toBe('ok');
    expect(await done(b, rename, from)).toEqual({ state: 'refused', reason: 'unavailable' });
    expect(f.host.artifactRuns).toEqual([]);
    expect(f.services.lines.some((line) => line.includes('predates `host.artifactOp`'))).toBe(true);
  });
});

describe('bytes in a read’s answer', () => {
  it('go tagged to a device that listed `rl2.bytes`, as before to one that didn’t', async () => {
    const { f, held, b } = await setup({ capabilities: BYTES });
    const state = new Uint8Array([0, 1, 254, 255]);
    f.host.reads.set('artifacts.versionState', () => ({ bytes: state }));
    expect(await call(b, 'artifacts.versionState', { artifactId: held, versionId: 1 })).toMatchObject({ ok: true, output: { bytes: { $bytes: Buffer.from(state).toString('base64') } } });
    const plain = await openRemote(f, org.b1, org.B);
    expect(await call(plain, 'artifacts.versionState', { artifactId: held, versionId: 1 })).toMatchObject({ ok: true, output: { bytes: { 0: 0, 1: 1, 2: 254, 3: 255 } } });
  });
});

describe('library.list', () => {
  /** A row of the library as the index answers it: its artifact and its linked sessions (`LibraryRowSchema.sessions`). */
  const row = (id: string, kind: string, sessions: string[]) => ({ id, kind, title: id.slice(0, 4), sessions: sessions.map((appSessionId) => ({ appSessionId, title: '', roles: ['created'], lastAt: 1 })) });

  it('answers a member the rows of the artifacts they view, with their counts, and a machine owner every row, unplaced', async () => {
    const { f, a, b } = await setup();
    session(f, 'app-shared', ['@machine'], { shares: [{ member: org.B, grade: 'view' }] });
    const [mine, sharedDoc, both, hidden, orphan] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const rows = [row(mine, 'document', ['app-b']), row(sharedDoc, 'html', ['app-shared']), row(both, 'document', ['app-2', 'app-shared']), row(hidden, 'document', ['app-2']), row(orphan, 'html', [])];
    const asked: unknown[] = [];
    f.spine.handle('library.list', (input) => {
      asked.push(input);
      const kind = (input as { filter?: { kind?: string } }).filter?.kind;
      return { rows: rows.filter((r) => kind === undefined || r.kind === kind), counts: { document: 3, html: 2 } };
    });
    const ids = (m: Msg) => (m.output as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
    const kept = await call(b, 'library.list', {});
    expect(ids(kept)).toEqual([mine, sharedDoc, both]);
    expect((kept.output as { counts: unknown }).counts).toEqual({ document: 2, html: 1 });
    // A kind filter: asked of the machine without it, so the counts are the member's own.
    const documents = await call(b, 'library.list', { filter: { kind: 'document' } });
    expect(ids(documents)).toEqual([mine, both]);
    expect((documents.output as { counts: unknown }).counts).toEqual({ document: 2, html: 1 });
    expect(asked.at(-1)).toEqual({ filter: {} });
    // The owner: whole, as the machine answered, with no placement read.
    const from = f.host.calls.length;
    const whole = await call(a, 'library.list', { filter: { kind: 'html' } });
    expect(ids(whole)).toEqual([sharedDoc, orphan]);
    expect((whole.output as { counts: unknown }).counts).toEqual({ document: 3, html: 2 });
    expect(f.host.calls.slice(from).filter((c) => c.name === 'session.get')).toEqual([]);
    expect(codeOf(await call(b, 'library.list', { filter: { kind: 'exe' } }))).toBe('malformed');
  });

  it('cuts a row by every placement the call saw of its session (a record moved as it went)', async () => {
    const { f, b } = await setup();
    const s = session(f, 'app-shared', ['@machine'], { shares: [{ member: org.B, grade: 'view' }] });
    const doc = randomUUID();
    f.spine.handle('library.list', () => {
      // While the listing is read, the index names a new engine session for the shared session, which B holds nothing on.
      f.records.set({ lane: 'B', session: 'eng-moved', owners: ['@machine'], access: 'private' }, 'app-shared');
      const moved = f.spine.set('app-shared', 'eng-moved', { appId: 'app-shared' });
      f.host.emitMachine('session.changed', { record: { appId: 'app-shared', ...moved } });
      f.spine.set('app-shared', s.engineSessionId, { appId: 'app-shared' }); // and back, before session.get reads it
      return { rows: [row(doc, 'document', ['app-shared'])], counts: { document: 1 } };
    });
    expect((await call(b, 'library.list', {})).output).toMatchObject({ rows: [] });
  });
});

describe('library.read’s export form', () => {
  it('reads an export under the artifact’s directory for a member who views it, and refuses a name outside the grammar or a path elsewhere `malformed`', async () => {
    const { f, held, other, b } = await setup();
    const root = mkdtempSync(join(tmpdir(), 'artifact-rows-'));
    dirs.push(root);
    mkdirSync(join(root, held, 'exports'), { recursive: true });
    writeFileSync(join(root, held, 'exports', '3-pdf.pdf'), '%PDF-1.7');
    mkdirSync(join(root, other, 'exports'), { recursive: true });
    writeFileSync(join(root, other, 'exports', '3-pdf.pdf'), '%PDF-1.7 secret');
    registerLibraryReads(f.spine.bus.register, { hosts: { dispatch: async () => ({ ok: false, error: { code: 'internal', message: 'unused' } }) }, files: createFilesService({ records: () => null, env: {} }), port: { openExternal: async () => false, reveal: async () => undefined } as never, env: {}, artifactsRoot: root });
    expect(await call(b, 'library.read', { artifactId: held, export: { revision: 3, format: 'pdf' } })).toMatchObject({ ok: true, output: { encoding: 'base64', content: Buffer.from('%PDF-1.7').toString('base64') } });
    expect(codeOf(await call(b, 'library.read', { artifactId: other, export: { revision: 3, format: 'pdf' } }))).toBe('grade');
    for (const export_ of [{ revision: 3, format: 'exe' }, { revision: 3, format: 'pdf', exportId: '../../../etc/passwd' }, { revision: 3, format: 'pdf', path: '/etc/passwd' }]) {
      expect([export_, codeOf(await call(b, 'library.read', { artifactId: held, export: export_ }))]).toEqual([export_, 'malformed']);
    }
  });
});
