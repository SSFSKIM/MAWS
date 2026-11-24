// Ticket 851, M3 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, D4–D10, R4-4): the spine's prestart of a New
// chat's engine. `session.intent.prestart` checks the intent with the guards Send uses and builds the spec Send builds,
// writing nothing; its request is fenced by an epoch (a discard, a Send, a withdraw or a newer request ends it); a
// launch-relevant patch asks again after it has answered; Send passes `adopt` with the key and writes the adopted
// engine's id to the intent's progress.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { SetupIntent } from '@shared/sessions/intent';
import { ENGINE_PRESTART_CAPABILITY, ENGINE_ROUTE_MACHINE_CAPABILITY, PEER_CAPABILITIES } from '@shared/host/socket-protocol';
import { NATIVE_TO_HUMAN_ENV } from '@shared/owner/contract';
import { SessionHarness, type HarnessOptions } from '../../../test/support/session-harness';
import { DOWN_RELAY } from '../../../test/support/session-host';
import { installToHumanPlugin } from '../../../test/support/to-human-plugin';
import { ScratchRepo } from '../../../test/support/scratch-repo';
import { OwnerChannelLaunches } from '../owner/launch';
import { C10_SETTING_DEFAULTS, type C10Settings } from './launch-mapping';
import { RELAY_URL } from '../../engine-host/launch';
import type { IntentStore } from './intents';
import { prestartSwitchedOn } from './prestart';

vi.mock('electron', () => {
  throw new Error('SessionService must not load Electron');
});

const OWNER = 'spine-root-1';
const MESSAGE = { content: 'Reply OK', display: 'Reply OK' };
const machineSettings = (): C10Settings => ({ ...C10_SETTING_DEFAULTS, gateway: { ...C10_SETTING_DEFAULTS.gateway, route: 'machine' } });

let h: SessionHarness;
afterEach(() => h?.dispose());

async function harness(opts: HarnessOptions = {}): Promise<SessionHarness> {
  h?.dispose();
  h = await new SessionHarness({ prestart: { owner: OWNER }, ...opts }).start();
  h.trustDirectory(h.work);
  return h;
}

