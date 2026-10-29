// Remote lane A through a real link against a real endpoint (P5 O9 M9, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md,
// M9's "Proves"; acceptance 9's main half): the endpoint's own harness (test/endpoint/sub-harness.ts) on its direct
// listener at loopback, O7's `createRemoteLink` driven by the profile's real device keys as a second device of the
// machine's owner (test/machines/remote-link.test.ts's pattern), and sminos on RL10 played by ./fake-plane.ts. The
// adapter is reached as the router reaches it, through `routeLaneA` over the manager's dispatch. A carrier switch is the
// link's own: its relay is a second carrier to the same listener (no hub runs), and a probe moves it to direct.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputSha256, type JsonValue } from 'desk-hub/protocol';
import { memoryOrgView, type ByteDuplex, type SignedOrgState } from 'org-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { endableClientRef } from '@shared/ipc/client';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { LaneAState } from '@shared/ipc/schema/lane-a';
import { validateEventPayload } from '@shared/ipc/validate';
import type { MachineRef } from '@shared/machine/ref';
import { loadDeviceKeys } from '../../src/main/device/keys';
import { createStepUp } from '../../src/main/device/step-up';
import type { MainContext } from '../../src/main/ipc/router';
import { createRemoteLaneA, MEDIA_GAP, routeLaneA, STOP_TASK_GAP, type RemoteLaneA } from '../../src/main/lane-a/remote';
import { dialDirect } from '../../src/main/machines/remote/carriers';
import { createRemoteLink, type RelaySocket, type RemoteLink } from '../../src/main/machines/remote/link';
import { heldOrgSession, watchedView, type SignedIn } from '../../src/main/org/session';
import { endorsed, iso, successor } from '../endpoint/org-fixtures';
import { laneAMember, makeOrg, openRemote, ORG, sleep, sminos, startEndpoint, stopAll, until, type Fixture, type Org } from '../endpoint/sub-harness';
import { FakePlane, STATUS_READ } from './fake-plane';

let org: Org;
const started: Fixture[] = [];
const cleanups: Array<() => void> = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  await stopAll(started);
});
afterAll(() => stopAll(started));

const OPEN = { perSource: { burst: 1000, perMinute: 60_000 }, overall: { burst: 1000, perMinute: 60_000 } };

/** A carrier the test can cut, or mute (its inbound bytes dropped: a lost answer). */
type Tap = { mute: boolean };
function tapped(inner: ByteDuplex, tap: Tap): ByteDuplex {
  return {
    send: (bytes) => inner.send(bytes),
    close: (reason) => inner.close(reason),
    onClose: (listener) => inner.onClose?.(listener),
    onBytes: (listener) => inner.onBytes((bytes) => (tap.mute ? undefined : listener(bytes))),
  };
}

type Emitted = { name: 'laneA.changed' | 'laneA.plane'; payload: Record<string, unknown> };
type Lab = {
  f: Fixture;
  plane: FakePlane;
  link: RemoteLink;
  adapter: RemoteLaneA;
  machine: MachineRef;
  emitted: Emitted[];
  base: Array<{ name: string }>;
  carriers: Array<{ carrier: ByteDuplex; tap: Tap; via: 'direct' | 'relay' }>;
  relays: RelaySocket[];
  direct: { dead: boolean };
  signs: () => number;
  client: ReturnType<typeof endableClientRef>;
  cmd<N extends CommandName>(name: N, input: unknown, client?: ReturnType<typeof endableClientRef>): Promise<unknown>;
  route(name: string, input: unknown): Promise<CommandResult<CommandName>>;
};

