// P5 O7 M10 B (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M10's Decisions, "No Touch ID for a spawn on a
// machine the member owns"): a `session.spawn` on a machine whose owners, in the org state main holds, include the
// member this device's step-up key belongs to is signed with that key and no prompt. Every other act main steps up
// still asks, and a declined prompt signs nothing. Nothing the renderer can put in a request moves that line: the
// exemption is judged from the action as built and the held head, never from a flag.
//
// The UX wave (U9, M2; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, "`signsUnasked` gains one name"):
// a `session.fork` in place on an owned machine is signed unasked too, by the same conditions; nothing else is.
import { describe, expect, it, vi } from 'vitest';
import {
  generateSigningKey,
  keyId,
  memoryOrgView,
  signOrgState,
  stateHash,
  verifyStepUp,
  type Device,
  type OrgState,
  type OrgView,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';

// Electron's systemPreferences, faked so no case can raise a real system prompt: every case injects its confirmation.
vi.mock('electron', () => ({ systemPreferences: { promptTouchID: () => Promise.reject(new Error('no Touch ID in these tests')) } }));

import { createStateSigner, createStepUp, type Confirm, type StepUpPrompt, type StepUpRequest } from './step-up';

const ORG = 'org-owned-spawn';
const ME = '11111111111111111111111111111111';
const OTHER = '22222222222222222222222222222222';
const ADMIN = '33333333333333333333333333333333';
const MINE = 'mref-mine-0000000001';
const THEIRS = 'mref-theirs-00000001';
const SHARED = 'mref-shared-00000001';
const ORGS = 'mref-orgs-0000000001';
const UNLISTED = 'mref-unlisted-000001';
const NOW = new Date('2026-11-05T06:00:00.000Z');

type Fixture = { me: SigningKey; admin: SigningKey; genesis: SignedOrgState };
let fixture: Fixture | undefined;

async function device(id: string, stepUp: SigningKey): Promise<Device> {
  return { id, class: 'native-mac', keyStorage: 'software', channelPub: (await generateSigningKey()).pub, stepUpPub: stepUp.pub };
}

/** One org: ME (a member) on dev-mac with this device's step-up key; OTHER; ADMIN, the root. Four machines. */
async function org(): Promise<Fixture> {
  if (fixture !== undefined) return fixture;
  const me = await generateSigningKey();
  const admin = await generateSigningKey();
  const machine = async (name: string, ref: string, owners: string[] | 'org') => ({ name, ref, pub: (await generateSigningKey()).pub, owners });
  const machines = [await machine('mine', MINE, [ME]), await machine('theirs', THEIRS, [OTHER]), await machine('shared', SHARED, [OTHER, ME]), await machine('orgs', ORGS, 'org')];
  const state: OrgState = {
    org: ORG,
    version: 1,
    prev: null,
    issued: '2026-11-01T00:00:00.000Z',
    root: { keys: [await keyId(admin.pub)], recoveryPub: (await generateSigningKey()).pub },
    members: [
      { id: ME, email: 'me@example.com', role: 'member', devices: [await device('dev-mac', me)] },
      { id: OTHER, email: 'other@example.com', role: 'member', devices: [await device('dev-other', await generateSigningKey())] },
      { id: ADMIN, email: 'admin@example.com', role: 'admin', devices: [await device('dev-admin', admin)] },
    ],
    machines,
    machineNames: machines.map(({ name, ref }) => ({ name, ref })),
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
  fixture = { me, admin, genesis: await signOrgState(state, [admin]) };
  return fixture;
}

/** The root's successor of `head`, edited. */
async function successor(head: SignedOrgState, admin: SigningKey, edit: (state: OrgState) => void): Promise<SignedOrgState> {
  const state = structuredClone(head.state);
  state.version += 1;
  state.prev = await stateHash(head.state);
  state.issued = '2026-11-02T00:00:00.000Z';
  edit(state);
  return signOrgState(state, [admin]);
}

function harness(answer: Awaited<ReturnType<Confirm>> = { ok: true }) {
  const prompts: StepUpPrompt[] = [];
  const confirm: Confirm = async (prompt) => (prompts.push(prompt), answer);
  return { prompts, confirm };
}

/** Counts what WebCrypto signs: the step-up key signs only through `crypto.subtle.sign`. */
async function counted<T>(run: () => Promise<T>): Promise<{ value: T; signatures: number }> {
  const spy = vi.spyOn(crypto.subtle, 'sign');
  try {
    const value = await run();
    return { value, signatures: spy.mock.calls.length };
  } finally {
    spy.mockRestore();
  }
}

async function signer(confirm: Confirm, view?: () => OrgView | null) {
  const { me, genesis } = await org();
  const held = memoryOrgView({ chain: [genesis] });
  return createStepUp({ device: { org: ORG, device: 'dev-mac' }, key: me, confirm, now: () => NOW, org: view ?? (() => held) });
}

const spawnOn = (machine: string): StepUpRequest => ({ machine, action: 'session.spawn', args: { cwd: '/Users/me/w', model: 'claude-opus-5-5', permissionMode: 'default' } });

describe('a session.spawn on a machine the member owns', () => {
  it('is signed with the step-up key and no prompt: the same signature any step-up makes', async () => {
    const h = harness();
    const stepUp = await signer(h.confirm);
    for (const machine of [MINE, SHARED]) {
      const signed = await stepUp.sign(spawnOn(machine));
      if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
      expect(signed.action).toMatchObject({ org: ORG, device: 'dev-mac', machine, action: 'session.spawn', args: spawnOn(machine).args });
      expect(await verifyStepUp(signed.action, (await org()).me.pub)).toEqual({ ok: true });
    }
    expect(h.prompts).toEqual([]);
  });

  it('is judged on the head main holds at signing: a newer head with other owners is judged again', async () => {
    const { genesis, admin } = await org();
    const view = memoryOrgView({ chain: [genesis] });
    const h = harness();
    const stepUp = await signer(h.confirm, () => view);
    expect((await stepUp.sign(spawnOn(THEIRS))).ok).toBe(true);
    expect(h.prompts.map((p) => p.summary)).toEqual(['Start a session on theirs']); // S-13: the machine by its name

    // ME becomes an owner of THEIRS, and stops being one of MINE
    const next = await successor(genesis, admin, (state) => {
      for (const m of state.machines) if (m.ref === THEIRS) m.owners = [OTHER, ME];
      for (const m of state.machines) if (m.ref === MINE) m.owners = [OTHER];
    });
    await view.advance([next], []);
    expect(view.head().state.version).toBe(2);

    h.prompts.length = 0;
    expect((await stepUp.sign(spawnOn(THEIRS))).ok).toBe(true);
    expect(h.prompts).toEqual([]);
    expect((await stepUp.sign(spawnOn(MINE))).ok).toBe(true);
    expect(h.prompts.map((p) => p.summary)).toEqual(['Start a session on mine']);
  });

  it('asks when main holds no org view (signed out, or none given)', async () => {
    const h = harness();
    const { me } = await org();
    expect((await (await signer(h.confirm, () => null)).sign(spawnOn(MINE))).ok).toBe(true);
    expect((await createStepUp({ device: { org: ORG, device: 'dev-mac' }, key: me, confirm: h.confirm, now: () => NOW }).sign(spawnOn(MINE))).ok).toBe(true);
    expect(h.prompts).toHaveLength(2);
  });

  it('asks when the held head lists this device under no member with this step-up key', async () => {
    const { genesis } = await org();
    const view = memoryOrgView({ chain: [genesis] });
    const h = harness();
    // dev-mac is ME's in the head, with another step-up key than the one signing: not ME's key, so not ME's machine
    const unlisted = createStepUp({ device: { org: ORG, device: 'dev-mac' }, key: await generateSigningKey(), confirm: h.confirm, now: () => NOW, org: () => view });
    expect((await unlisted.sign(spawnOn(MINE))).ok).toBe(true);
    // the head names ME's device dev-mac; this device calls itself another id
    const renamed = createStepUp({ device: { org: ORG, device: 'dev-elsewhere' }, key: (await org()).me, confirm: h.confirm, now: () => NOW, org: () => view });
    expect((await renamed.sign(spawnOn(MINE))).ok).toBe(true);
    // another org's device
    const foreign = createStepUp({ device: { org: 'org-another', device: 'dev-mac' }, key: (await org()).me, confirm: h.confirm, now: () => NOW, org: () => view });
    expect((await foreign.sign(spawnOn(MINE))).ok).toBe(true);
    expect(h.prompts).toHaveLength(3);
  });
});

const forkOn = (machine: string): StepUpRequest => ({ machine, action: 'session.fork', args: { appSessionId: 'app-session-1', target: { kind: 'inPlace' }, message: null, rewindTo: null } });

describe('a session.fork on a machine the member owns', () => {
  it('is signed with the step-up key and no prompt, as a spawn is', async () => {
    const h = harness();
    const stepUp = await signer(h.confirm);
    for (const machine of [MINE, SHARED]) {
      const signed = await stepUp.sign(forkOn(machine));
      if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
      expect(signed.action).toMatchObject({ org: ORG, device: 'dev-mac', machine, action: 'session.fork', args: forkOn(machine).args });
      expect(await verifyStepUp(signed.action, (await org()).me.pub)).toEqual({ ok: true });
    }
    expect(h.prompts).toEqual([]);
  });

  it('asks on another person’s machine, an org-owned one and an unlisted one, naming the machine; declined it signs nothing', async () => {
    const h = harness({ ok: false, reason: 'cancelled' });
    const stepUp = await signer(h.confirm);
    for (const machine of [THEIRS, ORGS, UNLISTED]) {
      const { value, signatures } = await counted(() => stepUp.sign(forkOn(machine)));
      expect([machine, value, signatures]).toEqual([machine, { ok: false, reason: 'cancelled' }, 0]);
    }
    expect(h.prompts.map((p) => p.summary)).toEqual(['Fork a session on theirs', 'Fork a session on orgs', `Fork a session on ${UNLISTED}`]);
  });

  it('asks when it carries any field of a session’s act: a session, a launch context or a request digest', async () => {
    const h = harness();
    const stepUp = await signer(h.confirm);
    const lane = { session: 'app-session-1', context: { lane: 'B' as const, launchId: 'launch-1', engineSessionId: 'engine-1' } };
    await stepUp.sign({ ...forkOn(MINE), ...lane });
    await stepUp.sign({ ...forkOn(MINE), requestDigest: { session: 'engine-1', request: 'toolu_1', tool: 'Bash', input_sha256: 'a'.repeat(64) } });
    expect(h.prompts).toHaveLength(2);
  });
});

describe('every other act keeps the prompt: each asks, and declined it signs nothing', () => {
  const answerLane = { session: 'app-session-1', context: { lane: 'B' as const, launchId: 'launch-1', engineSessionId: 'engine-1' } };
  const cases: Array<[string, StepUpRequest]> = [
    ['a spawn on a machine the member does not own', spawnOn(THEIRS)],
    ['a spawn on an org-owned machine, by a member who is not an admin', spawnOn(ORGS)],
    ['a spawn on a machine the held head does not list', spawnOn(UNLISTED)],
    [
      'an approval on a session the member does not own (main never exempts one, on any machine)',
      { machine: MINE, action: 'session.answer', ...answerLane, args: { requestId: 'req-1', answer: { behavior: 'allow' } }, requestDigest: { session: 'engine-1', request: 'toolu_1', tool: 'Bash', input_sha256: 'a'.repeat(64) } },
    ],
    ['an owner change', { machine: MINE, action: 'record.owners', ...answerLane, args: { add: true, member: OTHER } }],
    ['a share change', { machine: MINE, action: 'record.shares', ...answerLane, args: { member: OTHER, grade: 'converse' } }],
    ['a machine-admin act', { machine: MINE, action: 'session.projects.addFolder', args: { path: '/Users/me/w' } }],
    ["a non-owner's shell", { machine: THEIRS, action: 'pty.spawn', args: { cols: 80, rows: 24 } }],
    ['a shell on an owned machine (pty.spawn is no session.spawn)', { machine: MINE, action: 'pty.spawn', args: { cols: 80, rows: 24 } }],
    ["lane A's spawn (the ruling names session.spawn alone)", { machine: MINE, action: 'sminos.spawn', args: { checkout: '/Users/me/w' } }],
    ['a later launch', { machine: MINE, action: 'session.launch', args: {} }],
  ];

  it.each(cases)('%s', async (_, request) => {
    const h = harness({ ok: false, reason: 'cancelled' });
    const stepUp = await signer(h.confirm);
    const { value, signatures } = await counted(() => stepUp.sign(request));
    expect(value).toEqual({ ok: false, reason: 'cancelled' });
    expect(h.prompts).toHaveLength(1);
    expect(signatures).toBe(0);
  });

  it('the org state signed as a root', async () => {
    const { genesis, admin } = await org();
    const h = harness({ ok: false, reason: 'cancelled' });
    const states = await createStateSigner({ key: admin, confirm: h.confirm });
    const { value, signatures } = await counted(() => states.sign(genesis.state, { summary: 'Re-sign the org state (no change)', text: 'Version: 1' }));
    expect(value).toEqual({ ok: false, reason: 'cancelled' });
    expect(h.prompts).toHaveLength(1);
    expect(signatures).toBe(0);
  });
});

describe('nothing the renderer sends can skip the prompt', () => {
  // What a page could try to carry into a request: flags beside the fields, and claims inside the args.
  const flags = { confirm: false, stepUp: 'never', skipConfirmation: true, owned: true, owners: [ME], member: ME, exempt: true };
  const claims = { owned: true, owners: [ME], confirm: false, stepUp: 'never' };

  it('a spawn on a machine the member does not own, however its request is dressed, asks', async () => {
    const h = harness({ ok: false, reason: 'cancelled' });
    const stepUp = await signer(h.confirm);
    const request = { ...spawnOn(THEIRS), ...flags, args: { ...spawnOn(THEIRS).args, ...claims } } as StepUpRequest;
    const { value, signatures } = await counted(() => stepUp.sign(request));
    expect(value).toEqual({ ok: false, reason: 'cancelled' });
    expect(h.prompts).toHaveLength(1);
    expect(signatures).toBe(0);
  });

  it('another act on an owned machine, however dressed, asks; what is signed carries none of the flags', async () => {
    const h = harness();
    const stepUp = await signer(h.confirm);
    const request = { machine: MINE, action: 'session.projects.addFolder', args: { path: '/Users/me/w', ...claims }, ...flags } as StepUpRequest;
    const signed = await stepUp.sign(request);
    if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
    expect(h.prompts).toHaveLength(1);
    // `stepUp` is the action's own field, the signature: never the page's word
    for (const flag of Object.keys(flags).filter((name) => name !== 'stepUp')) expect(signed.action).not.toHaveProperty(flag);
    expect(await verifyStepUp(signed.action, (await org()).me.pub)).toEqual({ ok: true });
  });

  it('a name that only looks like session.spawn is never signed unasked', async () => {
    const h = harness();
    const stepUp = await signer(h.confirm);
    for (const action of ['session.spawn ', 'Session.spawn', 'session.spawn​', 'session.spawn.x', 'session.Spawn']) {
      const before = h.prompts.length;
      const signed = await stepUp.sign({ ...spawnOn(MINE), action });
      if (signed.ok) expect(h.prompts.length, action).toBe(before + 1);
    }
  });

  it('a session.spawn on an owned machine that names a session, a launch or a request (a shape the app never makes) asks', async () => {
    const h = harness();
    const stepUp = await signer(h.confirm);
    const lane = { session: 'app-session-1', context: { lane: 'B' as const, launchId: 'launch-1', engineSessionId: 'engine-1' } };
    await stepUp.sign({ ...spawnOn(MINE), ...lane });
    await stepUp.sign({ ...spawnOn(MINE), requestDigest: { session: 'engine-1', request: 'toolu_1', tool: 'Bash', input_sha256: 'a'.repeat(64) } });
    expect(h.prompts).toHaveLength(2);
  });
});
