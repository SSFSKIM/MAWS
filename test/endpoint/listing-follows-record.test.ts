// Whether a machine's listing of a session MAWS runs follows that session's record (UX wave U9, M1, "The listing rule
// opens with its test"; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md): an archived session's listing
// is withdrawn, and a renamed one's carries the record's title. Each half is its own case and is judged by itself.
//
// The harness is reader-state.test.ts's: the real endpoint behind its real gate, with its own Members and Listings, and
// the real index behind the machine's dispatch (`registerIndexHandlers` on the spine). The acts are the services' own
// handlers, `session.archive` and `session.rename` (`registerSessionServiceHandlers` over a real SessionService on that
// index, test/support/session-harness.ts), run as the machine's own window runs them; the record is never written by
// the test. Every event the index's source emits goes to the endpoint as mawsd's front sends the spine's
// (`emitMachine`), so the endpoint hears each `session.changed` as it would on the machine.
//
// What is read is what a remote reader with no tab open holds: the answer of `endpoint.listings` to a member's channel
// that holds no subscription, and the listing the endpoint keeps for the hub (`listings.json`, the project open on the
// log plane so its sessions qualify).
//
// Two seams, and what they leave out. sminos is the scripted peer on the RL10 socket (FakeSminos), which says nothing new
// after the archive or the rename: its member frame keeps the state and the title it stated. The engine host is a
// stand-in on both sides (the services' holds no launch of the session, so the archive ends no process and the rename
// writes the record's override; the endpoint's lists the session only so the member joins its app session). So a pass
// shows the endpoint by itself making the listing follow the record; it does not show what a machine's real sminos
// reports of its own accord, nor the hub's delivery to a second device (the look T1 after the landing).
//
// The org (sub-harness.ts): A owns the machine `mini`; B is a member the session is shared with at `view`.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isListingGone, type Listing, type Signed } from 'org-protocol';
import type { AppSessionId } from '@shared/graph/ids';
import type { ClientId, ClientRef, HandlerContext } from '@shared/ipc/client';
import type { ListingsFile } from '../../src/endpoint/state/store';
import { registerIndexHandlers } from '../../src/services/index/register';
import { registerSessionServiceHandlers } from '../../src/services/sessions/service-register';
import { summary } from '../support/index-fixture';
import { SessionHarness } from '../support/session-harness';
import { laneAMember, makeOrg, openRemote, PROJECT, sminos, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const harnesses: SessionHarness[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
  for (const h of harnesses.splice(0)) h.dispose();
});

/** The session's title, in its record and in the member frame sminos states (and keeps stating) for it. */
const REPORTED = 'Studio scratch';
/** The title the owner gives the session in the machine's own window. */
const RENAMED = 'Loft notes';
/** The session's first prompt, which a record with no title of its own shows in a title's place (source `none`). */
const FIRST_PROMPT = 'Say hello from the machine.';
/** How long a listing is given to follow its record. */
const FOLLOWS_WITHIN_MS = 3000;

/** The machine's own window, as a client of its services. */
const WINDOW: ClientRef = { id: 'window-1' as ClientId, onGone: () => () => {} };

/**
 * The machine: its endpoint, the services' real index and session service behind the spine, one lane B session of
 * `@machine`'s shared with B at `view` and reported by sminos (with the project open on the log plane), and B's channel.
 */
async function machine(titled: { customTitle?: string | null } = {}): Promise<{ f: Fixture; h: SessionHarness; app: AppSessionId; b: Remote }> {
  const f = await startEndpoint(org, started);
  const h = await new SessionHarness().start();
  harnesses.push(h);
  registerIndexHandlers(h.index, f.spine.bus as never);
  // The intercepts in front of the engine host have no part in these acts.
  registerSessionServiceHandlers(h.service, { register: f.spine.bus.register, intercept: () => () => {} } as never, 'index');
  const push = h.events.push.bind(h.events);
  h.events.push = (...entries) => {
    for (const { name, payload } of entries) f.host.emitMachine(name, payload);
    return push(...entries);
  };
  const record = h.index.sessions.upsertFromSummary(summary({ directory: h.work, customTitle: REPORTED, firstPrompt: FIRST_PROMPT, ...titled })).record;
  if (titled.customTitle === undefined) expect(record.title.text).toBe(REPORTED);
  const engine = record.engineSessionId!;
  f.host.add(record.appId, engine); // the endpoint's engine host names the pair, so the member joins its app session
  f.records.set({ lane: 'B', session: engine, owners: ['@machine'], shares: [{ member: org.B, grade: 'view' }] }, record.appId);
  const s = await sminos(f, []);
  s.send({ t: 'hello', project: PROJECT, name: 'mini', have: {} });
  s.send({ t: 'member', ...laneAMember({ session: engine, alias: 'studio', lane: 'B', title: REPORTED, owners: ['@machine'] }) });
  await until(() => f.endpoint.rl10.members.appSessionId(engine) === record.appId, 'the member joined to its app session');
  const b = await openRemote(f, org.b1, org.B);
  return { f, h, app: record.appId, b };
}

