// M5a's offer rows (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, §L's M5a rows and M5 "What
// crosses, as what"; Constraints: "the offer table is the only door, and each row is tested"). An artifact's reads cross as
// calls and its writes as engine-host acts with no session, each under the `artifact` rule: admitted for a member who
// holds the grade on the artifact (B, who owns the session it is linked to), refused `grade` for one who doesn't, before
// anything runs. A write goes to the engine host's ledger as `host.artifactOp`, claimed once, its claim naming the
// artifact; an engine host built before that command answers it as a name outside its registry, read as `refused
// unavailable`. Bytes cross in json-bytes' tagged form for a device that listed `rl2.bytes`, and never for one that didn't.
// The library's listing is cut per row to the artifacts the member views, every row for a machine owner.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Action } from 'org-protocol';
import { fromWire, toWire } from '@shared/host/json-bytes';
import type { CommandName } from '@shared/ipc/schema';
import { ARTIFACT_OP_COMMANDS } from '@shared/ipc/schema/host';
import { validateCommandInput } from '@shared/ipc/validate';
import { OFFERS } from '../../src/endpoint/offers';
import type { SessionRecord } from '../../src/endpoint/sources';
import { createFilesService } from '../../src/services/files/service';
import { registerLibraryReads } from '../../src/services/library/files';
import { act, done, evs, makeOrg, openRemote, startEndpoint, stopAll, until, waitFor, type Fixture, type HostSession, type Msg, type Org, type Remote } from './sub-harness';

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

  // P5 O7 M5a1 fix wave 1: the engine host's `host.artifactOp` runs ARTIFACT_OP_COMMANDS and refuses anything else, so an
  // act row the endpoint offers by the artifact rule is exactly one of them
  it('offer as artifact acts exactly the commands host.artifactOp runs', () => {
    // P5 O7 M5c: the machine's artifact acts (a lease's tool calls, Send to) go to `machine.op`, not the engine host's ledger
    const acts = Object.entries(OFFERS.commands).filter(([, row]) => row.target === 'artifact' && row.kind === 'act' && row.executor === 'engine-host').map(([name]) => name);
    expect(new Set(acts)).toEqual(new Set(ARTIFACT_OP_COMMANDS));
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

  it('answers a member the rows of the artifacts they view, with their counts, and a machine owner every row', async () => {
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
    // The owner: every row, and the machine's counts (what each row says of sessions is projected: artifact-projection.test.ts).
    const whole = await call(a, 'library.list', { filter: { kind: 'html' } });
    expect(ids(whole)).toEqual([sharedDoc, orphan]);
    expect((whole.output as { counts: unknown }).counts).toEqual({ document: 3, html: 2 });
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

// P5 O7 M5c (§L's M5c rows; M5 "O4's surfaces: the grade", "leases, the window, delivery on the machine"; Proves, M5c):
// a page's lease on the `artifact` rule at `view`, its tool calls at `converse` by effect; Send to's reads at `view`, a
// send and its cancel at `manage`; the owner's connector management at `machine-admin`, a step-up each. A lease is named
// by its id after its open, placed by the channel's own table, re-authorized while it lives and closed by the endpoint once
// its member can no longer view its artifact. The window report is the endpoint's own call, under the channel's ref.
describe('M5c’s rows', () => {
  const LEASE_CALLS = ['connectors.open', 'connectors.declare', 'connectors.watch', 'connectors.unwatch', 'connectors.visibility', 'connectors.close'];
  const ADMIN = ['connectors.servers', 'connectors.connect', 'connectors.reconnect', 'connectors.disconnect', 'connectors.signIn', 'connectors.signInCancel', 'artifacts.grantConnectorTool', 'artifacts.revokeConnectorTool'];

  /** The machine's connectors and delivery as the spine answers them, each request kept with the asker's ref. */
  function machineServices(f: Fixture) {
    const asked: Array<{ name: string; input: Record<string, unknown>; client: unknown }> = [];
    const answer = (name: string, value: (input: Record<string, unknown>) => unknown) =>
      f.spine.handle(name, (input, context) => {
        asked.push({ name, input: input as Record<string, unknown>, client: context.client });
        return value(input as Record<string, unknown>);
      });
    answer('connectors.open', () => ({ leaseId: randomUUID() }));
    answer('connectors.declare', () => ({ ok: true, declared: [] }));
    answer('connectors.watch', () => ({ ok: true, watchId: randomUUID(), intervalMs: 60_000 }));
    answer('connectors.unwatch', () => ({ stopped: true }));
    answer('connectors.visibility', () => ({ ok: true }));
    answer('connectors.close', () => ({ closed: true }));
    answer('connectors.call', () => ({ ok: true, result: { rows: [1] }, fetchedAt: 1, via: { route: 'engine', sessionId: 'app-private' } }));
    answer('connectors.refresh', () => ({ refreshing: true }));
    answer('connectors.windowShown', () => ({ ok: true }));
    answer('connectors.servers', () => ({ servers: [], saved: 'ok', withdrawnUnattributed: false }));
    answer('delivery.status', () => ({ target: 'drive', state: 'ready' }));
    answer('delivery.send', () => ({ ok: false, why: 'cancelled' }));
    answer('delivery.cancel', () => ({ cancelled: true }));
    return asked;
  }

  /** The machine's sends held until `finish`, so a run is live while a test acts on its id. */
  function holdSends(f: Fixture): { finish(): void } {
    let finish!: () => void;
    const running = new Promise<void>((resolve) => (finish = resolve));
    f.spine.handle('delivery.send', async () => {
      await running;
      return { ok: false, why: 'cancelled' };
    });
    return { finish: () => finish() };
  }

  /** A shares `app-shared` (and its artifact `shared`) with B at `grade`; B owns `app-b` and `held`; `other` is the owners'. */
  async function scene(grade: 'view' | 'converse' = 'view') {
    const { f, held, other, a, b } = await setup();
    const shared = randomUUID();
    session(f, 'app-shared', ['@machine'], { shares: [{ member: org.B, grade }] });
    f.host.artifact(shared, ['app-shared']);
    return { f, held, other, shared, a, b, asked: machineServices(f) };
  }

  async function open(r: Remote, artifactId: string): Promise<string> {
    const opened = await call(r, 'connectors.open', { artifactId });
    expect(opened).toMatchObject({ ok: true });
    return (opened.output as { leaseId: string }).leaseId;
  }

  it('are offered, each as its kind, executor and target, and Discover’s catalog, Drive’s sign-in and main’s own are not', async () => {
    for (const name of [...LEASE_CALLS, 'delivery.status']) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'call', executor: 'machine', target: 'artifact' }]);
    for (const name of ['connectors.call', 'connectors.refresh', 'delivery.send', 'delivery.cancel']) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'act', executor: 'machine', target: 'artifact' }]);
    for (const name of ADMIN) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'act', executor: 'machine', target: 'machine' }]);
    expect(OFFERS.commands['delivery.receipts']).toEqual({ kind: 'call', executor: 'machine', target: 'machine', grade: 'list' });
    expect(OFFERS.commands['connectors.callback']).toEqual({ kind: 'call', executor: 'machine', target: 'machine' });
    expect(OFFERS.commands['client.windowShown']).toMatchObject({ kind: 'call', executor: 'endpoint', target: 'machine', grade: 'list' });
    for (const name of ['catalog.engine', 'catalog.engineRefresh', 'delivery.connect', 'delivery.deliver', 'connectors.windowShown', 'connectors.adoptGrant', 'connectors.add', 'connectors.remove']) expect([name, OFFERS.commands[name]]).toEqual([name, undefined]);
    const { a } = await scene();
    expect(codeOf(await call(a, 'catalog.engine', { cwd: null }))).toBe('not-offered');
    expect(codeOf(await call(a, 'catalog.engineRefresh', {}))).toBe('not-offered');
  });

  it('take each lease command at its floor: a `view` holder opens and uses a lease, and is refused its tool calls (`converse` by effect)', async () => {
    const { f, shared, other, b, asked } = await scene('view');
    expect(codeOf(await call(b, 'connectors.open', { artifactId: other }))).toBe('grade');
    expect(asked.some((x) => x.name === 'connectors.open')).toBe(false);
    const leaseId = await open(b, shared);
    const watchId = randomUUID();
    for (const [name, input] of [
      ['connectors.declare', { leaseId, tools: [] }],
      ['connectors.watch', { leaseId, request: { server: 's', tool: 't', intervalMs: 60_000 } }],
      ['connectors.visibility', { leaseId, visible: true }],
      ['connectors.unwatch', { leaseId, watchId }],
    ] as const)
      expect([name, codeOf(await call(b, name, input))]).toEqual([name, 'ok']);
    // the tool calls are acts, at `converse`, which a `view` holder doesn't hold
    expect(codeOf(await call(b, 'connectors.call', { leaseId, request: {} }))).toBe('act-required');
    expect(await act(b, actOf(f, b, 'connectors.call', { leaseId, request: { server: 's', tool: 't' } }))).toBe('grade');
    expect(await act(b, actOf(f, b, 'connectors.refresh', { leaseId, watchId }))).toBe('grade');
    expect(f.spine.claimed.some((c) => c.name === 'connectors.call')).toBe(false);
    // a lease the channel doesn't hold is nobody's to name: `grade`, as for an unknown artifact
    expect(codeOf(await call(b, 'connectors.declare', { leaseId: randomUUID(), tools: [] }))).toBe('grade');
    expect(codeOf(await call(b, 'connectors.close', { leaseId }))).toBe('ok');
    expect(codeOf(await call(b, 'connectors.visibility', { leaseId, visible: false }))).toBe('grade'); // closed: no longer held
    // every lease command reached the machine under the channel's one ref
    expect(new Set(asked.map((x) => x.client)).size).toBe(1);
  });

  it('run a `converse` holder’s tool call once under `machine.op`, claimed on the artifact, with no step-up and the call’s session left out', async () => {
    const { f, shared, b } = await scene('converse');
    const leaseId = await open(b, shared);
    const called = actOf(f, b, 'connectors.call', { leaseId, request: { server: 's', tool: 't' } });
    const from = b.inbox.length;
    expect(await act(b, called)).toBe('ok');
    const outcome = (await done(b, called, from)) as { state: string; result: { via: Record<string, unknown> } };
    expect(outcome).toMatchObject({ state: 'done', result: { ok: true, result: { rows: [1] }, via: { route: 'engine' } } });
    expect(outcome.result.via).not.toHaveProperty('sessionId');
    expect(f.spine.claimed.filter((c) => c.name === 'connectors.call')).toHaveLength(1);
    expect(f.spine.claimed.find((c) => c.name === 'connectors.call')?.op).toMatchObject({ member: org.B, device: org.b1.device.id });
    // the claim names the artifact the endpoint placed the lease on, so a query re-places it through the rule
    const ledger = readFileSync(join(f.services.machine.stateDir, 'spine-ops.jsonl'), 'utf8');
    expect(ledger).toContain(`"target":"artifact:${shared}"`);
    const queried = await (async () => {
      const at = b.inbox.length;
      await b.channel.send({ t: 'query', opId: called.opId, opCreated: called.opCreated, executor: 'machine' });
      return waitFor(b, (m) => m.t === 'queried' && m.opId === called.opId, 'the query', at);
    })();
    expect(queried).toMatchObject({ state: 'done' });
    expect(JSON.stringify(queried)).not.toContain('app-private');
  });

  it('close a lease itself when the last qualifying share is withdrawn while a watch runs and an update is in flight: the update is not forwarded, the next call refused `grade`', async () => {
    const { f, shared, b, asked } = await scene('converse');
    const sub = 'art';
    await b.channel.send({ t: 'sub', sub, feed: 'artifacts', cursor: null, credit: 4 * 1024 * 1024 });
    await waitFor(b, (m) => m.sub === sub && m.t === 'subbed', 'the artifacts feed');
    const leaseId = await open(b, shared);
    const watch = await call(b, 'connectors.watch', { leaseId, request: { server: 's', tool: 't', intervalMs: 60_000 } });
    const watchId = (watch.output as { watchId: string }).watchId;
    const update = (rows: number[]) => ({ leaseId, watchId, update: { ok: true, result: { rows }, fetchedAt: 2, via: { route: 'engine', sessionId: 'app-private' } } });
    f.host.emitMachine('connectors.watchUpdate', update([1]));
    await until(() => evs(b, sub).length === 1, 'the first update forwarded');
    expect(evs(b, sub)[0].body).toEqual({ name: 'connectors.watchUpdate', payload: { leaseId, watchId, update: { ok: true, result: { rows: [1] }, fetchedAt: 2, via: { route: 'engine' } } } });
    // another channel's lease update never reaches B
    f.host.emitMachine('connectors.watchUpdate', { ...update([9]), leaseId: randomUUID() });
    // the share withdrawn, and the machine's next refresh published before it heard anything of it
    f.records.set({ lane: 'B', session: 'eng-app-shared', owners: ['@machine'], access: 'private' }, 'app-shared');
    f.host.emitMachine('connectors.watchUpdate', update([2]));
    const closed = await until(() => asked.find((x) => x.name === 'connectors.close' && x.input.leaseId === leaseId), 'the endpoint’s close of the lease');
    expect(closed.client).toBe(asked.find((x) => x.name === 'connectors.open')?.client); // under the channel's ref
    expect(f.services.lines.some((line) => line.includes(`lease ${leaseId} on artifact ${shared} closed by the endpoint: grade`))).toBe(true);
    expect(await act(b, actOf(f, b, 'connectors.call', { leaseId, request: { server: 's', tool: 't' } }))).toBe('grade');
    f.host.emitMachine('connectors.watchUpdate', update([3]));
    f.host.emitMachine('library.changed', { revision: 7 }); // what the feed still carries, after anything it would have sent
    await until(() => evs(b, sub).some((e) => (e.body as { name: string }).name === 'library.changed'), 'the library change');
    expect(evs(b, sub).filter((e) => (e.body as { name: string }).name === 'connectors.watchUpdate')).toHaveLength(1);
  });

  it('grade Send to on the artifact: its status at `view`, a send and its cancel at `manage` with no step-up, a cancel by the run its channel sent', async () => {
    const { f, held, shared, b, asked } = await scene('view');
    expect(codeOf(await call(b, 'delivery.status', { target: 'drive', artifactId: shared }))).toBe('ok');
    const send = (artifactId: string, runId = randomUUID()) => ({ runId, target: 'drive', artifactId, format: 'pdf', destination: { kind: 'default' } });
    expect(validateCommandInput('delivery.send', send(held)).ok).toBe(true);
    expect(await act(b, actOf(f, b, 'delivery.send', send(shared)))).toBe('grade'); // `view` only
    const delivering = holdSends(f);
    const runId = randomUUID();
    const sent = actOf(f, b, 'delivery.send', send(held, runId));
    const from = b.inbox.length;
    expect(await act(b, sent)).toBe('ok'); // B owns `app-b`: `manage`, which never steps up
    await until(() => f.spine.claimed.find((c) => c.name === 'delivery.send'), 'the send run');
    expect(await act(b, actOf(f, b, 'delivery.cancel', { runId }))).toBe('ok'); // while it runs
    await until(() => asked.some((x) => x.name === 'delivery.cancel'), 'the cancel run');
    expect(await act(b, actOf(f, b, 'delivery.cancel', { runId: randomUUID() }))).toBe('no-target'); // a run this channel never sent
    delivering.finish();
    await done(b, sent, from);
    expect(await act(b, actOf(f, b, 'delivery.cancel', { runId }))).toBe('no-target'); // the run ended with its send's answer
  });

  // P5 O7 M5c1 fix wave 1: the machine's runs are one namespace, by id (a second send of a running id answers `busy`, a
  // cancel ends whichever run holds it), so the endpoint reserves an id for one channel and one artifact while it runs
  it('reserve a run’s id for the one channel and artifact that sent it, while it runs: another send of it is `busy`, a cancel of it someone else’s', async () => {
    const { f, held, other, a, b } = await scene('view');
    session(f, 'app-b2', [org.B]);
    const held2 = randomUUID();
    f.host.artifact(held2, ['app-b2']);
    const delivering = holdSends(f);
    const send = (artifactId: string, runId: string) => ({ runId, target: 'drive', artifactId, format: 'pdf', destination: { kind: 'default' } });
    const runId = randomUUID();
    const sent = actOf(f, b, 'delivery.send', send(held, runId));
    const from = b.inbox.length;
    expect(await act(b, sent)).toBe('ok');
    await until(() => f.spine.claimed.find((c) => c.name === 'delivery.send'), 'the send run');
    // across artifacts: B loses `manage` on `held`, sends the same id on `held2` (which B owns), and can't move the run there
    f.records.set({ lane: 'B', session: 'eng-app-b', owners: ['@machine'], access: 'private' }, 'app-b');
    expect(await act(b, actOf(f, b, 'delivery.send', send(held2, runId)))).toBe('busy');
    expect(await act(b, actOf(f, b, 'delivery.cancel', { runId }))).toBe('grade'); // decided on `held`, the run's own
    // across channels: a machine owner's send of the id is `busy`, and its cancel names no run of its channel's
    expect(await act(a, actOf(f, a, 'delivery.send', send(other, runId)))).toBe('busy');
    expect(await act(a, actOf(f, a, 'delivery.cancel', { runId }))).toBe('no-target');
    const b2 = await openRemote(f, org.b1, org.B);
    expect(await act(b2, actOf(f, b2, 'delivery.cancel', { runId }))).toBe('no-target');
    expect(f.spine.claimed.filter((c) => c.name === 'delivery.send')).toHaveLength(1);
    expect(f.spine.claimed.some((c) => c.name === 'delivery.cancel')).toBe(false);
    // the run's end frees its id
    delivering.finish();
    await done(b, sent, from);
    const again = actOf(f, a, 'delivery.send', send(other, runId));
    const at = a.inbox.length;
    expect(await act(a, again)).toBe('ok');
    await done(a, again, at);
    // a send refused before it ran reserves nothing
    const refused = randomUUID();
    expect(await act(b, actOf(f, b, 'delivery.send', send(other, refused)))).toBe('grade');
    const next = actOf(f, a, 'delivery.send', send(other, refused));
    const at2 = a.inbox.length;
    expect(await act(a, next)).toBe('ok');
    await done(a, next, at2);
  });

  it('keep the owner’s connector management at `machine-admin`, a step-up each; refuse it to a member without the right', async () => {
    const { f, held, a, b } = await scene();
    const servers = { artifactId: held, tools: [] };
    expect(await act(b, await b.device.stepUp(actOf(f, b, 'connectors.servers', servers)))).toBe('grade');
    expect(await act(a, actOf(f, a, 'connectors.servers', servers))).toBe('step-up');
    const stepped = await a.device.stepUp(actOf(f, a, 'connectors.servers', servers));
    const from = a.inbox.length;
    expect(await act(a, stepped)).toBe('ok');
    expect(await done(a, stepped, from)).toMatchObject({ state: 'done', result: { saved: 'ok' } });
  });

  it('answer `client.windowShown` by the machine’s window report under the channel’s ref, and refuse it out of shape', async () => {
    const { shared, b, asked } = await scene();
    await open(b, shared);
    expect(await call(b, 'client.windowShown', { shown: true })).toMatchObject({ ok: true, output: { ok: true } });
    const report = asked.find((x) => x.name === 'connectors.windowShown');
    expect(report?.input).toEqual({ shown: true });
    expect(report?.client).toBe(asked.find((x) => x.name === 'connectors.open')?.client);
    expect(codeOf(await call(b, 'client.windowShown', { shown: 'yes' }))).toBe('malformed');
    expect(codeOf(await call(b, 'client.windowShown', { shown: true, page: 1 }))).toBe('malformed');
  });

  it('cut `delivery.receipts` to the artifacts the member views, every one for a machine owner', async () => {
    const { f, held, other, shared, a, b } = await scene('view');
    const receipt = (artifactId: string) => ({ artifactId, target: 'drive', at: 1, name: 'Report', url: null, format: 'pdf', revision: 1, destination: { kind: 'default' } });
    f.spine.handle('delivery.receipts', () => ({ receipts: [receipt(held), receipt(other), receipt(shared)] }));
    const ids = (m: Msg) => (m.output as { receipts: Array<{ artifactId: string }> }).receipts.map((r) => r.artifactId);
    expect(ids(await call(b, 'delivery.receipts', null))).toEqual([held, shared]);
    expect(ids(await call(a, 'delivery.receipts', null))).toEqual([held, other, shared]);
  });

  it('carry on the `artifacts` feed a receipt to a member who views its artifact, and the owner’s sheet’s events to `machine-admin` alone', async () => {
    const { f, held, other, a, b } = await scene();
    for (const r of [a, b]) {
      await r.channel.send({ t: 'sub', sub: 'art', feed: 'artifacts', cursor: null, credit: 4 * 1024 * 1024 });
      await waitFor(r, (m) => m.sub === 'art' && m.t === 'subbed', 'the artifacts feed');
    }
    const receipt = (artifactId: string) => ({ artifactId, target: 'drive', at: 1, name: 'Report', url: null, format: 'pdf', revision: 1, destination: { kind: 'default' } });
    f.host.emitMachine('delivery.receipt', receipt(other));
    f.host.emitMachine('delivery.receipt', receipt(held));
    f.host.emitMachine('connectors.serversChanged', { artifactId: held });
    f.host.emitMachine('connectors.signInChanged', { opId: 'op-1', name: 'notes', state: 'done', reason: null, message: null, where: 'here' });
    f.host.emitMachine('library.changed', { revision: 2 });
    const names = (r: Remote) => evs(r, 'art').map((e) => e.body as { name: string; payload: { artifactId?: string } });
    await until(() => names(a).length === 5 && names(b).some((e) => e.name === 'library.changed'), 'every event heard');
    expect(names(b)).toEqual([{ name: 'delivery.receipt', payload: receipt(held) }, { name: 'library.changed', payload: { revision: 2 } }]);
    expect(names(a).map((e) => e.name)).toEqual(['delivery.receipt', 'delivery.receipt', 'connectors.serversChanged', 'connectors.signInChanged', 'library.changed']);
  });

  // the device ends a Connect's callback listener on its action's end, said with the row's handle
  it('carry an owner action’s end on the `artifacts` feed whole, its `ended` handle with it, to `machine-admin` alone', async () => {
    const { f, held, a, b } = await scene();
    for (const r of [a, b]) {
      await r.channel.send({ t: 'sub', sub: 'art', feed: 'artifacts', cursor: null, credit: 4 * 1024 * 1024 });
      await waitFor(r, (m) => m.sub === 'art' && m.t === 'subbed', 'the artifacts feed');
    }
    const ended = { artifactId: held, ended: { sourceHandle: '99999999-9999-4999-8999-999999999999' } };
    f.host.emitMachine('connectors.serversChanged', ended);
    f.host.emitMachine('library.changed', { revision: 2 });
    const heard = (r: Remote) => evs(r, 'art').map((e) => e.body as { name: string; payload: unknown });
    await until(() => heard(a).length === 2 && heard(b).length === 1, 'every event heard');
    expect(heard(a)).toEqual([{ name: 'connectors.serversChanged', payload: ended }, { name: 'library.changed', payload: { revision: 2 } }]);
    expect(heard(b)).toEqual([{ name: 'library.changed', payload: { revision: 2 } }]);
  });
});
