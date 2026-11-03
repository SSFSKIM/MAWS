// The client port across the channel (P5 O7 M5c, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Consent and
// the client port"; Proves, M5c: client-port.test.ts). A service in `mawsd` asks the port for an effect of the client a
// request came from; for a remote device that client is its channel's `ClientRef`, and the request reaches the device as
// RL2's `client`, its `clientAnswer` settling the service's call. Through `mawsd`'s real services front (its `route` and
// `createClientPort`), never a stand-in that routes otherwise: the endpoint registers each channel's target under its ref
// with `clientPort.serve`, and the front consults those after its own connections.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ClientRef } from '@shared/ipc/client';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { MachineRef } from '@shared/machine/ref';
import { NO_CLIENT } from '@shared/client/port';
import { createServicesFront, type ServicesFront } from '../../src/mawsd/front';
import { fakeServices } from './fake-services';
import { makeOrg, openRemote, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const fronts: ServicesFront[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
  for (const front of fronts.splice(0)) front.close();
});
afterAll(() => stopAll(started));

const PORT = ['rl2.client-port'];
const IDENTITY = { ref: 'TestMachineRef00000000' as MachineRef, name: 'test machine', project: { key: 'machine:TestMachineRef00000000', name: 'test machine', smnsId: null } };

/** `mawsd`'s services front, as the daemon builds it (no spine, no host: the port alone is asked here). */
function front(deadlineMs?: number): ServicesFront {
  const served = createServicesFront({
    spine: { ensure: async () => ({}) as never },
    hosts: { forward: async () => ({ t: 'res', id: 'x', ok: false, error: { code: 'host_unavailable', message: 'none' } }) as HostResponse, onRaw: () => () => {}, onStreaming: () => () => {}, parked: () => false },
    intercept: () => null,
    daemon: async () => undefined,
    identity: () => IDENTITY,
    isApp: () => false,
    log: () => {},
    ...(deadlineMs === undefined ? {} : { portDeadlineMs: deadlineMs }),
  });
  fronts.push(served);
  return served;
}

/** An endpoint whose services' port is the front's, and the ref each admitted channel registered. */
async function setup(options: { deadlineMs?: number } = {}) {
  const served = front(options.deadlineMs);
  const services = fakeServices();
  const refs: ClientRef[] = [];
  services.clientPort = {
    serve: (ref, target) => {
      refs.push(ref);
      return served.serveRemote(ref, target);
    },
  };
  const f = await startEndpoint(org, started, { services });
  return { f, served, refs };
}

async function admitted(refs: ClientRef[], r: Promise<Remote>): Promise<{ remote: Remote; ref: ClientRef }> {
  const before = refs.length;
  const remote = await r;
  await until(() => refs.length > before, 'the channel’s port target');
  return { remote, ref: refs[before] };
}

const clientOf = (r: Remote, from = 0) => waitFor(r, (m) => m.t === 'client', 'a client port request', from);