/** The window's act: the services' handler for `name`, as the spine runs it for a client of this machine. */
async function windowAct(f: Fixture, name: string, input: Record<string, unknown>): Promise<unknown> {
  const handler = f.spine.handlers.get(name);
  if (handler === undefined) throw new Error(`the spine holds no handler for ${name}`);
  return handler(input, { client: WINDOW } satisfies HandlerContext);
}

/** The listing of `app` that B's channel, holding no subscription, is answered by `endpoint.listings`; null for none. */
async function channelListing(b: Remote, app: AppSessionId): Promise<Signed<Listing> | null> {
  const id = `l${b.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await b.channel.send({ t: 'call', id, name: 'endpoint.listings', input: null });
  const answer = await waitFor(b, (m: Msg) => m.t === 'result' && m.id === id, 'the answer to endpoint.listings');
  expect(answer).toMatchObject({ ok: true });
  const listings = (answer.output as { listings: Signed<Listing>[] }).listings;
  return listings.find((record) => record.body.session === app) ?? null;
}

/** The listing of `app` the endpoint keeps for the hub; null for none. */
function hubListing(f: Fixture, app: AppSessionId): Signed<Listing> | null {
  const path = join(f.services.machine.stateDir, 'listings.json');
  if (!fs.existsSync(path)) return null;
  return (JSON.parse(fs.readFileSync(path, 'utf8')) as ListingsFile)[app]?.record ?? null;
}

/** What a listing says, for comparing: withdrawn, or listed with its title; null for no listing at all. */
const said = (record: Signed<Listing> | null) => (record === null ? null : isListingGone(record.body) ? 'withdrawn' : { title: record.body.fields.title });

/**
 * Both surfaces at once, so a failure names each. A channel answer with no listing of the session is a withdrawal; so is
 * no listing kept for the hub of a session listed before: no hub connection is up in this harness, and a listing no
 * connection carried is dropped at its withdrawal rather than signed gone (listings.ts, `#withdraw`: the hub has nothing
 * of the session, and gets nothing).
 */
async function surfaces(f: Fixture, b: Remote, app: AppSessionId): Promise<{ channel: unknown; hub: unknown }> {
  const channel = said(await channelListing(b, app));
  return { channel: channel ?? 'withdrawn', hub: said(hubListing(f, app)) ?? 'withdrawn' };
}

describe('a machine’s listing follows its record, read by a remote reader with no tab open', () => {
  it('withdraws the listing of a session archived in the machine’s own window', async () => {
    const { f, h, app, b } = await machine();
    await until(() => said(hubListing(f, app)) !== null, 'the session listed for the hub');
    expect(await surfaces(f, b, app)).toEqual({ channel: { title: REPORTED }, hub: { title: REPORTED } });

    expect(await windowAct(f, 'session.archive', { appSessionId: app })).toEqual({ archived: true });
    expect(h.index.sessions.get(app)!.archived).toBe(true);

    await expect.poll(() => surfaces(f, b, app), { timeout: FOLLOWS_WITHIN_MS, interval: 100 }).toEqual({ channel: 'withdrawn', hub: 'withdrawn' });
  });

  it('lists again a session unarchived in the machine’s own window', async () => {
    const { f, app, b } = await machine();
    await until(() => said(hubListing(f, app)) !== null, 'the session listed for the hub');
    expect(await windowAct(f, 'session.archive', { appSessionId: app })).toEqual({ archived: true });
    await expect.poll(() => surfaces(f, b, app), { timeout: FOLLOWS_WITHIN_MS, interval: 100 }).toEqual({ channel: 'withdrawn', hub: 'withdrawn' });

    await windowAct(f, 'session.update', { appSessionId: app, patch: { archived: false } });
    await expect.poll(() => surfaces(f, b, app), { timeout: FOLLOWS_WITHIN_MS, interval: 100 }).toEqual({ channel: { title: REPORTED }, hub: { title: REPORTED } });
  });

  // The UX wave, U9's T2 (e2e/remote.spec.ts's first scene): a record that holds no title of its own, only its first
  // prompt in a title's place (`source: 'none'`), names nothing, so the title sminos reports stands
  it('keeps the reported title for a record whose only title is its first prompt', async () => {
    const { f, h, app, b } = await machine({ customTitle: null });
    expect(h.index.sessions.get(app)!.title).toEqual({ text: FIRST_PROMPT, source: 'none' });
    await until(() => said(hubListing(f, app)) !== null, 'the session listed for the hub');
    expect(await surfaces(f, b, app)).toEqual({ channel: { title: REPORTED }, hub: { title: REPORTED } });
  });

  it('re-issues the listing of a stopped session renamed in the machine’s own window with the record’s title', async () => {
    const { f, h, app, b } = await machine();
    await until(() => said(hubListing(f, app)) !== null, 'the session listed for the hub');
    expect(await surfaces(f, b, app)).toEqual({ channel: { title: REPORTED }, hub: { title: REPORTED } });

    expect(await windowAct(f, 'session.rename', { appSessionId: app, title: RENAMED })).toMatchObject({ via: 'override' });
    expect(h.index.sessions.get(app)!.title).toEqual({ text: RENAMED, source: 'user' });

    await expect.poll(() => surfaces(f, b, app), { timeout: FOLLOWS_WITHIN_MS, interval: 100 }).toEqual({ channel: { title: RENAMED }, hub: { title: RENAMED } });
  });
});