/** The endpoint with sminos on RL10 (la-1, the owner's; la-b, B's, shared with A at `approve`), and main's link up to it. */
async function lab(options: { relay?: boolean; upGraceMs?: number } = {}): Promise<Lab> {
  const f = await startEndpoint(org, started, { limits: OPEN });
  const s = await sminos(f, [laneAMember(), laneAMember({ session: 'la-b', alias: 'bob', title: 'bob', launch: 'LB', owners: [org.B], shares: [{ member: org.A, grade: 'approve' }] })]);
  const plane = new FakePlane(s);
  cleanups.push(() => plane.close());
  const profile = mkdtempSync(join(tmpdir(), 'maws-o9-remote-'));
  cleanups.push(() => rmSync(profile, { recursive: true, force: true }));
  const keys = await loadDeviceKeys(profile, { excludeFromBackup: async () => true });
  const mac = await endorsed(ORG, org.A, { device: { id: 'mac1', class: 'native-mac', keyStorage: 'software', channelPub: keys.channel.pub, stepUpPub: keys.stepUp.pub }, channel: keys.channel, stepUp: keys.stepUp }, org.a1);
  const listed = await successor(f.chain.at(-1)!, [org.a1], (st) => void st.members.find((m) => m.id === org.A)!.devices.push(mac.device));
  await deliver(f, [listed]);
  const chain = [...f.chain, listed];
  const session = heldOrgSession();
  let signs = 0;
  const signedIn: SignedIn = {
    identity: { org: ORG, member: org.A, device: 'mac1', clientClass: 'native-mac', channelKey: keys.channel, build: 'o9-m9', capabilities: [] },
    view: watchedView(memoryOrgView({ chain }), () => session.changed()),
    stepUp: createStepUp({ device: { org: ORG, device: 'mac1' }, key: keys.stepUp, confirm: async () => (signs++, { ok: true }) }),
    hub: options.relay === true ? { url: 'http://127.0.0.1:9', headers: async () => ({}) } : null,
  };
  session.set(signedIn);
  const carriers: Lab['carriers'] = [];
  const relays: RelaySocket[] = [];
  const direct = { dead: options.relay === true };
  const dial = async (via: 'direct' | 'relay', timeoutMs = 2000) => {
    const tap: Tap = { mute: false };
    const carrier = tapped(await dialDirect(`ws://127.0.0.1:${f.port()}`, timeoutMs), tap);
    carriers.push({ carrier, tap, via });
    return carrier;
  };
  const link = createRemoteLink({
    machine: { ref: f.ref as MachineRef, name: 'mini' },
    session,
    records: { resolve: async () => ({ body: { org: ORG, machine: f.ref, addresses: ['ws://100.101.102.108:47830'], issued: iso(Date.now()) }, sig: { kid: 'k', alg: 'ES256', value: 'v' } }) as never },
    // The tailnet address, at the listener's loopback port in its place, while it lives.
    dialDirect: async (_url, timeoutMs) => {
      if (direct.dead) throw new Error('refused');
      return dial('direct', timeoutMs);
    },
    // The hub's relay, played by a second carrier to the same listener: the link can't tell, and the switch is its own.
    openRelay: async () => {
      const ends = new Set<(reason: string) => void>();
      const open: ByteDuplex[] = [];
      const socket: RelaySocket = {
        dial: async () => {
          const carrier = await dial('relay');
          open.push(carrier);
          return carrier;
        },
        onClose: (listener) => void ends.add(listener),
        close: () => {
          for (const carrier of open.splice(0)) carrier.close('dropped');
          for (const listener of [...ends]) listener('closed');
        },
      };
      relays.push(socket);
      return socket;
    },
    timing: { DIRECT_BUCKET: OPEN.perSource, ...(options.upGraceMs !== undefined && { UP_GRACE_MS: options.upGraceMs }) },
    log: () => {},
  });
  cleanups.push(() => link.close());
  await until(() => link.state() === 'up', 'the link up', 10_000);
  const emitted: Emitted[] = [];
  const machine = f.ref as MachineRef;
  const adapter = createRemoteLaneA({
    local: 'local-machine-ref-0001' as MachineRef,
    emit: (to, name, payload) => {
      expect(to).toBe(machine);
      const checked = validateEventPayload(name, payload); // what emitFrom refuses, the suite refuses
      if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
      emitted.push({ name, payload: payload as Record<string, unknown> });
    },
    timing: { backoffMs: [50, 400] },
    log: () => {},
  });
  cleanups.push(() => adapter.stop());
  const base: Array<{ name: string }> = [];
  const route = routeLaneA(
    async (_machine, name) => (base.push({ name }), { ok: true, value: 'manager' }) as unknown as CommandResult<CommandName>,
    (ref) => (ref === link.machine ? link : null),
    adapter,
  );
  const client = endableClientRef('page-1');
  const ctx = (c: ReturnType<typeof endableClientRef>): MainContext => ({ client: c, target: machine });
  return {
    f,
    plane,
    link,
    adapter,
    machine,
    emitted,
    base,
    carriers,
    relays,
    direct,
    signs: () => signs,
    client,
    route: (name, input) => route(machine, name as CommandName, input, ctx(client)),
    async cmd(name, input, c = client) {
      const result = await route(machine, name, input, ctx(c));
      if (!result.ok) throw new Error(`${name}: ${result.error.code} ${result.error.message}`);
      return result.value;
    },
  };
}

/** A new head delivered to the endpoint as an admin's device carries it. */
async function deliver(f: Fixture, states: SignedOrgState[]): Promise<void> {
  const admin = await openRemote(f, org.a1, org.A);
  await admin.channel.send({ t: 'state', states, transitions: [] });
  const version = states.at(-1)!.state.version;
  await until(() => (f.endpoint.status().stateVersion ?? 0) >= version, 'the endpoint adopting the head');
  admin.channel.close('closed');
}