const create = async (path = h.work) => (await h.service.create({ projectId: null, location: { kind: 'directory', path } })).appSessionId;
const intentFile = (id: string): SetupIntent | null => {
  const path = join(h.userData, 'sessions', 'intents', `${id}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SetupIntent) : null;
};
// the intent as the service holds it, set directly (a shape no command makes on a create intent: a fork's, a failure's)
const putIntent = (intent: SetupIntent) => (h.service as unknown as { deps: { intents: IntentStore } }).deps.intents.put(intent);
const prestartCalls = () => h.host.calledWith('session.prestart') as { spec: LaunchSpec; key: string; owner: string }[];
const withdrawCalls = () => h.host.calledWith('session.prestart.withdraw') as { appSessionId: string; generation: number }[];
const launchCalls = () => h.host.calledWith('session.launch') as { spec: LaunchSpec; adopt?: { key: string } }[];
const butPin = ({ sessionId: _pin, ...rest }: LaunchSpec) => (void _pin, rest);
const userSettings = (value: object) => writeFileSync(join(h.trust.configHome, 'settings.json'), JSON.stringify(value));
const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
};

describe('session.intent.prestart: the spec Send builds, nothing written', () => {
  it('dispatches the spine root’s prestart and answers its token; the intent, the index and the owner channel are untouched', async () => {
    await harness();
    const id = await create();
    const before = intentFile(id);
    const events = h.events.length;
    const answer = await h.service.prestart(id);
    expect(answer).toEqual({ status: 'started', token: expect.any(String) });
    expect(prestartCalls()).toHaveLength(1);
    expect(prestartCalls()[0]).toMatchObject({ owner: OWNER, spec: { appSessionId: id, cwd: h.work } });
    expect(intentFile(id)).toEqual(before);
    expect(h.events.slice(events).filter((e) => e.name === 'session.intent.changed')).toEqual([]);
    expect(h.index.sessions.get(id)).toBeNull();
    expect(h.host.launches).toEqual([]);
  });

  it('Send adopts it: one engine start, its spec the prestart’s but for the pin, and the engine’s id written to progress before progress.launch', async () => {
    await harness();
    const id = await create();
    await h.service.prestart(id);
    const prestarted = prestartCalls()[0]!;
    const engineId = h.host.prestarts.get(id)!.engineSessionId;
    expect(await h.service.startSession(id, { message: MESSAGE, options: {} })).toEqual({ status: 'starting', appSessionId: id });
    expect(await h.settled(id)).toMatchObject({ phase: 'ready', outcome: { kind: 'ready', engineSessionId: engineId } });
    expect(launchCalls()).toHaveLength(1);
    expect(launchCalls()[0]!.adopt).toEqual({ key: prestarted.key });
    expect(butPin(launchCalls()[0]!.spec)).toEqual(butPin(prestarted.spec));
    expect(h.host.adoptions).toHaveLength(1);
    expect(h.host.starts).toBe(1);
    const progress = h.events.filter((e) => e.name === 'session.intent.changed').map((e) => (e.payload as { intent: SetupIntent | null }).intent?.progress).filter((p) => p !== undefined);
    const pinWrite = progress.findIndex((p) => p.engineSessionId === engineId);
    expect(pinWrite).toBeGreaterThan(-1);
    expect(progress[pinWrite]!.launch).toBeNull(); // right after the answer, before progress.launch
    expect(h.index.sessions.get(id)!.engineSessionId).toBe(engineId);
  });

  it('on the machine route: the same spec as Send’s, the route and the legacy field the host is sent included, and Send adopts it', async () => {
    await harness({ settings: machineSettings });
    const id = await create();
    expect(intentFile(id)!.route).toBe('machine');
    expect(await h.service.prestart(id)).toMatchObject({ status: 'started' });
    const prestarted = prestartCalls()[0]!;
    expect(prestarted.spec).toMatchObject({ route: 'machine', gateway: 'direct' });
    await h.service.startSession(id, { message: MESSAGE, options: {} });
    expect(await h.settled(id)).toMatchObject({ phase: 'ready' });
    expect(butPin(launchCalls()[0]!.spec)).toEqual(butPin(prestarted.spec));
    expect(h.host.adoptions).toHaveLength(1);
  });

  it('a settings-only change of the machine route’s base URL gives another key with the same spec, and Send then launches fresh', async () => {
    await harness({ settings: machineSettings });
    userSettings({ env: { ANTHROPIC_BASE_URL: 'https://one.example' } });
    const id = await create();
    await h.service.prestart(id);
    userSettings({ env: { ANTHROPIC_BASE_URL: 'https://two.example' } });
    expect(await h.service.prestart(id)).toMatchObject({ status: 'started' });
    const [first, second] = prestartCalls();
    expect(butPin(second!.spec)).toEqual(butPin(first!.spec));
    expect(second!.key).not.toBe(first!.key);
    // the base URL moves once more before Send: the host is asked to adopt with a key no prestart holds
    userSettings({ env: { ANTHROPIC_BASE_URL: 'https://three.example' } });
    await h.service.startSession(id, { message: MESSAGE, options: {} });
    expect(await h.settled(id)).toMatchObject({ phase: 'ready' });
    expect(launchCalls()[0]!.adopt).toBeDefined();
    expect(launchCalls()[0]!.adopt!.key).not.toBe(second!.key);
    expect(h.host.adoptions).toEqual([]);
    expect(h.host.starts).toBe(3);
  });

  it('a Send with no prestart asked sends no adopt, as today', async () => {
    await harness();
    const id = await create();
    await h.service.startSession(id, { message: MESSAGE, options: {} });
    expect(await h.settled(id)).toMatchObject({ phase: 'ready' });
    expect(launchCalls()[0]).not.toHaveProperty('adopt');
    expect(h.host.starts).toBe(1);
  });
});

describe('the owner channel: decided without writing at the prestart, reserved at Send', () => {
  const owned = (store: (index: SessionHarness['index']) => OwnerChannelLaunches['deps']['store']): HarnessOptions => ({
    ownerChannel: (index) => new OwnerChannelLaunches({ store: store(index), appEnabled: () => true, systemRoot: join(h?.root ?? '/', 'no-system-root'), log: () => {}, modRoute: true }),
  });

  it('a mod that declares 9: the prestart carries 9 and reserves nothing; Send reserves 9 and adopts', async () => {
    await harness(owned((index) => index.ownerChannel));
    installToHumanPlugin(h.trust.configHome, { declares: true });
    const id = await create();
    await h.service.prestart(id);
    expect((prestartCalls()[0]!.spec.extraSettings?.env as Record<string, string>)[NATIVE_TO_HUMAN_ENV]).toBe('9');
    expect(h.index.ownerChannel.session(id)?.advertised ?? null).toBeNull();
    await h.service.startSession(id, { message: MESSAGE, options: {} });
    expect(await h.settled(id)).toMatchObject({ phase: 'ready' });
    expect(h.index.ownerChannel.session(id)).toMatchObject({ advertised: { number: 9 } });
    expect(h.host.adoptions).toHaveLength(1);
  });

  it('a reservation refused at Send turns 9 into 8: the spec differs from the prestart’s, and the host launches fresh with 8', async () => {
    await harness(owned((index) => new Proxy(index.ownerChannel, { get: (target, key) => (key === 'reserveLaunch' ? () => { throw new Error('the index is read-only'); } : Reflect.get(target, key, target)) })));
    installToHumanPlugin(h.trust.configHome, { declares: true });
    const id = await create();
    await h.service.prestart(id);
    expect((prestartCalls()[0]!.spec.extraSettings?.env as Record<string, string>)[NATIVE_TO_HUMAN_ENV]).toBe('9');
    await h.service.startSession(id, { message: MESSAGE, options: {} });
    expect(await h.settled(id)).toMatchObject({ phase: 'ready' });
    expect((launchCalls()[0]!.spec.extraSettings?.env as Record<string, string>)[NATIVE_TO_HUMAN_ENV]).toBe('8');
    expect(h.host.adoptions).toEqual([]);
    expect(h.host.starts).toBe(2);
  });
});

describe('eligibility: the guards Send uses, each rule skipping with nothing dispatched or written', () => {
  type Case = [string, () => Promise<AppSessionId>, HarnessOptions?];
  const shaped = (over: (intent: SetupIntent) => Partial<SetupIntent>) => async () => {
    const id = await create();
    const intent = intentFile(id)!;
    await putIntent({ ...intent, ...over(intent) });
    return id;
  };
  const cases: Case[] = [
    ['a host that does not list engine.prestart', async () => ((h.host.capabilities = PEER_CAPABILITIES.engineHost.filter((c) => c !== ENGINE_PRESTART_CAPABILITY)), create())],
    ['an id with no intent', async () => 'f0f0f0f0-0000-4000-8000-000000000001' as AppSessionId],
    ['a fork', shaped(() => ({ kind: 'fork', source: { appSessionId: 'f0f0f0f0-0000-4000-8000-000000000002' as AppSessionId, engineSessionId: 'f0f0f0f0-0000-4000-8000-000000000003' as SessionId, rewindTo: null } }))],
    ['a side thread’s lineage', shaped(() => ({ lineage: { kind: 'side-thread', parentAppSessionId: 'f0f0f0f0-0000-4000-8000-000000000002' as AppSessionId, parentEngineSessionId: null, openedBy: 'btw' } }))],
    ['a remote spawn (launchedBy)', shaped(() => ({ launchedBy: { member: 'm', device: 'd', opId: 'o', action: null } }))],
    ['no location yet', async () => (await h.service.create({ projectId: null, location: null })).appSessionId],
    ['a new worktree', shaped(() => ({ location: { kind: 'newWorktree', repoRoot: h.work, name: 'feature', branch: { kind: 'new', name: 'feature', base: 'HEAD' } } }))],
    ['a directory that is gone', async () => {
      const id = await create(h.dir('soon-gone'));
      await putIntent({ ...intentFile(id)!, location: { kind: 'directory', path: join(h.root, 'gone') } });
      return id;
    }],
    ['a last failure', shaped((intent) => ({ progress: { ...intent.progress, lastFailure: { at: intent.createdAt, phase: 'launching', message: 'x', resources: { worktree: null, record: 'none', transcript: 'none' } } } }))],
    ['a pending trust bootstrap', shaped((intent) => ({ progress: { ...intent.progress, bootstrap: { appSessionId: 'f0f0f0f0-0000-4000-8000-000000000004' as AppSessionId, at: intent.createdAt } } }))],
    ['a message held behind a card', shaped(() => ({ message: MESSAGE }))],
    ['a gateway model on the direct route', shaped(() => ({ gateway: 'direct', route: 'direct', model: 'claude/opus' }))],
    ['trust unanswered for a folder not trusted', async () => create(h.dir('untrusted'))],
    ['trust accepted where the trust bootstrap would run', async () => {
      const id = await create(h.dir('to-bootstrap'));
      await h.service.patch(id, { trust: 'accepted' });
      return id;
    }],
    ['a relay that is down on the gateway route (the cached read)', async () => ((h.host.relay = DOWN_RELAY), create())],
    ['the launch gate refusing', async () => create(), { launchGate: async () => ({ reason: 'binary_settings', message: 'not yet' }) }],
    ['the machine route on a host that cannot serve it', async () => {
      h.host.capabilities = PEER_CAPABILITIES.engineHost.filter((c) => c !== ENGINE_ROUTE_MACHINE_CAPABILITY);
      userSettings({ env: { ANTHROPIC_BASE_URL: 'https://elsewhere.example' } });
      return create();
    }, { settings: machineSettings }],
    ['the machine route’s relay sheet (the relay down)', async () => {
      userSettings({ env: { ANTHROPIC_BASE_URL: RELAY_URL } });
      h.host.relay = DOWN_RELAY;
      return create();
    }, { settings: machineSettings }],
    ['a machine route whose base URL is uncertain', async () => {
      mkdirSync(h.trust.configHome, { recursive: true });
      writeFileSync(join(h.trust.configHome, 'settings.json'), '{ not json');
      return create();
    }, { settings: machineSettings }],
    ['the replay seam', async () => create(), { replay: { take: () => null } as never }],
    ['no prestart owner (the switch off)', async () => create(), { prestart: undefined }],
  ];

  for (const [rule, make, opts] of cases) {
    it(`skips ${rule}`, async () => {
      await harness(opts);
      const id = await make();
      const before = intentFile(id);
      const events = h.events.length;
      const answer = await h.service.prestart(id);
      expect(answer).toMatchObject({ status: 'skipped', token: null, reason: expect.any(String) });
      expect(prestartCalls()).toEqual([]);
      expect(intentFile(id)).toEqual(before);
      expect(h.events.slice(events).filter((e) => e.name === 'session.intent.changed')).toEqual([]);
      expect(h.index.sessions.get(id)).toBeNull();
    });
  }

  it('skips while a start is in flight (a blank start, which holds no message)', async () => {
    await harness();
    const id = await create();
    h.host.launchHangs = true;
    expect(await h.service.startSession(id, { message: null, options: {} })).toMatchObject({ status: 'starting' });
    expect(intentFile(id)!.message).toBeNull();
    expect(await h.service.prestart(id)).toMatchObject({ status: 'skipped', token: null });
    expect(prestartCalls()).toEqual([]);
  });

  it('reads the relay’s cached health on the gateway route, never forcing a probe', async () => {
    await harness();
    const id = await create();
    await h.service.prestart(id);
    expect(h.host.calledWith('engine.relayHealth')).toEqual([{ force: false }]);
  });

  it('prestarts trust declined, an existing worktree, and the machine route at a reachable base URL', async () => {
    await harness();
    const declined = await create(h.dir('declined'));
    await h.service.patch(declined, { trust: 'declined' });
    expect(await h.service.prestart(declined)).toMatchObject({ status: 'started' });
    const repo = await ScratchRepo.create({ sentinels: false });
    try {
      const worktree = await repo.addManagedWorktree('existing');
      h.trustDirectory(repo.root);
      const existing = (await h.service.create({ projectId: null, location: { kind: 'existingWorktree', repoRoot: repo.root, path: worktree } })).appSessionId;
      expect(await h.service.prestart(existing)).toMatchObject({ status: 'started' });
      expect(prestartCalls().at(-1)!.spec.cwd).toBe(worktree);
    } finally {
      repo.dispose();
    }
  });
});

describe('the epoch (R4-4): what ends a request, and withdraw by token', () => {
  // the owner channel's style read held at its first declaration read
  const heldStyleRead = () => {
    const held = gate();
    let reached = false;
    let first = true;
    const opts: HarnessOptions = {
      ownerChannel: (index) => new OwnerChannelLaunches({
        store: index.ownerChannel, appEnabled: () => true, systemRoot: join(h?.root ?? '/', 'no-system-root'), log: () => {}, modRoute: true,
        readDeclaration: async () => {
          if (first) {
            first = false;
            reached = true;
            await held.opened;
          }
          return true;
        },
      }),
    };
    return { opts, reached: () => reached, release: held.open };
  };

  it('a request held in the owner style read while a discard completes, then released: nothing dispatched', async () => {
    const style = heldStyleRead();
    await harness(style.opts);
    installToHumanPlugin(h.trust.configHome, { declares: true });
    const id = await create();
    const asked = h.service.prestart(id);
    await h.until(style.reached);
    await h.service.discard(id);
    style.release();
    expect(await asked).toMatchObject({ status: 'skipped', token: null });
    expect(prestartCalls()).toEqual([]);
  });

  it('the same with a Send: nothing dispatched, and Send launches as today, with no adopt', async () => {
    const style = heldStyleRead();
    await harness(style.opts);
    installToHumanPlugin(h.trust.configHome, { declares: true });
    const id = await create();
    const asked = h.service.prestart(id);
    await h.until(style.reached);
    await h.service.startSession(id, { message: MESSAGE, options: {} });
    style.release();
    expect(await asked).toMatchObject({ status: 'skipped', token: null });
    expect(await h.settled(id)).toMatchObject({ phase: 'ready' });
    expect(prestartCalls()).toEqual([]);
    expect(launchCalls()[0]).not.toHaveProperty('adopt');
  });

  it('a newer request ends the older one: the older token withdraws nothing, the newer one withdraws what serves it', async () => {
    await harness();
    const id = await create();
    const first = await h.service.prestart(id);
    const second = await h.service.prestart(id);
    expect(second).toMatchObject({ status: 'running' }); // the same launch, already the host's
    expect(second.token).not.toBe(first.token);
    await h.service.withdrawPrestart(id, first.token!);
    expect(withdrawCalls()).toEqual([]);
    await h.service.withdrawPrestart(id, second.token!);
    expect(withdrawCalls()).toEqual([{ appSessionId: id, generation: 1 }]);
    expect(h.host.prestarts.size).toBe(0);
  });

  it('a withdraw while a patch’s request is on its way withdraws the generation that request is answered', async () => {
    await harness();
    const id = await create();
    const { token } = await h.service.prestart(id);
    const held = gate();
    h.host.prestartGate = held.opened;
    await h.service.patch(id, { effort: 'high' });
    await h.until(() => prestartCalls().length === 2); // the replacement, held at the host
    await h.service.withdrawPrestart(id, token!);
    expect(withdrawCalls()).toEqual([{ appSessionId: id, generation: 1 }]);
    held.open();
    await h.until(() => withdrawCalls().length === 2);
    expect(withdrawCalls()[1]).toEqual({ appSessionId: id, generation: 2 });
    expect(h.host.prestarts.size).toBe(0);
  });

  it('a patch replacing the generation, then a withdraw by the first token: the replacement is withdrawn; the patch never waits for it', async () => {
    await harness();
    const id = await create();
    const { token } = await h.service.prestart(id);
    const held = gate();
    h.host.prestartGate = held.opened;
    const patched = await h.service.patch(id, { model: 'sonnet' }); // answers while the new prestart is held at the host
    expect(patched.model).toBe('sonnet');
    await h.until(() => prestartCalls().length === 2);
    expect(prestartCalls()[1]!.spec.model).toBe('sonnet');
    held.open();
    await h.until(() => h.host.prestarts.get(id)?.generation === 2);
    await h.service.withdrawPrestart(id, token!);
    expect(withdrawCalls()).toEqual([{ appSessionId: id, generation: 2 }]);
  });

  it('a draft-only patch asks nothing again; a patch that makes the intent ineligible withdraws', async () => {
    await harness();
    const id = await create(h.dir('declined'));
    await h.service.patch(id, { trust: 'declined' });
    await h.service.prestart(id);
    await h.service.patch(id, { draft: { doc: { type: 'doc' }, attachments: [], updatedAt: '2026-11-24T00:00:00.000Z' } });
    await h.service.work.settled(); // a request a patch asks is counted in the service's work
    expect(prestartCalls()).toHaveLength(1);
    await h.service.patch(id, { trust: 'unanswered' });
    await h.until(() => withdrawCalls().length === 1);
    expect(withdrawCalls()).toEqual([{ appSessionId: id, generation: 1 }]);
    expect(prestartCalls()).toHaveLength(1);
  });

  it('two windows: a withdraw arriving after the other window’s Send does nothing, and Send adopts', async () => {
    await harness();
    const id = await create();
    const { token } = await h.service.prestart(id); // window A
    expect(await h.service.startSession(id, { message: MESSAGE, options: {} })).toMatchObject({ status: 'starting' }); // window B
    await h.service.withdrawPrestart(id, token!); // window A picks another machine
    expect(await h.settled(id)).toMatchObject({ phase: 'ready' });
    expect(withdrawCalls()).toEqual([]);
    expect(h.host.adoptions).toHaveLength(1);
  });

  it('a discard ends the request: the host forgets the id, and the token withdraws nothing after', async () => {
    await harness();
    const id = await create();
    const { token } = await h.service.prestart(id);
    await h.service.discard(id);
    expect(h.host.forgotten).toContain(id);
    expect(h.host.prestarts.size).toBe(0);
    await h.service.withdrawPrestart(id, token!);
    expect(withdrawCalls()).toEqual([]);
  });
});

describe('a crash at each step of today’s order, with an adopted launch: what recovery makes of it is what it makes of today’s', () => {
  // What a restart leaves of the intent's attempt, without the ids (an adopted engine runs under its own id, today's under
  // the guards' pin): whether the intent stands and how, whether the record stands, and whether it is bound to the engine.
  let adoptedPin: string | null = null;
  let adoptedEngine: string | null = null;
  async function crashAt(step: 'sent' | 'pin' | 'launch' | 'send' | 'remove', adopted: boolean) {
    await harness();
    const id = await create();
    if (adopted) await h.service.prestart(id);
    let engineId: string | null = null;
    // the engine writes its transcript under its own id once the first message reaches it (never before, W3)
    h.host.onCall = (name) => {
      if (name !== 'session.send') return;
      engineId = h.host.table.get(id)!.engineSessionId;
      h.writeTranscript(h.work, engineId!);
    };
    if (step === 'remove') h.hangRemove = true;
    else if (step === 'sent') h.host.launchHangs = true; // the record, the reservation and the proof written; no answer
    else {
      h.hangPut = (intent) =>
        step === 'pin' ? intent.progress.launch === null && intent.progress.engineSessionId === h.host.table.get(id)?.engineSessionId && (!adopted || h.host.adoptions.length === 1)
        : step === 'launch' ? intent.progress.launch !== null && intent.progress.send === null
        : intent.progress.send !== null;
    }
    await h.service.startSession(id, { message: MESSAGE, options: {} });
    if (step === 'sent') await h.until(() => h.host.calledWith('session.launch').length === 1);
    else await h.until(() => h.gateReached);
    const running = h.host.table.get(id)?.engineSessionId ?? null;
    expect(h.host.adoptions).toHaveLength(adopted && step !== 'sent' ? 1 : 0);
    await h.restart();
    expect(h.host.launches).toEqual([]);
    expect(h.host.calledWith('session.send')).toEqual([]);
    const intent = intentFile(id);
    const record = h.index.sessions.get(id);
    if (adopted) [adoptedPin, adoptedEngine] = [intent?.progress.engineSessionId ?? null, running];
    return {
      intent: intent && { message: intent.message, failure: intent.progress.lastFailure?.message ?? null, launched: intent.progress.launch !== null, sent: intent.progress.send !== null },
      record: record && { boundToTheEngine: record.engineSessionId === running, bound: record.engineSessionId !== null },
      engineWrote: engineId !== null,
    };
  }

  it('with the launch sent and not answered (the record, the reservation and the proof written before it)', async () => {
    const today = await crashAt('sent', false);
    const adopted = await crashAt('sent', true);
    expect(today).toMatchObject({ intent: { failure: 'MAWS quit before the session started', launched: false }, record: null });
    expect(adopted).toEqual(today);
  });

  it('right after the answer, at the adopted id’s write (today: the answer given, progress.launch not yet written)', async () => {
    const today = await crashAt('launch', false);
    const adopted = await crashAt('pin', true);
    expect(today).toMatchObject({ intent: { failure: 'MAWS quit before the session started', launched: false, sent: false }, record: null });
    expect(adopted).toEqual(today); // the intent keeps the guards' pin, under which a retry launches afresh
  });

  it('at progress.launch: the intent already names the adopted engine', async () => {
    const today = await crashAt('launch', false);
    const adopted = await crashAt('launch', true);
    expect(adopted).toEqual(today);
    expect(adoptedPin).toBe(adoptedEngine);
  });

  it('at progress.send (the message with the engine, its transcript under the engine’s id)', async () => {
    const today = await crashAt('send', false);
    const adopted = await crashAt('send', true);
    expect(today).toMatchObject({ intent: null, record: { boundToTheEngine: true }, engineWrote: true });
    expect(adopted).toEqual(today);
  });

  it('at the intent’s removal after the handoff', async () => {
    const today = await crashAt('remove', false);
    const adopted = await crashAt('remove', true);
    expect(today).toMatchObject({ intent: null, record: { boundToTheEngine: true } });
    expect(adopted).toEqual(today);
  });
});

describe('the switches (D9)', () => {
  it('prestarts in launch mode index; under MAWS_E2E=1 only with MAWS_E2E_PRESTART=1; never in launch mode scenario (the stub source)', () => {
    expect(prestartSwitchedOn({}, 'index')).toBe(true);
    expect(prestartSwitchedOn({ MAWS_E2E: '1' }, 'index')).toBe(false);
    expect(prestartSwitchedOn({ MAWS_E2E: '1', MAWS_E2E_PRESTART: '1' }, 'index')).toBe(true);
    expect(prestartSwitchedOn({ MAWS_E2E_PRESTART: '1' }, 'scenario')).toBe(false);
    expect(prestartSwitchedOn({ MAWS_E2E: '1', MAWS_E2E_PRESTART: '1' }, 'scenario')).toBe(false);
  });
});
