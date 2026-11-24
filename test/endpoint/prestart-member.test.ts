// A prestart's member at the real endpoint (ticket 851, docs/doperpowers/plans/2026-11-24-prestart-engine.md, R4-6 and
// D11). A New chat's engine starts hidden in the engine host at the first keystroke, and sminos takes it as a lane B
// member at its SessionStart, before anything is sent. What is read is what the endpoint leaves on disk and tells: the
// handed-off mark (`handed-off.json`), the policy cache (`policy/cache.json`), the projects the registry reads from sminos
// (`sminosView().sessionProjects()`), the listing kept for the hub (`listings.json`) and the answer of `endpoint.listings`
// to a member's channel (the direct desk read).
//
// The harness is sub-harness.ts's: the engine host a stand-in whose `engine.prestart` events reach the endpoint as
// `mawsd`'s permanent link forwards them (`emitHost`), its `engine.sessions` naming a row only once it is public (`add`),
// and sminos the scripted peer on the real RL10 socket.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Listing, Signed } from 'org-protocol';
import type { ListingsFile } from '../../src/endpoint/state/store';
import { laneAMember, makeOrg, openRemote, PROJECT, sminos, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

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

/** What the endpoint keeps of the pin and its project, on disk and in what it tells. */
function traces(f: Fixture) {
  const dir = f.services.machine.stateDir;
  const read = (path: string) => (fs.existsSync(join(dir, path)) ? fs.readFileSync(join(dir, path), 'utf8') : '');
  return {
    handedOff: read('handed-off.json').includes(DRAFT_ENGINE) || read('handed-off.json').includes(INTENT),
    policyCache: read(join('policy', 'cache.json')).includes(DRAFT_ENGINE) || f.endpoint.rl10.cache.before(DRAFT_ENGINE, Number.MAX_SAFE_INTEGER) !== undefined,
    projects: f.endpoint.rl10.sminosView()?.sessionProjects().includes(NEW_PROJECT) ?? false,
    listed: read('listings.json').includes(INTENT) || read('listings.json').includes(DRAFT_ENGINE),
    held: f.endpoint.rl10.members.get(DRAFT_ENGINE) !== null,
  };
}
const NONE = { handedOff: false, policyCache: false, projects: false, listed: false, held: false };

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

/** The machine with sminos on RL10, the project of each test open on the log plane so its sessions qualify. */
async function machine(project: string): Promise<{ f: Fixture; b: Remote }> {
  const f = await startEndpoint(org, started);
  f.records.set({ lane: 'B', session: DRAFT_ENGINE, owners: ['@machine'], shares: [{ member: org.B, grade: 'view' }] }, INTENT);
  const s = await sminos(f, []);
  s.send({ t: 'hello', project, name: 'scratch', have: {} });
  const b = await openRemote(f, org.b1, org.B);
  return { f, b };
}

describe('a prestart’s member at the endpoint', () => {
  it('an abandoned first member of a new project leaves nothing in handed-off.json, the policy cache or the project registry', async () => {
    const { f } = await machine(NEW_PROJECT);
    prestart(f, 'hidden');
    f.sminos!.send({ t: 'member', ...pinMember({ project: NEW_PROJECT, access: 'private', policyRev: 1 }) });
    await settled(f);
    expect(traces(f)).toEqual(NONE);
    prestart(f, 'ended');
    // sminos keeps the member of a process that ended, and states it again
    f.sminos!.send({ t: 'member', ...pinMember({ project: NEW_PROJECT, access: 'private', policyRev: 1, state: 'gone' }) });
    await settled(f);
    expect(traces(f)).toEqual(NONE);
  });

  it('a committed member is processed, joined and listed: on the hub’s publication and on a direct desk read', async () => {
    const { f, b } = await machine(PROJECT);
    prestart(f, 'hidden');
    f.sminos!.send({ t: 'member', ...pinMember({ project: PROJECT }) });
    await settled(f);
    expect(traces(f)).toEqual(NONE);
    expect(await channelListing(b, INTENT)).toBeNull();

    f.host.add(INTENT, DRAFT_ENGINE); // the host reveals the row (engine.sessions names it), then says so
    prestart(f, 'committed');
    await until(() => f.endpoint.rl10.members.appSessionId(DRAFT_ENGINE) === INTENT, 'the member joined to its intent');
    await until(() => hubListing(f, INTENT) !== null, 'the session listed for the hub');
    expect(hubListing(f, INTENT)!.body.fields.title).toBe('a new chat');
    expect((await channelListing(b, INTENT))?.body.fields.title).toBe('a new chat');
    expect(fs.readFileSync(join(f.services.machine.stateDir, 'handed-off.json'), 'utf8')).toContain(INTENT);
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
});