const planeOf = (l: Lab, watch: string) => l.emitted.filter((e) => e.name === 'laneA.plane' && e.payload.watch === watch).map((e) => e.payload);
const messagesOf = (l: Lab, watch: string) => planeOf(l, watch).flatMap((p) => (p.messages as Array<Record<string, unknown>> | undefined) ?? []);
const stateNow = (l: Lab, session = 'la-1') => [...l.emitted].reverse().find((e) => e.name === 'laneA.changed' && e.payload.appSessionId === session)?.payload.state as LaneAState | null | undefined;

async function watched(l: Lab, session = 'la-1'): Promise<string> {
  const { watch } = (await l.cmd('laneA.watch', { appSessionId: session })) as { watch: string };
  await until(() => messagesOf(l, watch).some((m) => m.kind === 'snapshot'), `the snapshot of ${session}`);
  await until(() => stateNow(l, session)?.override !== null && stateNow(l, session)?.override !== undefined, `the status read of ${session}`);
  return watch;
}

const permission = { request: 'toolu_p1', tool: 'Bash', input: { command: 'npm test' }, suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }] };

describe('remote lane A over a real link', { timeout: 30_000 }, () => {
  it('watches a session: its snapshot, its presence’s launch and capabilities, its pending requests and the status read’s override in its state; laneA.list names it', async () => {
    const l = await lab();
    l.plane.raise(permission);
    const watch = await watched(l);
    const snapshot = messagesOf(l, watch).find((m) => m.kind === 'snapshot')!;
    expect(snapshot).toMatchObject({ session: 'la-1', sub: l.plane.upstreams()[0], n: 0, body: { rows: [{ uuid: 'r1' }], presence: { launch: 'L1', bridge: true } } });
    await until(() => (stateNow(l)?.pending.length ?? 0) === 1, 'the pending request restated after the snapshot');
    expect(stateNow(l)).toMatchObject({
      appSessionId: 'la-1',
      engineSessionId: 'la-1',
      bridge: 'live',
      reason: null,
      launch: 'L1',
      sminos: '1.27.12',
      controls: { 'decide.scope': { available: true } },
      turn: { running: false, unknown: false },
      model: STATUS_READ.model,
      effort: null,
      override: { model: null, effort: 'high' },
      catalog: { fingerprint: 'cat-1' },
      pending: [{ request: 'toolu_p1', session: 'la-1', tool: 'Bash' }],
    });
    expect(await l.cmd('laneA.list', undefined)).toEqual({ states: [stateNow(l)] });
    expect(await l.cmd('laneA.state', { appSessionId: 'la-1' })).toEqual(stateNow(l));
    expect(await l.cmd('laneA.catalog', { appSessionId: 'la-1' })).toEqual(l.plane.catalog);
    expect(await l.cmd('laneA.state', { appSessionId: 'la-other' })).toBeNull();
  });

  it('leaves every command but laneA.* to O7’s path, and laneA.* for a machine the link doesn’t answer', async () => {
    const l = await lab();
    expect(await l.route('session.status', { appSessionId: 'app-1' })).toEqual({ ok: true, value: 'manager' });
    const route = routeLaneA(async (_m, name) => (l.base.push({ name }), { ok: true, value: 'manager' }) as unknown as CommandResult<CommandName>, () => null, l.adapter);
    expect(await route('another-machine-ref-01' as MachineRef, 'laneA.list', undefined, { client: l.client, target: l.machine })).toEqual({ ok: true, value: 'manager' });
    expect(l.base.map((b) => b.name)).toEqual(['session.status', 'laneA.list']);
  });

  it('drives each control as an act reaching sminos with its lane A context and DX6 args; a model change carries only what changed; the gaps are refused with their reasons', async () => {
    const l = await lab();
    await watched(l);
    const context = { lane: 'A', session: 'la-1', launch: 'L1' };
    const cases: Array<[CommandName, Record<string, unknown>, string, Record<string, unknown>]> = [
      ['laneA.interrupt', {}, 'interrupt', { session: 'la-1' }],
      ['laneA.command', { name: 'rename', args: 'o9' }, 'command', { session: 'la-1', name: 'rename', args: 'o9' }],
      ['laneA.command', { name: 'compact', args: '' }, 'command', { session: 'la-1', name: 'compact' }],
      ['laneA.btw', { prompt: 'what changed?' }, 'btw', { session: 'la-1', prompt: 'what changed?' }],
      ['laneA.compact', { instructions: 'keep the file list' }, 'compact', { session: 'la-1', instructions: 'keep the file list' }],
      ['laneA.stopAgent', { agentId: 'a1' }, 'stop-agent', { session: 'la-1', agentId: 'a1' }],
      ['laneA.tell', { agentId: 'a1', text: 'look at the tests' }, 'tell', { session: 'la-1', agentId: 'a1', text: 'look at the tests' }],
      ['laneA.model', { effort: 'low' }, 'model', { session: 'la-1', effort: 'low' }],
      ['laneA.model', { model: 'haiku', effort: null }, 'model', { session: 'la-1', model: 'haiku', effort: null }],
    ];
    for (const [name, input, rpc, args] of cases) {
      const before = l.plane.rpcs.length;
      expect(await l.cmd(name, { appSessionId: 'la-1', ...input })).toEqual({ state: 'done', result: {} });
      const sent = l.plane.rpcs.slice(before);
      expect(sent.map((r) => r.rpc)).toEqual([rpc]);
      expect(sent[0].args).toEqual(args);
      expect(sent[0].context).toEqual(context);
      expect(sent[0].member).toBe(org.A);
    }
    expect(await l.cmd('laneA.stopTask', { appSessionId: 'la-1', taskId: 'b1' })).toEqual({ state: 'refused', code: 'unsupported', message: STOP_TASK_GAP });
    expect(await l.cmd('laneA.media', { appSessionId: 'la-1', files: [{ name: 'a.png', mediaType: 'image/png', data: 'iVBORw0KGgo=' }] })).toEqual({ state: 'refused', code: 'unsupported', message: MEDIA_GAP });
    // A session nobody watches here has no launch to fence an act with.
    expect(await l.cmd('laneA.interrupt', { appSessionId: 'la-b' })).toMatchObject({ state: 'refused', code: 'no-bridge' });
  });

  it('answers and decides with DX6’s request digest over the raised input; a scope names the one suggestion by its hash; what lane A can’t carry goes nowhere', async () => {
    const l = await lab();
    const watch = await watched(l);
    const question = { request: 'toolu_q1', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which way?' }] } };
    l.plane.raise(permission);
    l.plane.raise(question);
    await until(() => (stateNow(l)?.pending.length ?? 0) === 2, 'both requests pending');
    const digestOf = async (r: { request: string; tool: string; input: unknown }) => ({ session: 'la-1', request: r.request, tool: r.tool, input_sha256: await inputSha256(r.input as JsonValue) });

    expect(await l.cmd('laneA.answer', { appSessionId: 'la-1', request: 'toolu_p1', answer: { kind: 'permission', decision: 'allow', scope: 'session' } })).toEqual({ outcome: 'delivered' });
    expect(l.plane.of('decide').at(-1)!.args).toEqual({ session: 'la-1', decision: 'allow', scope: { suggestion: 0, sha256: await inputSha256(permission.suggestions[0] as JsonValue), destination: 'session' }, digest: await digestOf(permission) });
    expect(await l.cmd('laneA.answer', { appSessionId: 'la-1', request: 'toolu_p1', answer: { kind: 'permission', decision: 'deny', message: 'not now' } })).toEqual({ outcome: 'delivered' });
    expect(l.plane.of('decide').at(-1)!.args).toEqual({ session: 'la-1', decision: 'deny', message: 'not now', digest: await digestOf(permission) });
    expect(await l.cmd('laneA.answer', { appSessionId: 'la-1', request: 'toolu_q1', answer: { kind: 'question', answers: { 'Which way?': 'left' } } })).toEqual({ outcome: 'delivered' });
    expect(l.plane.of('answer').at(-1)!.args).toEqual({ session: 'la-1', answers: { 'Which way?': 'left' }, digest: await digestOf(question) });
    const sent = l.plane.rpcs.length;
    expect(await l.cmd('laneA.answer', { appSessionId: 'la-1', request: 'toolu_p1', answer: { kind: 'permission', decision: 'deny_and_stop' } })).toMatchObject({ outcome: 'refused', code: 'unsupported' });
    expect(l.plane.rpcs).toHaveLength(sent);

    // Answered in the terminal first: the settlement, never an error.
    l.plane.settle('toolu_q1', 'terminal', 'answered');
    await until(() => stateNow(l)?.settled.some((x) => x.request === 'toolu_q1'), 'the terminal’s settlement');
    expect(await l.cmd('laneA.answer', { appSessionId: 'la-1', request: 'toolu_q1', answer: { kind: 'question', answers: { 'Which way?': 'right' } } })).toEqual({
      outcome: 'not_pending',
      settled: { request: 'toolu_q1', session: 'la-1', winner: 'terminal', outcome: 'answered', by: 'terminal', mac: 'm' },
      message: 'already answered: answered by terminal',
    });
    expect(messagesOf(l, watch).some((m) => m.kind === 'settled')).toBe(true);
    // A background request past its window is the terminal's.
    l.plane.raise({ request: 'toolu_bg', tool: 'Bash', input: { command: 'ls' }, agentId: 'a1', deadline: new Date(Date.now() + 100).toISOString() });
    await until(() => stateNow(l)?.pending.some((x) => x.request === 'toolu_bg'), 'the background request');
    await sleep(150);
    expect(await l.cmd('laneA.answer', { appSessionId: 'la-1', request: 'toolu_bg', answer: { kind: 'permission', decision: 'allow', scope: 'once' } })).toMatchObject({ outcome: 'not_pending', terminalOnly: true });
    expect(l.plane.rpcs).toHaveLength(sent);
  });

  it('signs a decision on a session its member doesn’t own once the endpoint asks for step-up, under the same opId', async () => {
    const l = await lab();
    await watched(l, 'la-b');
    l.plane.raise({ ...permission, request: 'toolu_b1' }, 'la-b');
    await until(() => stateNow(l, 'la-b')?.pending.length === 1, 'Bob’s request');
    expect(await l.cmd('laneA.answer', { appSessionId: 'la-b', request: 'toolu_b1', answer: { kind: 'permission', decision: 'allow', scope: 'once' } })).toEqual({ outcome: 'delivered' });
    expect(l.signs()).toBe(1);
    const [decide] = l.plane.of('decide');
    expect(decide).toMatchObject({ args: { session: 'la-b', decision: 'allow' }, context: { lane: 'A', session: 'la-b', launch: 'LB' } });
    expect(l.plane.runs.filter((r) => r.opId === decide.opId)).toHaveLength(1);
  });

  it('sends in order, the second act made only once the first has its outcome, and tracks each send’s fate', async () => {
    const l = await lab();
    await watched(l);
    l.plane.hold('send');
    const first = l.cmd('laneA.send', { appSessionId: 'la-1', text: 'list the files' });
    await until(() => l.plane.of('send').length === 1, 'the first send at sminos');
    const second = l.cmd('laneA.send', { appSessionId: 'la-1', text: 'and count them' });
    await until(() => stateNow(l)?.deliveries.length === 2, 'both sends in the state');
    expect(stateNow(l)!.deliveries.map((d) => d.state)).toEqual(['submitted', 'queued']);
    await sleep(300);
    // Not created: no copy of it reached the endpoint, so sminos was asked about none.
    expect(l.plane.of('send')).toHaveLength(1);
    expect(l.plane.frames.filter((x) => x.t === 'query')).toHaveLength(1);
    l.plane.release('send');
    expect(await first).toMatchObject({ key: { writer: 'remote/local-machine-ref-0001', seq: expect.any(Number) }, state: 'entered', uuid: 'row-1' });
    expect(await second).toMatchObject({ state: 'entered', uuid: 'row-2' });
    expect(l.plane.of('send').map((r) => r.args.text)).toEqual(['list the files', 'and count them']);
    await until(() => stateNow(l)?.deliveries.every((d) => d.state === 'entered'), 'both entered');

    // A `/` text goes as a command; past sminos's bound a send is unconfirmed; a sminos without `send` predates it.
    expect(await l.cmd('laneA.send', { appSessionId: 'la-1', text: '/clear' })).toMatchObject({ key: null, state: 'refused', code: 'bad-args' });
    l.plane.handle('send', () => ({ state: 'done', result: { submitted: true } }));
    expect(await l.cmd('laneA.send', { appSessionId: 'la-1', text: 'slow' })).toMatchObject({ state: 'unconfirmed' });
    l.plane.handle('send', () => ({ state: 'failed', error: { code: 'unsupported', message: "no RPC 'send' on this machine" } }));
    expect(await l.cmd('laneA.send', { appSessionId: 'la-1', text: 'are you there?' })).toMatchObject({ state: 'refused', code: 'unsupported', reason: 'mini’s sminos predates sends from MAWS: update sminos there' });
    l.plane.handle('send', () => ({ state: 'failed', error: { code: 'refused-delivery', message: 'the turn ended' } }));
    expect(await l.cmd('laneA.send', { appSessionId: 'la-1', text: 'too late' })).toMatchObject({ state: 'refused', code: 'refused-delivery' });
  });

  it('keeps a session’s send lane past its last watch: a send after a reopen is made only once the one before has its outcome', async () => {
    const l = await lab();
    const first = await watched(l);
    l.plane.hold('send');
    const before = l.cmd('laneA.send', { appSessionId: 'la-1', text: 'list the files' });
    await until(() => l.plane.of('send').length === 1, 'the first send at sminos');
    await l.cmd('laneA.unwatch', { appSessionId: 'la-1', watch: first });
    await until(() => stateNow(l) === null, 'the state cleared with the last watch');
    await watched(l);
    const after = l.cmd('laneA.send', { appSessionId: 'la-1', text: 'and count them' });
    await until(() => stateNow(l)?.deliveries.some((d) => d.state === 'queued'), 'the second send queued behind the first');
    await sleep(300);
    expect(l.plane.of('send')).toHaveLength(1);
    expect(l.plane.frames.filter((x) => x.t === 'query')).toHaveLength(1);
    l.plane.release('send');
    expect(await before).toMatchObject({ state: 'entered' });
    expect(await after).toMatchObject({ state: 'entered' });
    expect(l.plane.of('send').map((r) => r.args.text)).toEqual(['list the files', 'and count them']);
  });

  it('shows a control’s act in flight with its progress, and clears it at its outcome before the command answers', async () => {
    const l = await lab();
    await watched(l);
    expect(stateNow(l)!.acts).toEqual([]);
    l.plane.hold('stop-agent');
    const stopping = l.cmd('laneA.stopAgent', { appSessionId: 'la-1', agentId: 'a1' });
    await until(() => stateNow(l)?.acts?.[0]?.progress === 'accepted', 'the act accepted by the endpoint');
    await until(() => l.plane.of('stop-agent').length === 1, 'the act at sminos, held');
    const [inFlight] = stateNow(l)!.acts!;
    expect(inFlight).toEqual({ id: expect.any(String), control: 'stop-agent', target: 'a1', progress: 'accepted', at: expect.any(String) });
    expect(inFlight.id).toBe(l.plane.of('stop-agent')[0].opId);
    l.plane.release('stop-agent');
    expect(await stopping).toEqual({ state: 'done', result: {} });
    expect(stateNow(l)!.acts).toEqual([]);
  });

  it('carries the link in the state: up with this device’s member and class; down, every control refused with its reason and no act made', async () => {
    const l = await lab({ upGraceMs: 200 });
    await watched(l);
    expect(stateNow(l)!.link).toEqual({ state: 'up', refusal: null, carrier: 'direct', member: org.A, clientClass: 'native-mac', rights: l.link.caps()!.machine.grades, reason: null });
    l.direct.dead = true;
    l.carriers.at(-1)!.carrier.close('dropped');
    await until(() => stateNow(l)?.link?.state === 'down', 'the link down past its grace', 10_000);
    expect(stateNow(l)!.link).toMatchObject({ carrier: null, reason: 'mini isn’t reachable' });
    const sent = l.plane.rpcs.length;
    expect(await l.cmd('laneA.interrupt', { appSessionId: 'la-1' })).toEqual({ state: 'refused', code: 'offline', message: 'mini isn’t reachable' });
    expect(await l.cmd('laneA.send', { appSessionId: 'la-1', text: 'hello?' })).toMatchObject({ key: null, state: 'refused', code: 'offline' });
    expect(l.plane.rpcs).toHaveLength(sent);
    l.direct.dead = false;
    l.link.probe('network');
    await until(() => stateNow(l)?.link?.state === 'up', 'the link up again', 15_000);
    expect(stateNow(l)!.link!.reason).toBeNull();
  });

  it('resolves an act whose answers were lost to its outcome, with one effect', async () => {
    const l = await lab();
    await watched(l);
    l.carriers.at(-1)!.tap.mute = true; // nothing the endpoint says reaches the link: no ack, no done
    const interrupting = l.cmd('laneA.interrupt', { appSessionId: 'la-1' });
    await until(() => l.plane.runs.some((r) => r.rpc === 'interrupt'), 'the interrupt run at sminos');
    l.carriers.at(-1)!.carrier.close('dropped');
    expect(await interrupting).toEqual({ state: 'done', result: {} });
    expect(l.plane.runs.filter((r) => r.rpc === 'interrupt')).toHaveLength(1);
  });

  it('refuses an act sealed for the session’s earlier launch `context`', async () => {
    const l = await lab();
    await watched(l);
    // sminos's record moves to the next launch before the plane's presence says so.
    l.plane.s.send({ t: 'member', ...laneAMember({ launch: 'L2' }) });
    await until(() => l.f.endpoint.rl10.members.get('la-1')?.launch === 'L2', 'the new launch');
    expect(await l.cmd('laneA.interrupt', { appSessionId: 'la-1' })).toMatchObject({ state: 'refused', code: 'context' });
    expect(l.plane.of('interrupt')).toHaveLength(0);
  });

  it('keeps the view across a dropped channel and a carrier switch, every message once and no reset; then pages older rows and answers a read through the watch’s subscription', async () => {
    const l = await lab({ relay: true });
    expect(l.link.carrier()).toBe('relay');
    const watch = await watched(l);
    const chunk = (i: number) => ({ turnId: 't1', agentId: null, step: 1, chunkIndex: i, chunk: { kind: 'text', index: 0, text: `${i} ` } });
    const sent: number[] = [];
    for (let i = 0; i < 3; i++) sent.push(...l.plane.emit('chunk', chunk(i)));
    const numbered = () => messagesOf(l, watch).filter((m) => m.kind === 'chunk').map((m) => m.n as number);
    await until(() => numbered().length === 3, 'the first chunks');
    // The relay socket cut: every channel on it ends; the link reconnects (the direct carrier still dead).
    l.relays.at(-1)!.close();
    for (let i = 3; i < 6; i++) sent.push(...l.plane.emit('chunk', chunk(i)));
    await until(() => numbered().length === 6, 'the chunks sent while the channel was down', 15_000);
    // The direct address answers again: a probe switches the link to it.
    l.direct.dead = false;
    l.link.probe('network');
    await until(() => l.link.carrier() === 'direct', 'the switch to direct', 15_000);
    for (let i = 6; i < 9; i++) sent.push(...l.plane.emit('chunk', chunk(i)));
    await until(() => numbered().length === 9, 'the chunks after the switch', 15_000);
    expect(numbered()).toEqual(sent);
    expect(new Set(numbered()).size).toBe(9);
    expect(planeOf(l, watch).some((p) => p.reset === true)).toBe(false);
    expect(l.plane.upstreams()).toHaveLength(1); // one upstream throughout: each resume a replay
    expect(stateNow(l)?.turn.running).toBe(true);

    expect(await l.cmd('laneA.read', { appSessionId: 'la-1', watch, kind: 'rows', args: { before: 'r1', limit: 50 } })).toEqual({ ok: true, result: { requested: true } });
    const [epoch] = l.plane.upstreams();
    await until(() => l.plane.frames.some((x) => x.t === 'rows' && x.sub === epoch && x.before === 'r1'), 'rows asked on the watch’s upstream');
    await until(() => messagesOf(l, watch).some((m) => m.kind === 'rows'), 'the older rows on the plane');
    expect(messagesOf(l, watch).find((m) => m.kind === 'rows')!.body).toEqual({ rows: [{ uuid: 'older-r1' }], before: 'r1', more: false });
    expect(await l.cmd('laneA.read', { appSessionId: 'la-1', watch, kind: 'mcp' })).toEqual({ ok: true, result: { servers: [{ name: 'github', status: 'connected' }] } });
  });

  it('resets the view cleanly when the endpoint ends its subscription: paused, then reset, the fresh snapshot and the pending set again, then resumed', async () => {
    const l = await lab();
    const watch = await watched(l);
    l.plane.raise(permission);
    await until(() => stateNow(l)?.pending.length === 1, 'the request');
    const [epoch] = l.plane.upstreams();
    l.plane.end(epoch, 'discontinuity'); // sminos ends it: the endpoint ends the device's `unavailable`
    await until(() => planeOf(l, watch).some((p) => p.resumed === true), 'the view resumed on a fresh subscription', 10_000);
    const tail = planeOf(l, watch).slice(planeOf(l, watch).findIndex((p) => typeof p.paused === 'string'));
    expect(tail[0]).toMatchObject({ paused: 'unavailable' });
    expect(tail[1]).toMatchObject({ reset: true });
    expect((tail[2].messages as Array<{ kind: string }>)[0].kind).toBe('snapshot');
    expect(tail.findIndex((p) => p.resumed === true)).toBe(3);
    await until(() => tail.length > 4 || planeOf(l, watch).length > tail.length, 'the pending set after it');
    await until(() => stateNow(l)?.pending.length === 1, 'the request restated');
    expect(l.plane.upstreams()).toHaveLength(1);
    expect(l.plane.upstreams()[0]).not.toBe(epoch);
  });

  it('opens the view afresh when a message was too large to carry: a reset, then the new subscription’s snapshot', async () => {
    const l = await lab();
    const watch = await watched(l);
    const [epoch] = l.plane.upstreams();
    l.plane.emit('chunk', { turnId: 't1', agentId: null, step: 1, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'x'.repeat(5 * 1024 * 1024) } });
    await until(() => planeOf(l, watch).some((p) => p.reset === true), 'the reset', 10_000);
    const from = planeOf(l, watch).findIndex((p) => p.reset === true);
    await until(() => planeOf(l, watch).length > from + 1, 'the fresh snapshot');
    expect((planeOf(l, watch)[from + 1].messages as Array<{ kind: string }>)[0].kind).toBe('snapshot');
    expect(messagesOf(l, watch).some((m) => m.kind === 'chunk')).toBe(false); // the message never went out half-read
    await until(() => l.plane.upstreams().length === 1 && l.plane.upstreams()[0] !== epoch, 'one fresh upstream');
  });

  it('reads a main-loop step-end’s model and effort when it carries them, and the status read’s model without; the message goes on as sent', async () => {
    const l = await lab();
    const watch = await watched(l);
    l.plane.emit('chunk', { turnId: 't1', agentId: null, step: 1, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'hi' } });
    await until(() => stateNow(l)?.turn.running === true, 'the turn running from its open step');
    l.plane.emit('step-end', { turnId: 't1', agentId: null, step: 1 });
    await until(() => stateNow(l)?.turn.running === false, 'the step closed');
    expect(stateNow(l)).toMatchObject({ model: STATUS_READ.model, effort: null });
    expect(messagesOf(l, watch).filter((m) => m.kind === 'step-end').at(-1)!.body).toEqual({ turnId: 't1', agentId: null, step: 1 });
    // From here the fake machine's own producer (sminos 1.27.12's fields): a step-end names what its start carried.
    l.plane.step({ k: 'step-start', turnId: 't2', agentId: null, step: 1, model: 'claude-haiku-4-5', effort: 'low' });
    l.plane.step({ k: 'chunk', turnId: 't2', agentId: null, step: 1, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'hi' } });
    l.plane.step({ k: 'step-end', body: { turnId: 't2', agentId: null, step: 1, t: 1730000000000 } });
    await until(() => stateNow(l)?.model === 'claude-haiku-4-5', 'the model the step ran on');
    expect(stateNow(l)).toMatchObject({ effort: 'low', override: { model: null, effort: 'high' } });
    expect(messagesOf(l, watch).filter((m) => m.kind === 'step-end').at(-1)!.body).toEqual({ turnId: 't2', agentId: null, step: 1, t: 1730000000000, model: 'claude-haiku-4-5', effort: 'low' });
    // A watch that joins mid-step learns the snapshot's model and no effort: the first watch's effort stands.
    l.plane.step({ k: 'step-start', turnId: 't3', agentId: null, step: 1, model: 'claude-opus-4-5', effort: 'max' });
    const late = endableClientRef('page-late');
    const { watch: joined } = (await l.cmd('laneA.watch', { appSessionId: 'la-1' }, late)) as { watch: string };
    await until(() => messagesOf(l, joined).some((m) => m.kind === 'snapshot'), 'the late watch’s snapshot');
    l.plane.step({ k: 'step-end', body: { turnId: 't3', agentId: null, step: 1, t: 1730000000001 } });
    await until(() => messagesOf(l, joined).some((m) => m.kind === 'step-end'), 'the late watch’s step-end');
    expect(messagesOf(l, joined).find((m) => m.kind === 'step-end')!.body).toEqual({ turnId: 't3', agentId: null, step: 1, t: 1730000000001, model: 'claude-opus-4-5' });
    await until(() => stateNow(l)?.effort === 'max', 'the first watch’s step-end, which saw the start');
    // A request that named no effort ran at the default: `effort: null` is observed, and replaces the last one.
    l.plane.step({ k: 'step-start', turnId: 't4', agentId: null, step: 1, model: 'claude-opus-4-5', effort: null });
    l.plane.step({ k: 'step-end', body: { turnId: 't4', agentId: null, step: 1, t: 1730000000002 } });
    await until(() => stateNow(l)?.effort === null, 'the default effort observed');
    expect(messagesOf(l, watch).filter((m) => m.kind === 'step-end').at(-1)!.body).toEqual({ turnId: 't4', agentId: null, step: 1, t: 1730000000002, model: 'claude-opus-4-5', effort: null });
    late.end();
  });

  it('ends a watch at laneA.unwatch and at its page’s end; the last one’s end clears the session’s state', async () => {
    const l = await lab();
    const first = await watched(l);
    const other = endableClientRef('page-2');
    const { watch: second } = (await l.cmd('laneA.watch', { appSessionId: 'la-1' }, other)) as { watch: string };
    await until(() => messagesOf(l, second).some((m) => m.kind === 'snapshot'), 'the second watch’s own snapshot');
    expect(l.plane.upstreams()).toHaveLength(2);
    await l.cmd('laneA.unwatch', { appSessionId: 'la-1', watch: first });
    await until(() => l.plane.upstreams().length === 1, 'the first upstream ended');
    expect(stateNow(l)).not.toBeNull();
    other.end();
    await until(() => stateNow(l) === null, 'the state cleared');
    await until(() => l.plane.upstreams().length === 0, 'every upstream ended');
    expect(await l.cmd('laneA.list', undefined)).toEqual({ states: [] });
  });
});