describe('the client port across the channel', () => {
  it('posts a port request for a channel’s ref to its device as `client`, and the device’s `clientAnswer` settles it', async () => {
    const { f, served, refs } = await setup();
    const { remote: b, ref } = await admitted(refs, openRemote(f, org.b1, org.B, { capabilities: PORT }));
    const asked = served.port.openExternal(ref, { url: 'https://auth.example.com/consent?state=s' });
    const request = await clientOf(b);
    expect(request).toMatchObject({ t: 'client', kind: 'openExternal', request: { url: 'https://auth.example.com/consent?state=s' } });
    await b.channel.send({ t: 'clientAnswer', id: request.id, answer: { opened: true } });
    expect(await asked).toEqual({ opened: true });
  });

  it('refuses an answer under another channel’s handle: the request stays its own channel’s', async () => {
    const { f, served, refs } = await setup();
    const { remote: a } = await admitted(refs, openRemote(f, org.a1, org.A, { capabilities: PORT }));
    const { remote: b, ref: bRef } = await admitted(refs, openRemote(f, org.b1, org.B, { capabilities: PORT }));
    let settled: unknown = null;
    const asked = served.port.openExternal(bRef, { url: 'https://auth.example.com/b' }).then((answer) => (settled = answer));
    const request = await clientOf(b);
    expect(a.inbox.some((m) => (m as Msg).t === 'client')).toBe(false); // asked of B's device alone
    await a.channel.send({ t: 'clientAnswer', id: request.id, answer: { opened: false, reason: 'A answers for B' } });
    await until(() => f.services.lines.some((line) => line.includes(`answered client port request ${request.id as string}, which it was not asked`)), 'the refusal logged');
    expect(settled).toBeNull();
    await b.channel.send({ t: 'clientAnswer', id: request.id, answer: { opened: true } });
    await asked;
    expect(settled).toEqual({ opened: true });
  });

  it('answers `noClient` at once for a device that listed no `rl2.client-port`, sending it nothing', async () => {
    const { f, served, refs } = await setup();
    const { remote: b, ref } = await admitted(refs, openRemote(f, org.b1, org.B));
    expect(await served.port.openExternal(ref, { url: 'https://auth.example.com/consent' })).toEqual(NO_CLIENT);
    expect(await served.port.reveal(ref, '/p/x')).toEqual(NO_CLIENT);
    expect(b.inbox.some((m) => (m as Msg).t === 'client')).toBe(false);
  });

  it('carries only the kinds a device answers once: a pick or a notification is `noClient` at once', async () => {
    const { f, served, refs } = await setup();
    const { remote: b, ref } = await admitted(refs, openRemote(f, org.b1, org.B, { capabilities: PORT }));
    expect(await served.port.pick(ref, { kind: 'file', multiple: false })).toEqual(NO_CLIENT);
    expect(served.port.notify(ref, { title: 't', body: 'b', silent: true }, () => {})).toEqual(NO_CLIENT);
    expect(b.inbox.some((m) => (m as Msg).t === 'client')).toBe(false);
  });

  it('settles a request the device never answers `noClient` at the port’s deadline', async () => {
    const { f, served, refs } = await setup({ deadlineMs: 150 });
    const { remote: b, ref } = await admitted(refs, openRemote(f, org.b1, org.B, { capabilities: PORT }));
    const asked = served.port.openExternal(ref, { url: 'https://auth.example.com/slow' });
    const request = await clientOf(b);
    expect(await asked).toEqual(NO_CLIENT);
    // a late answer finds nothing outstanding
    await b.channel.send({ t: 'clientAnswer', id: request.id, answer: { opened: true } });
    await until(() => f.services.lines.some((line) => line.includes('which it was not asked')), 'the late answer refused');
  });

  it('settles what a channel was asked `noClient` when it closes, and asks a later channel of the device afresh', async () => {
    const { f, served, refs } = await setup();
    const { remote: b, ref } = await admitted(refs, openRemote(f, org.b1, org.B, { capabilities: PORT }));
    const asked = served.port.openExternal(ref, { url: 'https://auth.example.com/consent' });
    await clientOf(b);
    b.channel.close('bye');
    expect(await asked).toEqual(NO_CLIENT);
    // the closed channel's ref routes nowhere now; the device's next channel is its own target
    expect(await served.port.openExternal(ref, { url: 'https://auth.example.com/again' })).toEqual(NO_CLIENT);
    const { remote: again, ref: next } = await admitted(refs, openRemote(f, org.b1, org.B, { capabilities: PORT }));
    expect(next).not.toBe(ref);
    const second = served.port.openExternal(next, { url: 'https://auth.example.com/next' });
    const request = await clientOf(again);
    await again.channel.send({ t: 'clientAnswer', id: request.id, answer: { opened: true } });
    expect(await second).toEqual({ opened: true });
  });
});
