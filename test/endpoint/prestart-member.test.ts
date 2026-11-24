// A prestart's member at the real endpoint (ticket 851, docs/doperpowers/plans/2026-11-24-prestart-engine.md, R4-6 and
// D11). A New chat's engine starts hidden in the engine host at the first keystroke, and sminos takes it as a lane B
// member at its SessionStart, before anything is sent. What is read is what the endpoint leaves on disk and tells: the
// handed-off mark (`handed-off.json`), the policy cache (`policy/cache.json`), the projects the registry reads from sminos
// (`sminosView().sessionProjects()`) and the `known` projects of the machine's signed record in `projects.json`, over a
// loaded index (M4's review, finding 8), the listing kept for the hub (`listings.json`) and the answer of
// `endpoint.listings` to a member's channel (the direct desk read).
//
// The harness is sub-harness.ts's: the engine host a stand-in whose `engine.prestart` events reach the endpoint as
// `mawsd`'s permanent link forwards them (`emitHost`), its `engine.sessions` naming a row only once it is public (`add`),
// and sminos the scripted peer on the real RL10 socket.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Listing, Signed } from 'org-protocol';
import type { ListingsFile, ProjectsKeptFile } from '../../src/endpoint/state/store';
import type { ProjectsSource } from '../../src/shared/machine/registry';
import { laneAMember, makeOrg, openRemote, PROJECT, sminos, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

// The coordinator's item (the prestart panel): RL10's resolution of a local member's owners, held while armed for the
// calls that name `owner` (audiences.ts reads it through this module; listings.ts's own calls are its own binding)
const owners = vi.hoisted(() => ({ holding: null as { owner: string; until: Promise<void> } | null, held: 0 }));
vi.mock('../../src/endpoint/listings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/endpoint/listings')>();
  return {
    ...actual,
    resolveOwners: async (...args: Parameters<typeof actual.resolveOwners>) => {
      const holding = owners.holding;
      if (holding !== null && args[0].includes(holding.owner)) {
        owners.held += 1;
        await holding.until;
      }
      return actual.resolveOwners(...args);
    },
  };
});

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
});

/** The prestart's pin, the engine session the host holds hidden. */
const DRAFT_ENGINE = '3f1c2b7a-5d4e-4f60-8a9b-0c1d2e3f4a5b';
/** The New chat's intent, under which the committed engine runs. */
const INTENT = '6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d';
/** A project new to this machine, which the draft's folder is in. */
const NEW_PROJECT = '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f';

const pinMember = (fields: Record<string, unknown> = {}) => laneAMember({ session: DRAFT_ENGINE, alias: 'draft', lane: 'B', title: 'a new chat', owners: ['@machine'], ...fields });
const prestart = (f: Fixture, state: 'hidden' | 'committed' | 'ended') => f.host.emitHost('engine.prestart', { appSessionId: INTENT, engineSessionId: DRAFT_ENGINE, state });

/** Every frame sminos sent before this one taken: a lane A member after them, held once they were. */
let syncs = 0;
async function settled(f: Fixture): Promise<void> {
  const session = `sync-${++syncs}`;
  f.sminos!.send({ t: 'member', ...laneAMember({ session }) });
  await until(() => f.endpoint.rl10.members.get(session) !== null, 'the frames before taken');
}

/** The `audience` frames RL10 sent sminos for `session`. */
const audiences = (f: Fixture, session: string) => f.sminos!.received.filter((frame) => frame.t === 'audience' && frame.session === session);

/** Every frame sminos sent before this one taken, and every audience RL10 sent for them received (with `audience` on). */
async function heard(f: Fixture): Promise<void> {
  const session = `sync-${++syncs}`;
  f.sminos!.send({ t: 'member', ...laneAMember({ session }) });
  await until(() => audiences(f, session).length > 0, 'the audiences before received');
}

/** The `known` projects of the machine's record as last signed into projects.json, once what is queued is built; null for none signed. */
async function registered(f: Fixture): Promise<string[] | null> {
  await f.endpoint.registry.own.publish();
  const path = join(f.services.machine.stateDir, 'projects.json');
  if (!fs.existsSync(path)) return null;
  return (JSON.parse(fs.readFileSync(path, 'utf8')) as ProjectsKeptFile).record?.body.known.map((k) => k.id) ?? null;
}

