// A remote dashboard's snapshot holds (P5 O7 M5c round 3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5
// "O4's surfaces"; the architect's ruling of 2026-11-02): E3's hold over a dashboard's snapshot bytes
// (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b) taken for another machine's main, over RL2. Main's link
// asks `artifacts.holdAssets` and `artifacts.releaseAssets` as calls, behind `rl2.asset-holds`; a window's own
// (`holdDatasets`, `releaseDatasets`) never cross. The endpoint authorizes a hold at `view` on its artifact (the `artifact`
// rule), takes it on the engine host and keeps it per channel: a channel releases only its own, its end releases them
// all, a member who loses `view` loses their holds on that artifact, a channel holds at most ASSET_HOLDS_KEPT, and the
// engine host's going (it released them) forgets them.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ASSET_HOLDS_KEPT } from '../../src/endpoint/asset-holds';
import { ENDPOINT_CAPABILITIES } from '../../src/endpoint/capabilities';
import { OFFERS } from '../../src/endpoint/offers';
import type { SessionRecord } from '../../src/endpoint/sources';
import { fakeAssetHolds } from './fake-services';
import { drop, makeOrg, openRemote, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

const REFS = ['assets/query-1.json'];

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}
const codeOf = (m: Msg) => (m.ok === true ? 'ok' : (m.error as { code: string }).code);
const holdIdOf = (m: Msg) => (m.output as { assetHoldId: string }).assetHoldId;

/**
 * A shares `app-shared` (its artifact `shared`) with B at `view`; `other` is the machine owners' alone. The engine host's
 * holds are fakeAssetHolds', installed after the start.
 */
async function scene() {
  const f = await startEndpoint(org, started);
  const add = (app: string, fields: Partial<SessionRecord>) => {
    const s = f.host.add(app);
    f.spine.set(app, s.engineSessionId, { appId: app });
    f.records.set({ lane: 'B', session: s.engineSessionId!, owners: ['@machine'], access: 'private', ...fields }, app);
    return s;
  };
  const sharedSession = add('app-shared', { shares: [{ member: org.B, grade: 'view' }] });
  add('app-2', {});
  const shared = randomUUID();
  const other = randomUUID();
  f.host.artifact(shared, ['app-shared']);
  f.host.artifact(other, ['app-2']);
  const holds = fakeAssetHolds(f.services);
  const withdraw = () => f.records.set({ lane: 'B', session: sharedSession.engineSessionId!, owners: ['@machine'], access: 'private' }, 'app-shared');
  return { f, holds, shared, other, withdraw, a: await openRemote(f, org.a1, org.A), b: await openRemote(f, org.b1, org.B) };
}

