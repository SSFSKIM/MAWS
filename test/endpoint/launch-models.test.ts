// The model list of a spawn here, for a New chat on another machine (the UX wave, obs 4): `engine.models` from another
// machine names no route, since `session.spawn` names none and its intent starts on the machine's default route. The
// endpoint answers it with the engine host's catalogue for that route, read from the machine's settings as the session
// service seeds an intent (the route beside the legacy field), in the checkout the caller named; a read at `list` behind
// the capability `rl2.engine-models`, which takes no route of the caller's and no refresh (a live session's engine asked).
//
// The org (sub-harness.ts): A owns the machine `mini`; B is a member.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ENDPOINT_CAPABILITIES } from '../../src/endpoint/capabilities';
import { makeOrg, openRemote, startEndpoint, stopAll, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

const CATALOGUE = { models: [{ value: 'opus', displayName: 'Opus 5.5' }], source: 'cached', at: null };

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}
const code = (m: Msg) => (m.ok === true ? 'ok' : (m.error as { code: string }).code);

/** The machine with its default route as `machineSettings.get` answers it, and the engine host's catalogue. */
async function setup(defaults: { legacy: 'gateway' | 'direct'; route?: 'gateway' | 'direct' | 'machine' }) {
  const f = await startEndpoint(org, started);
  f.spine.handle('machineSettings.get', () => ({ settings: { gateway: { defaultRoute: defaults.legacy } }, version: 1, ...(defaults.route !== undefined && { defaultRoute: defaults.route }) }));
  f.host.reads.set('engine.models', () => CATALOGUE);
  const asked = () => f.host.calls.filter((c) => c.name === 'engine.models').map((c) => c.input);
  return { f, asked, a: await openRemote(f, org.a1, org.A), b: await openRemote(f, org.b1, org.B) };
}

describe('engine.models over the link', () => {
  it('is listed as a capability', () => {
    expect(ENDPOINT_CAPABILITIES).toContain('rl2.engine-models');
  });

  it('answers the catalogue of the machine’s default route, in the checkout named, to a member as to an owner', async () => {
    const { a, b, asked } = await setup({ legacy: 'gateway', route: 'direct' });
    const answered = await call(b, 'engine.models', { refresh: false, cwd: '/work/m8' });
    expect(answered).toMatchObject({ ok: true, output: CATALOGUE });
    expect(await call(a, 'engine.models', { refresh: false })).toMatchObject({ ok: true, output: CATALOGUE });
    expect(asked()).toEqual([
      { refresh: false, cwd: '/work/m8', gateway: 'direct' },
      { refresh: false, gateway: 'direct' },
    ]);
  });

  it('asks the machine’s own route by `route` beside the legacy field, as a New chat there asks it', async () => {
    const { a, asked } = await setup({ legacy: 'gateway', route: 'machine' });
    expect(code(await call(a, 'engine.models', { refresh: false }))).toBe('ok');
    expect(asked()).toEqual([{ refresh: false, gateway: 'gateway', route: 'machine' }]);
  });

  it('takes the legacy field where the settings carry no resolved default', async () => {
    const { a, asked } = await setup({ legacy: 'direct' });
    expect(code(await call(a, 'engine.models', { refresh: false }))).toBe('ok');
    expect(asked()).toEqual([{ refresh: false, gateway: 'direct' }]);
  });

  it('refuses a route of the caller’s and a refresh `malformed`, asking nothing', async () => {
    const { a, asked } = await setup({ legacy: 'gateway' });
    expect(code(await call(a, 'engine.models', { refresh: false, gateway: 'direct' }))).toBe('malformed');
    expect(code(await call(a, 'engine.models', { refresh: false, route: 'machine' }))).toBe('malformed');
    expect(code(await call(a, 'engine.models', { refresh: true }))).toBe('malformed');
    expect(asked()).toEqual([]);
  });
});
