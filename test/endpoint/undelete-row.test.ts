// The undelete the UX wave offers another machine (U10b, M4; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md
// §C.3, "Routes"): `artifacts.undelete`, an engine-host act on the `artifact` target that the machine's owners alone may
// make, behind the capability `rl2.artifact-undelete`. Through the real gate, for each refusal the row can give: a member
// who does not own the machine is refused `owners-only` (whatever grade they hold on the artifact), an extra key
// `malformed`, and the store's own refusal (an artifact no agent's delete removed) comes back as the act's result; an
// owner's runs once through `host.artifactOp`. And `artifacts.get`'s answer for a deleted artifact (its `deleted`)
// reaches an owner only: nobody else can be placed on a deleted artifact.
//
// The org (sub-harness.ts): A owns the machine `mini`; B is a member.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import { ENDPOINT_CAPABILITIES } from '../../src/endpoint/capabilities';
import { OFFERS } from '../../src/endpoint/offers';
import { act, done, makeOrg, openRemote, startEndpoint, stopAll, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

const ran = (f: Fixture) => f.host.calls.filter((c) => c.name === 'host.artifactOp' && (c.input as { name?: string }).name === 'artifacts.undelete');
async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}

/** B owns `app-b` and its artifact `held` (so holds `manage` on it); A owns the machine. */
async function setup() {
  const f = await startEndpoint(org, started);
  const s = f.host.add('app-b');
  f.spine.set('app-b', s.engineSessionId, { appId: 'app-b' });
  f.records.set({ lane: 'B', session: s.engineSessionId!, owners: [org.B], access: 'private' }, 'app-b');
  const held = randomUUID();
  f.host.artifact(held, ['app-b']);
  f.host.handlers.set('artifacts.undelete', () => undefined);
  return { f, held, a: await openRemote(f, org.a1, org.A), b: await openRemote(f, org.b1, org.B) };
}

describe('artifacts.undelete over the link', () => {
  it('is an act on the artifact, the machine’s owners’, the one row this landing adds, behind its own capability', () => {
    expect(OFFERS.commands['artifacts.undelete']).toEqual({ kind: 'act', executor: 'engine-host', target: 'artifact', owners: true });
    expect(ENDPOINT_CAPABILITIES.at(-1)).toBe('rl2.artifact-undelete');
    // the version restore is unchanged: anyone holding `manage` on the artifact
    expect(OFFERS.commands['artifacts.restore']).toEqual({ kind: 'act', executor: 'engine-host', target: 'artifact' });
  });

  it('refuses a member who does not own the machine `owners-only`, though they hold `manage` on the artifact, and runs nothing', async () => {
    const { f, held, b } = await setup();
    expect(await act(b, b.device.action({ machine: f.ref, action: 'artifacts.undelete', args: { artifactId: held } }))).toBe('owners-only');
    expect(ran(f)).toEqual([]);
    expect(await act(b, b.device.action({ machine: f.ref, action: 'artifacts.update', args: { artifactId: held, title: 'Renamed' } }))).toBe('ok'); // the grade is there
  });

  it('runs an owner’s once through `host.artifactOp`, its claim naming the artifact, which the library no longer lists', async () => {
    const { f, held, a } = await setup();
    f.host.artifacts.delete(held); // deleted: `library.entry` answers no row, as the store does after a soft delete
    const undelete = a.device.action({ machine: f.ref, action: 'artifacts.undelete', args: { artifactId: held } });
    const from = a.inbox.length;
    expect(await act(a, undelete)).toBe('ok');
    expect(await done(a, undelete, from)).toMatchObject({ state: 'done' });
    expect(ran(f).map((c) => c.input)).toEqual([expect.objectContaining({ target: `artifact:${held}`, name: 'artifacts.undelete', input: { artifactId: held } })]);
    expect(f.host.artifactRuns.map((r) => r.name)).toEqual(['artifacts.undelete']);
  });

  it('refuses an extra key `malformed`, and a call in place of the act, running nothing', async () => {
    const { f, held, a } = await setup();
    expect(await act(a, a.device.action({ machine: f.ref, action: 'artifacts.undelete', args: { artifactId: held, versionId: 1 } }))).toBe('malformed');
    const answered = await call(a, 'artifacts.undelete', { artifactId: held });
    expect((answered.error as { code: string }).code).toBe('act-required');
    expect(ran(f)).toEqual([]);
  });

  it('carries the store’s refusal of an artifact no agent’s delete removed back as the act’s result', async () => {
    const { f, held, a } = await setup();
    f.host.handlers.set('artifacts.undelete', () => {
      throw new HostCommandError(ipcError('invalid_input', 'this artifact was deleted in the Library, not by an agent', { reason: 'invalid', data: {} }));
    });
    const undelete = a.device.action({ machine: f.ref, action: 'artifacts.undelete', args: { artifactId: held } });
    const from = a.inbox.length;
    expect(await act(a, undelete)).toBe('ok');
    expect(await done(a, undelete, from)).toMatchObject({ state: 'failed', error: { code: 'invalid_input', message: 'this artifact was deleted in the Library, not by an agent' } });
  });
});

describe('a deleted artifact’s `artifacts.get` over the link', () => {
  it('answers an owner with `deleted`, and refuses a member `grade`: nobody else can be placed on a deleted artifact', async () => {
    const { f, held, a, b } = await setup();
    f.host.artifacts.delete(held); // `library.entry` answers no row, as the store does after a soft delete
    f.host.reads.set('artifacts.get', () => ({ artifact: null, deleted: { title: 'Draft plan', kind: 'document', undoable: true } }));
    expect(await call(a, 'artifacts.get', { artifactId: held })).toMatchObject({ ok: true, output: { artifact: null, deleted: { title: 'Draft plan', kind: 'document', undoable: true } } });
    expect((await call(b, 'artifacts.get', { artifactId: held })).error).toMatchObject({ code: 'grade' });
  });
});