/** What the endpoint keeps of the pin and its project, on disk and in what it tells. */
async function traces(f: Fixture) {
  const dir = f.services.machine.stateDir;
  const read = (path: string) => (fs.existsSync(join(dir, path)) ? fs.readFileSync(join(dir, path), 'utf8') : '');
  const known = await registered(f);
  if (known === null) throw new Error('no projects record signed: the fixture cannot show the registry');
  return {
    handedOff: read('handed-off.json').includes(DRAFT_ENGINE) || read('handed-off.json').includes(INTENT),
    policyCache: read(join('policy', 'cache.json')).includes(DRAFT_ENGINE) || f.endpoint.rl10.cache.before(DRAFT_ENGINE, Number.MAX_SAFE_INTEGER) !== undefined,
    projects: f.endpoint.rl10.sminosView()?.sessionProjects().includes(NEW_PROJECT) ?? false,
    registry: known.includes(NEW_PROJECT),
    listed: read('listings.json').includes(INTENT) || read('listings.json').includes(DRAFT_ENGINE),
    held: f.endpoint.rl10.members.get(DRAFT_ENGINE) !== null,
  };
}
const NONE = { handedOff: false, policyCache: false, projects: false, registry: false, listed: false, held: false };

/** The listing of `app` B's channel, holding no subscription, is answered by `endpoint.listings`; null for none. */
async function channelListing(b: Remote, app: string): Promise<Signed<Listing> | null> {
  const id = `l${b.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await b.channel.send({ t: 'call', id, name: 'endpoint.listings', input: null });
  const answer = await waitFor(b, (m: Msg) => m.t === 'result' && m.id === id, 'the answer to endpoint.listings');
  expect(answer).toMatchObject({ ok: true });
  return (answer.output as { listings: Signed<Listing>[] }).listings.find((record) => record.body.session === app) ?? null;
}

/** The listing of `app` the endpoint keeps for the hub; null for none. */
function hubListing(f: Fixture, app: string): Signed<Listing> | null {
  const path = join(f.services.machine.stateDir, 'listings.json');
  if (!fs.existsSync(path)) return null;
  return (JSON.parse(fs.readFileSync(path, 'utf8')) as ListingsFile)[app]?.record ?? null;
}

/** A loaded index declaring no folder: the registry signs the machine's record, its `known` from sminos. */
const loadedIndex = (): ProjectsSource => ({ snapshot: () => ({ indexId: 'index-1', rows: [], statements: [] }), restore: () => {}, onChange: () => () => {} });

/** The machine with sminos on RL10, the project of each test open on the log plane so its sessions qualify. */
async function machine(project: string, capabilities: string[] = []): Promise<{ f: Fixture; b: Remote }> {
  const f = await startEndpoint(org, started, { projectsSource: loadedIndex() });
  f.records.set({ lane: 'B', session: DRAFT_ENGINE, owners: ['@machine'], shares: [{ member: org.B, grade: 'view' }] }, INTENT);
  const s = await sminos(f, [], capabilities);
  s.send({ t: 'hello', project, name: 'scratch', have: {} });
  const b = await openRemote(f, org.b1, org.B);
  return { f, b };
}

describe('a prestart’s member at the endpoint', () => {
  it('the control: an ordinary member of a new project registers it in the signed record', async () => {
    const { f } = await machine(NEW_PROJECT);
    expect(await registered(f)).toEqual([]);
    f.sminos!.send({ t: 'member', ...laneAMember({ session: 'ordinary-1', project: NEW_PROJECT }) });
    await settled(f);
    await until(async () => (await registered(f))?.includes(NEW_PROJECT), 'the new project known in the signed record');
  });

  it('an abandoned first member of a new project leaves nothing in handed-off.json, the policy cache or the project registry', async () => {
    const { f } = await machine(NEW_PROJECT);
    prestart(f, 'hidden');
    f.sminos!.send({ t: 'member', ...pinMember({ project: NEW_PROJECT, access: 'private', policyRev: 1 }) });
    await settled(f);
    expect(await traces(f)).toEqual(NONE);
    prestart(f, 'ended');
    // sminos keeps the member of a process that ended, and states it again
    f.sminos!.send({ t: 'member', ...pinMember({ project: NEW_PROJECT, access: 'private', policyRev: 1, state: 'gone' }) });
    await settled(f);
    expect(await traces(f)).toEqual(NONE);
  });

  it('a committed member is processed, joined and listed: on the hub’s publication and on a direct desk read', async () => {
    const { f, b } = await machine(PROJECT);
    prestart(f, 'hidden');
    f.sminos!.send({ t: 'member', ...pinMember({ project: PROJECT }) });
    await settled(f);
    expect(await traces(f)).toEqual(NONE);
    expect(await channelListing(b, INTENT)).toBeNull();

    f.host.add(INTENT, DRAFT_ENGINE); // the host reveals the row (engine.sessions names it), then says so
    prestart(f, 'committed');
    await until(() => f.endpoint.rl10.members.appSessionId(DRAFT_ENGINE) === INTENT, 'the member joined to its intent');
    await until(() => hubListing(f, INTENT) !== null, 'the session listed for the hub');
    expect(hubListing(f, INTENT)!.body.fields.title).toBe('a new chat');
    expect((await channelListing(b, INTENT))?.body.fields.title).toBe('a new chat');
    expect(fs.readFileSync(join(f.services.machine.stateDir, 'handed-off.json'), 'utf8')).toContain(INTENT);
  });

  it('M4’s review, finding 1: a session committed while the engine host restarts is listed once the successor has adopted it', async () => {
    const { f, b } = await machine(PROJECT);
    let adopting = true;
    let statusRead = false;
    f.host.reads.set('engine.prestarts', () => ({ hidden: [] })); // the successor holds no prestart hidden
    f.host.reads.set('host.supervisorStatus', () => ((statusRead = true), { holder: { adopting } }));
    prestart(f, 'hidden');
    f.sminos!.send({ t: 'member', ...pinMember({ project: PROJECT }) });
    await settled(f);
    // the engine host dies after the native promotion, its `committed` unheard, and its successor starts adopting
    f.host.upstream(false);
    f.host.upstream(true);
    await until(() => statusRead, 'the successor’s status read');
    expect(await traces(f)).toEqual(NONE);
    // the adoption reserves the row, the start's adoptions end, and the host says so
    f.host.add(INTENT, DRAFT_ENGINE);
    adopting = false;
    f.host.emitHost('host.supervisorStatus', { holder: { adopting: false } });
    await until(() => hubListing(f, INTENT) !== null, 'the session listed for the hub');
    expect((await channelListing(b, INTENT))?.body.fields.title).toBe('a new chat');
  });

  it('D11: a member the endpoint met unjoined is listed from Send on, when the spine says its record changed: on both', async () => {
    const { f, b } = await machine(PROJECT);
    f.sminos!.send({ t: 'member', ...pinMember({ project: PROJECT }) }); // no word of a prestart heard
    await settled(f);
    expect(f.endpoint.rl10.members.listingId(DRAFT_ENGINE)).toBeNull();
    expect(await channelListing(b, INTENT)).toBeNull();

    f.host.add(INTENT, DRAFT_ENGINE); // Send committed it: the row is public
    f.host.emitMachine('session.changed', { record: { appId: INTENT, engineSessionId: DRAFT_ENGINE, archived: false, title: { text: 'Hello there', source: 'none' } } });
    await until(() => hubListing(f, INTENT) !== null, 'the session listed for the hub');
    expect((await channelListing(b, INTENT))?.body.fields.title).toBe('a new chat');
  });

  it('the prestart panel, scalpel-4#6: a member whose hidden word is still on its way gets no audience and leaves nothing', async () => {
    const { f } = await machine(NEW_PROJECT, ['audience']);
    // the engine host holds the pin hidden; its `hidden` word is late on the link
    f.host.reads.set('engine.prestarts', () => ({ hidden: [{ appSessionId: INTENT, engineSessionId: DRAFT_ENGINE }] }));
    // the control: an ordinary member's audience goes down to sminos
    f.sminos!.send({ t: 'member', ...laneAMember({ session: 'ordinary-1', access: 'private', policyRev: 1 }) });
    f.sminos!.send({ t: 'member', ...pinMember({ project: NEW_PROJECT, access: 'private', policyRev: 1 }) });
    await heard(f);
    expect(audiences(f, 'ordinary-1')).toHaveLength(1);
    expect(audiences(f, DRAFT_ENGINE)).toEqual([]);
    expect(await traces(f)).toEqual(NONE);
    // the word arrives, and the draft is abandoned
    prestart(f, 'hidden');
    prestart(f, 'ended');
    await heard(f);
    expect(audiences(f, DRAFT_ENGINE)).toEqual([]);
    expect(await traces(f)).toEqual(NONE);
  });

  it('the coordinator’s item: a member pulled back while RL10 resolves its owners keeps no audience', async () => {
    const { f } = await machine(PROJECT, ['audience']);
    const owner = 'pin-owner-held';
    let release!: () => void;
    owners.held = 0;
    owners.holding = { owner, until: new Promise<void>((resolve) => (release = resolve)) };
    try {
      // the host says the pin is not hidden, so the member is processed, and RL10 resolves its owners for its audience
      f.sminos!.send({ t: 'member', ...pinMember({ project: PROJECT, access: 'private', policyRev: 1, owners: ['@machine', owner] }) });
      await until(() => owners.held > 0, 'the member’s owners being resolved');
      prestart(f, 'hidden'); // its word: the member is pulled back
      await until(() => f.endpoint.rl10.members.get(DRAFT_ENGINE) === null, 'the member pulled back');
    } finally {
      owners.holding = null;
      release();
    }
    await heard(f);
    expect(audiences(f, DRAFT_ENGINE)).toEqual([]);
    expect(f.endpoint.rl10.cache.before(DRAFT_ENGINE, Number.MAX_SAFE_INTEGER)).toBeUndefined();
    expect((await traces(f)).policyCache).toBe(false);
  });
});
