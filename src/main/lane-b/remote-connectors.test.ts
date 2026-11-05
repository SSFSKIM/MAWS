// O4's surfaces on another machine through remote lane B (P5 O7 M5c, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "O4's surfaces: the grade", "O4's surfaces: leases, the window, delivery on the machine"): the adapter composed as main
// composes it (`routeLaneB` around a base, the roster announcing the links), over the suites' fake link. The lease reads
// cross as calls and the two tool runs as `machine` acts, each bound to its channel; each machine's gate opens with its
// reset, said as main's own word; the window report per machine before a page's lease commands and at each change; Send
// to on the machine within its budget; Connect with its listener; the feed's connector events said as the machine's.
import { afterEach, describe, expect, it } from 'vitest';
import { endableClientRef, type EndableClientRef } from '@shared/ipc/client';
import type { CommandName, CommandResult, EventName } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import type { MachineRef } from '@shared/machine/ref';
import { FakeLink, MINI } from '../../../test/lane-b/fake-link';
import type { ClientWindowShown } from '../client/window-shown';
import type { MainContext } from '../ipc/router';
import { createRemoteLaneB, MACHINE_ACTS, MACHINE_CALLS, routeLaneB, type RemoteLaneB } from './remote';
import type { CallbackServer } from './remote-port';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const OTHER = 'OtherMachineRef0000000' as MachineRef;
const ART = '11111111-1111-4111-8111-111111111111';
const LEASE = '22222222-2222-4222-8222-222222222222';
const LEASE_2 = '33333333-3333-4333-8333-333333333333';
const PEERS = ['rl2.executor.machine', 'rl2.feeds', 'rl2.artifacts', 'rl2.client-port'];