describe('a remote dashboard’s snapshot holds', () => {
  it('are offered to main’s link as calls, the hold at `view` on its artifact and the release at `list`, behind `rl2.asset-holds`; a window’s own are not', async () => {
    expect(ENDPOINT_CAPABILITIES).toContain('rl2.asset-holds');
    expect(OFFERS.commands['artifacts.holdAssets']).toEqual({ kind: 'call', executor: 'endpoint', target: 'artifact', grade: 'view' });
    expect(OFFERS.commands['artifacts.releaseAssets']).toEqual({ kind: 'call', executor: 'endpoint', target: 'machine', grade: 'list' });
    for (const name of ['artifacts.holdDatasets', 'artifacts.releaseDatasets', 'artifacts.captureDatasetState']) expect([name, OFFERS.commands[name]]).toEqual([name, undefined]);
    const { b, shared } = await scene();
    expect(codeOf(await call(b, 'artifacts.holdDatasets', { artifactId: shared, refs: REFS }))).toBe('not-offered');
  });

  it('take a hold on the engine host for a member who views the artifact, refuse one who doesn’t before the host is asked, and release only the asking channel’s own', async () => {
    const { holds, shared, other, a, b } = await scene();
    const taken = await call(b, 'artifacts.holdAssets', { artifactId: shared, refs: REFS });
    expect(codeOf(taken)).toBe('ok');
    expect(holds.held(shared, REFS[0]!)).toBe(true);
    expect(codeOf(await call(b, 'artifacts.holdAssets', { artifactId: other, refs: REFS }))).toBe('grade');
    expect(holds.taken()).toBe(1);
    // another channel's release of it releases nothing, and asks the host nothing
    expect(await call(a, 'artifacts.releaseAssets', { assetHoldId: holdIdOf(taken) })).toMatchObject({ ok: true, output: { released: false } });
    expect(holds.held(shared, REFS[0]!)).toBe(true);
    expect(await call(b, 'artifacts.releaseAssets', { assetHoldId: holdIdOf(taken) })).toMatchObject({ ok: true, output: { released: true } });
    expect(holds.released()).toBe(1);
    expect(await call(b, 'artifacts.releaseAssets', { assetHoldId: holdIdOf(taken) })).toMatchObject({ ok: true, output: { released: false } }); // once
    expect(codeOf(await call(b, 'artifacts.holdAssets', { artifactId: shared, refs: ['content/1/index.html'] }))).toBe('malformed');
  });

  it('release every hold of a channel at its end', async () => {
    const { holds, shared, b } = await scene();
    for (const ref of ['assets/query-1.json', 'assets/query-2.json']) expect(codeOf(await call(b, 'artifacts.holdAssets', { artifactId: shared, refs: [ref] }))).toBe('ok');
    drop(b);
    await until(() => holds.released() === 2, 'both holds released with the channel');
    expect(holds.held(shared, 'assets/query-1.json') || holds.held(shared, 'assets/query-2.json')).toBe(false);
  });

  it('release a hold answered after its channel ended, at once', async () => {
    const { holds, shared, b } = await scene();
    let answer!: () => void;
    holds.until = new Promise<void>((resolve) => (answer = resolve));
    await b.channel.send({ t: 'call', id: 'late', name: 'artifacts.holdAssets', input: { artifactId: shared, refs: REFS } });
    await until(() => holds.asked() === 1, 'the hold asked of the host');
    drop(b);
    answer();
    await until(() => holds.released() === 1, 'the late hold released');
    expect(holds.held(shared, REFS[0]!)).toBe(false);
  });

  it('release a member’s holds on an artifact once they no longer view it (the share withdrawn), and keep the machine owner’s', async () => {
    const { f, holds, shared, withdraw, a, b } = await scene();
    const bs = await call(b, 'artifacts.holdAssets', { artifactId: shared, refs: ['assets/query-1.json'] });
    const as = await call(a, 'artifacts.holdAssets', { artifactId: shared, refs: ['assets/query-2.json'] });
    expect([codeOf(bs), codeOf(as)]).toEqual(['ok', 'ok']);
    withdraw();
    await until(() => holds.released() === 1, 'B’s hold released by the endpoint');
    expect(holds.held(shared, 'assets/query-1.json')).toBe(false);
    expect(holds.held(shared, 'assets/query-2.json')).toBe(true);
    expect(f.services.lines.some((line) => line.includes(`holds on artifact ${shared} released by the endpoint: grade`))).toBe(true);
    // B's handle names nothing now; a new hold is refused
    expect(await call(b, 'artifacts.releaseAssets', { assetHoldId: holdIdOf(bs) })).toMatchObject({ ok: true, output: { released: false } });
    expect(codeOf(await call(b, 'artifacts.holdAssets', { artifactId: shared, refs: REFS }))).toBe('grade');
    expect(holds.released()).toBe(1);
  });

  it(`hold at most ${ASSET_HOLDS_KEPT} a channel: one past it is refused \`busy\`, unasked of the host, and a release makes room`, async () => {
    const { holds, shared, a, b } = await scene();
    const answers = await Promise.all(Array.from({ length: ASSET_HOLDS_KEPT }, (_, i) => call(b, 'artifacts.holdAssets', { artifactId: shared, refs: [`assets/query-${i}.json`] })));
    expect(answers.every((m) => codeOf(m) === 'ok')).toBe(true);
    expect(codeOf(await call(b, 'artifacts.holdAssets', { artifactId: shared, refs: REFS }))).toBe('busy');
    expect(holds.taken()).toBe(ASSET_HOLDS_KEPT);
    expect(codeOf(await call(a, 'artifacts.holdAssets', { artifactId: shared, refs: REFS }))).toBe('ok'); // another channel's own bound
    expect(await call(b, 'artifacts.releaseAssets', { assetHoldId: holdIdOf(answers[0]!) })).toMatchObject({ output: { released: true } });
    expect(codeOf(await call(b, 'artifacts.holdAssets', { artifactId: shared, refs: REFS }))).toBe('ok');
  }, 20_000);

  it('forget the holds the engine host released when its link went: a release answers false, asking the host nothing', async () => {
    const { f, holds, shared, b } = await scene();
    const taken = await call(b, 'artifacts.holdAssets', { artifactId: shared, refs: REFS });
    expect(codeOf(taken)).toBe('ok');
    f.host.upstream(false);
    expect(await call(b, 'artifacts.releaseAssets', { assetHoldId: holdIdOf(taken) })).toMatchObject({ ok: true, output: { released: false } });
    expect(holds.releaseAsked()).toBe(0);
  });

  it('release every hold when the endpoint stops', async () => {
    const { f, holds, shared, b } = await scene();
    expect(codeOf(await call(b, 'artifacts.holdAssets', { artifactId: shared, refs: REFS }))).toBe('ok');
    started.splice(started.indexOf(f), 1);
    try {
      await f.endpoint.stop();
      await until(() => holds.released() === 1, 'the hold released at the stop');
    } finally {
      f.services.cleanup();
    }
  });
});