const adapters: RemoteLaneB[] = [];
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.stop();
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
async function until(check: () => boolean, what: string, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/** A page's window, as the veto reads it: shown or not, and each change it says. */
function windowOf(shown: boolean) {
  const listeners = new Set<() => void>();
  const window: ClientWindowShown & { set(shown: boolean): void } = {
    shown: () => shown,
    closed: () => false,
    onChange: (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    set(next) {
      shown = next;
      for (const listener of [...listeners]) listener();
    },
  };
  return window;
}

function lab() {
  const link = new FakeLink();
  link.peers = [...PEERS];
  const links = new Map<MachineRef, FakeLink>([[MINI, link]]);
  const rosterListeners = new Set<(machines: readonly MachineRef[]) => void>();
  const emitted: Array<{ machine: MachineRef; name: EventName; payload: Record<string, unknown> }> = [];
  const own: Array<{ name: string; payload: unknown }> = [];
  const windows = new Map<string, ReturnType<typeof windowOf>>();
  let nextPort = 41_000;
  const adapter = createRemoteLaneB({
    local: LOCAL,
    layout: { get: () => null, onChange: () => () => {} },
    remote: (machine) => links.get(machine) ?? null,
    onRemote: (listener) => (rosterListeners.add(listener), () => void rosterListeners.delete(listener)),
    emit: (machine, name, payload) => {
      const checked = validateEventPayload(name, payload);
      if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
      emitted.push({ machine, name, payload: payload as Record<string, unknown> });
    },
    emitOwn: (name, payload) => {
      const checked = validateEventPayload(name, payload);
      if (!checked.ok) throw new Error(`invalid ${name}`);
      own.push({ name, payload });
    },
    windowShown: (client) => windows.get(client.id) ?? null,
    listenCallback: async () => ({ port: nextPort++, close: () => {} }) as CallbackServer,
    timing: { sendPendingMs: 2_000, feedRetryMs: [10, 50] },
    log: () => {},
  });
  adapters.push(adapter);
  const route = routeLaneB(async () => ({ ok: true, value: 'base' }) as unknown as CommandResult<CommandName>, (m) => links.get(m) ?? null, adapter);
  const pages = new Map<string, EndableClientRef>();
  /** A page, its window shown or not. */
  const page = (id: string, shown = true) => {
    windows.set(id, windowOf(shown));
    const client = endableClientRef(id);
    pages.set(id, client);
    return client;
  };
  const cmd = (name: string, input: unknown, client: EndableClientRef = pages.get('page-1') ?? page('page-1'), machine: MachineRef = MINI) => route(machine, name as CommandName, input, { client, target: machine } satisfies MainContext);
  return {
    link,
    links,
    adapter,
    emitted,
    own,
    windows,
    page,
    cmd,
    roster: () => rosterListeners.forEach((listener) => listener([...links.keys()])),
    resets: () => own.filter((e) => e.name === 'connectors.reset').map((e) => e.payload),
    reports: (on: FakeLink = link) => on.calls.filter((c) => c.name === 'client.windowShown').map((c) => (c.input as { shown: boolean }).shown),
    named: (on: FakeLink = link) => on.calls.map((c) => c.name),
  };
}

/** The lab with its link's lease reads and window report answered, the roster announced and the first reset said. */
async function ready() {
  const l = lab();
  l.link.answers.set('client.windowShown', () => ({ ok: true, output: { ok: true } }));
  l.link.answers.set('connectors.open', () => ({ ok: true, output: { leaseId: LEASE } }));
  l.link.answers.set('connectors.close', () => ({ ok: true, output: { ok: true } }));
  l.link.answers.set('connectors.declare', () => ({ ok: true, output: { ok: true, declared: [] } }));
  l.link.answers.set('connectors.visibility', () => ({ ok: true, output: { ok: true } }));
  l.roster();
  await until(() => l.resets().length === 1, 'the first reset');
  return l;
}

describe('what crosses, as what', () => {
  it('takes the six lease reads by name as calls, and every M5c act as a `machine` act', () => {
    const l = lab();
    // P5 O7 M9: and the remote setup's two reads (./remote.test.ts' "the remote setup (M9)")
    expect([...MACHINE_CALLS]).toEqual(['connectors.open', 'connectors.declare', 'connectors.watch', 'connectors.unwatch', 'connectors.visibility', 'connectors.close', 'machine.folders.list', 'session.trust.check']);
    for (const name of [...MACHINE_CALLS, ...MACHINE_ACTS]) expect([name, l.adapter.handles(name)]).toEqual([name, true]);
    for (const name of ['connectors.call', 'connectors.refresh', 'delivery.send', 'delivery.cancel', 'connectors.connect', 'connectors.signIn', 'connectors.signInServer', 'artifacts.grantConnectorTool'] as CommandName[]) expect(MACHINE_ACTS.has(name)).toBe(true);
    // nothing else is widened: the plainly graded reads keep the manager's path
    for (const name of ['delivery.status', 'delivery.receipts', 'connectors.callback'] as CommandName[]) expect([name, l.adapter.handles(name)]).toEqual([name, false]);
  });

  it('sends a lease read as a call on its channel, though its grade is by effect, and its tool runs as a `machine` act', async () => {
    const l = await ready();
    expect(await l.cmd('connectors.open', { artifactId: ART })).toEqual({ ok: true, value: { leaseId: LEASE } });
    expect(l.link.calls.filter((c) => c.name === 'connectors.open')).toEqual([{ name: 'connectors.open', input: { artifactId: ART } }]);
    l.link.onAct = (act) => act.settle({ state: 'refused', reason: 'grade' });
    const ran = await l.cmd('connectors.call', { leaseId: LEASE, request: { server: 's', tool: 't' } });
    expect(l.link.acts.at(-1)!.request).toMatchObject({ action: 'connectors.call', executor: 'machine', oneChannel: true, args: { leaseId: LEASE } });
    expect(ran).toMatchObject({ ok: false, error: { issues: { refusal: 'grade' } } }); // the endpoint's word, as any act's
  });
});

describe('the gate and the reset', () => {
  it('says each channel’s reset as main’s own word, naming the machine, once the channel is current', async () => {
    const l = lab();
    l.roster();
    await until(() => l.resets().length === 1, 'the first reset');
    expect(l.resets()).toEqual([{ machine: MINI }]);
    expect(l.emitted.filter((e) => e.name === 'connectors.reset')).toEqual([]); // never as the machine's
    l.link.lose();
    await flush();
    expect(l.resets()).toHaveLength(1);
    l.link.relink();
    await until(() => l.resets().length === 2, 'the next channel’s reset');
    expect(l.resets()).toEqual([{ machine: MINI }, { machine: MINI }]);
  });

  it('refuses every lease command from a channel’s loss until its reset, nothing sent, and lets them go after it', async () => {
    const l = await ready();
    l.link.lose();
    const sent = l.link.calls.length;
    const acts = l.link.acts.length;
    expect(await l.cmd('connectors.open', { artifactId: ART })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(await l.cmd('connectors.call', { leaseId: LEASE, request: {} })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    l.link.relink();
    // the next channel is current, its reset not yet said: still refused
    expect(await l.cmd('connectors.declare', { leaseId: LEASE, tools: [] })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect([l.link.calls.length, l.link.acts.length]).toEqual([sent, acts]);
    await until(() => l.resets().length === 2, 'the reset');
    expect(await l.cmd('connectors.open', { artifactId: ART })).toEqual({ ok: true, value: { leaseId: LEASE } });
    expect(l.named().slice(sent)).toEqual(['client.windowShown', 'connectors.open']);
  });

  it('answers a lease read in flight at its channel’s loss `host_unavailable`, never carried to the next channel', async () => {
    const l = await ready();
    await l.cmd('connectors.open', { artifactId: ART });
    let release!: () => void;
    l.link.answers.set('connectors.declare', () => new Promise((resolve) => (release = () => resolve({ ok: false, error: { code: 'grade' } }))));
    const declared = l.cmd('connectors.declare', { leaseId: LEASE, tools: [] });
    await until(() => l.named().includes('connectors.declare'), 'the declare out');
    l.link.lose();
    expect(await declared).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    release();
    l.link.relink();
    await until(() => l.resets().length === 2, 'the reset');
    expect(l.named().filter((name) => name === 'connectors.declare')).toHaveLength(1);
  });

  // the review's finding 1: a command that waited for the window report across a channel's end doesn't go on the next
  it('refuses a lease command whose window report was out when its channel ended, sending nothing on the next channel', async () => {
    const l = await ready();
    l.link.answers.set('client.windowShown', () => new Promise(() => {}));
    const a = l.page('page-a', true);
    const answer = l.cmd('connectors.open', { artifactId: ART }, a);
    await until(() => l.reports().length === 1, 'the report out');
    l.link.lose();
    l.link.relink();
    expect(await answer).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(l.named().filter((name) => name === 'connectors.open')).toEqual([]);
    await until(() => l.resets().length === 2, 'the reset');
    expect(l.adapter.handles('connectors.open')).toBe(true);
  });

  // the review's finding 2: a lease act out at its channel's loss answers at once, saying it may have run
  it('answers a lease act out at its channel’s loss `host_unavailable`, unknown whether it ran', async () => {
    const l = await ready();
    const ran = l.cmd('connectors.refresh', { leaseId: LEASE });
    await until(() => l.link.acts.length > 0, 'the act out');
    l.link.lose();
    const answered = await ran;
    expect(answered).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect((answered as { error: { message: string } }).error.message).toContain('unknown whether it ran');
  });

  it('makes no lease act on a channel that ended before its reset', async () => {
    const l = await ready();
    l.link.lose();
    l.link.relink();
    const before = l.link.acts.length;
    expect(await l.cmd('connectors.refresh', { leaseId: LEASE })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(l.link.acts).toHaveLength(before);
  });
});

describe('the window report per machine', () => {
  it('reports before a page’s first lease command, and again at each change of whether a page holding a lease there is shown', async () => {
    const l = await ready();
    const a = l.page('page-a', true);
    const b = l.page('page-b', false);
    expect(l.reports()).toEqual([]); // no page follows a lease there: the machine's default, hidden, stands
    l.link.answers.set('connectors.open', (input) => ({ ok: true, output: { leaseId: input.artifactId === ART ? LEASE : LEASE_2 } }));
    await l.cmd('connectors.open', { artifactId: ART }, b);
    expect(l.reports()).toEqual([]); // a hidden page alone: hidden
    await l.cmd('connectors.open', { artifactId: '44444444-4444-4444-8444-444444444444' }, a);
    expect(l.named().slice(-2)).toEqual(['client.windowShown', 'connectors.open']); // before the command
    expect(l.reports()).toEqual([true]);
    l.windows.get('page-b')!.set(true);
    await flush();
    expect(l.reports()).toEqual([true]); // still shown: no report
    l.windows.get('page-a')!.set(false);
    await flush();
    expect(l.reports()).toEqual([true]); // b is shown and holds one
    l.windows.get('page-b')!.set(false);
    await until(() => l.reports().length === 2, 'the hidden report');
    expect(l.reports()).toEqual([true, false]);
    // a's lease closed: b's window alone counts
    l.windows.get('page-a')!.set(true);
    await until(() => l.reports().length === 3, 'a shown again');
    await l.cmd('connectors.close', { leaseId: LEASE_2 }, a);
    await until(() => l.reports().length === 4, 'a without a lease');
    expect(l.reports()).toEqual([true, false, true, false]);
  });

  // the review's finding 3: a page's end closes its leases on the channel that opened them, and an open answered after it
  it('closes a page’s leases when it ends, and a lease whose open answered after the page ended, on their own channel alone', async () => {
    const l = await ready();
    const a = l.page('page-a', true);
    await l.cmd('connectors.open', { artifactId: ART }, a);
    a.end();
    await flush();
    expect(l.link.calls.filter((c) => c.name === 'connectors.close').map((c) => c.input)).toEqual([{ leaseId: LEASE }]);

    let answer!: () => void;
    l.link.answers.set('connectors.open', () => new Promise((resolve) => (answer = () => resolve({ ok: true, output: { leaseId: LEASE_2 } }))));
    const b = l.page('page-b', true);
    const opening = l.cmd('connectors.open', { artifactId: ART }, b);
    await until(() => l.named().filter((name) => name === 'connectors.open').length === 2, 'the second open out');
    b.end();
    answer();
    await opening;
    await flush();
    expect(l.link.calls.filter((c) => c.name === 'connectors.close').map((c) => c.input)).toEqual([{ leaseId: LEASE }, { leaseId: LEASE_2 }]);

    // a lease of a channel that ended is the machine's to have closed: nothing goes on the next channel for it
    const c = l.page('page-c', true);
    l.link.answers.set('connectors.open', () => ({ ok: true, output: { leaseId: LEASE } }));
    await l.cmd('connectors.open', { artifactId: ART }, c);
    l.link.lose();
    l.link.relink();
    await until(() => l.resets().length === 2, 'the reset');
    c.end();
    await flush();
    expect(l.link.calls.filter((call) => call.name === 'connectors.close')).toHaveLength(2);
  });

  it('reports to each machine on its own: a page shown with a lease on one is nothing to the other', async () => {
    const l = await ready();
    const other = new FakeLink(OTHER);
    other.peers = [...PEERS];
    other.answers.set('client.windowShown', () => ({ ok: true, output: { ok: true } }));
    other.answers.set('connectors.open', () => ({ ok: true, output: { leaseId: LEASE_2 } }));
    l.links.set(OTHER, other);
    l.roster();
    await until(() => l.resets().length === 2, 'the other machine’s reset');
    expect(l.resets()).toEqual([{ machine: MINI }, { machine: OTHER }]);
    const a = l.page('page-a', true);
    await l.cmd('connectors.open', { artifactId: ART }, a);
    expect([l.reports(), l.reports(other)]).toEqual([[true], []]);
    const b = l.page('page-b', false);
    await l.cmd('connectors.open', { artifactId: ART }, b, OTHER);
    expect([l.reports(), l.reports(other)]).toEqual([[true], []]);
    l.windows.get('page-b')!.set(true);
    await until(() => l.reports(other).length === 1, 'the other machine’s report');
    expect([l.reports(), l.reports(other)]).toEqual([[true], [true]]);
  });

  it('refuses a lease command the machine’s report could not be taken for, and reports afresh on the next channel', async () => {
    const l = await ready();
    l.link.answers.set('client.windowShown', () => ({ ok: false, error: { code: 'timeout' } }));
    const a = l.page('page-a', true);
    expect(await l.cmd('connectors.open', { artifactId: ART }, a)).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(l.named().filter((name) => name === 'connectors.open')).toEqual([]);
    expect(l.reports()).toEqual([true, true, false]); // at most two reports' worth; then, no page holding one, hidden
    l.link.answers.set('client.windowShown', () => ({ ok: true, output: { ok: true } }));
    l.link.lose();
    l.link.relink();
    await until(() => l.resets().length === 2, 'the reset');
    expect(await l.cmd('connectors.open', { artifactId: ART }, a)).toEqual({ ok: true, value: { leaseId: LEASE } });
    expect(l.reports()).toEqual([true, true, false, true]);
  });

  it('lets the lease command go to an endpoint that offers no report: its own refusal is the answer', async () => {
    const l = await ready();
    l.link.answers.delete('client.windowShown');
    l.link.answers.set('connectors.open', () => ({ ok: false, error: { code: 'not-offered' } }));
    const a = l.page('page-a', true);
    expect(await l.cmd('connectors.open', { artifactId: ART }, a)).toMatchObject({ ok: false, error: { issues: { refusal: 'not-offered' } } });
  });
});

describe('Send to and Connect on the machine', () => {
  it('sends `delivery.send` as a `machine` act, answered at its outcome past the pending bound within its budget', async () => {
    const l = await ready();
    Object.assign(l.link, { budgets: { 'delivery.send': 5_000 } });
    const input = { runId: '55555555-5555-4555-8555-555555555555', target: 'drive', artifactId: ART, format: 'docx', destination: { kind: 'default' } };
    let late!: () => void;
    l.link.onAct = (act) => {
      act.move('accepted');
      late = () => act.settle({ state: 'done', result: { ok: false, why: 'cancelled' } });
    };
    const sent = l.cmd('delivery.send', input);
    await new Promise((resolve) => setTimeout(resolve, 2_300)); // past the pending bound alone
    late();
    expect(await sent).toEqual({ ok: true, value: { ok: false, why: 'cancelled' } });
    expect(l.link.acts.at(-1)!.request).toMatchObject({ action: 'delivery.send', executor: 'machine', args: input });
  });

  it('carries a Connect’s listener’s port in its act', async () => {
    const l = await ready();
    l.link.onAct = (act) => act.settle({ state: 'done', result: { accepted: true } });
    expect(await l.cmd('connectors.connect', { artifactId: ART, sourceHandle: 'source-1' })).toEqual({ ok: true, value: { accepted: true } });
    expect(l.link.acts.at(-1)!.request).toMatchObject({ action: 'connectors.connect', executor: 'machine', args: { artifactId: ART, sourceHandle: 'source-1', callback: { port: 41_000 } } });
  });

  it('says the feed’s connector and delivery events as the machine’s own', async () => {
    const l = await ready();
    await flush();
    const feed = l.link.open().find((s) => s.request.feed === 'artifacts')!;
    feed.sink.subbed('snapshot', { epoch: 'artifacts:boot1', seq: 0 });
    feed.sink.event({ epoch: 'artifacts:boot1', seq: 1 }, { name: 'connectors.serversChanged', payload: { artifactId: ART } });
    feed.sink.event({ epoch: 'artifacts:boot1', seq: 2 }, { name: 'connectors.signInChanged', payload: { opId: 'op-1', name: 'linear', state: 'failed', reason: 'engine', message: 'sign in on mini', where: null } });
    expect(l.emitted.filter((e) => e.name.startsWith('connectors.')).map((e) => [e.machine, e.name])).toEqual([
      [MINI, 'connectors.serversChanged'],
      [MINI, 'connectors.signInChanged'],
    ]);
  });
});
