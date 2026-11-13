// Step-up in main (P5-O10 M9; RL §5.6): main builds the action from the typed fields it is asked for, renders its text
// itself, has the person confirm that text through the injected confirmation (U5's winner; a fake here), and only then
// signs the action's canonical form with the step-up key. The renderer never supplies the bytes or the text.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  endorseDevice,
  generateSigningKey,
  isAction,
  keyId,
  signOrgState,
  SIGNING_DOMAINS,
  stateHash,
  verifyGenesis,
  verifyGrant,
  verifyStepUp,
  verifySuccessor,
  type Action,
  type Device,
  type Grant,
  type OrgState,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';

// Electron's systemPreferences, faked: no test calls the real promptTouchID, so none raises a system prompt.
const touchID = vi.hoisted(() => ({ reasons: [] as string[], answer: async (): Promise<void> => {} }));
vi.mock('electron', () => ({
  systemPreferences: {
    promptTouchID: (reason: string) => {
      touchID.reasons.push(reason);
      return touchID.answer();
    },
  },
}));

import { createRecordSigner, createStateSigner, createStepUp, promptTouchIDConfirmation, renderAction, renderActions, type Confirm, type StepUpPrompt } from './step-up';

const DEVICE = { org: 'org-step-up', device: 'dev-mac' };
const REF = 'mref-test-0000001';
const NOW = new Date('2026-10-27T12:00:00.000Z');

const spawn = { machine: REF, action: 'sminos.spawn', args: { checkout: '/Users/owner/w', permission_mode: 'default', brief: 'fix the tests' } };

function harness(answer: Awaited<ReturnType<Confirm>> = { ok: true }, now = () => NOW) {
  const prompts: StepUpPrompt[] = [];
  const confirm: Confirm = async (prompt) => {
    prompts.push(prompt);
    return answer;
  };
  return { prompts, confirm, now };
}

let key: SigningKey;
const stepUpKey = async () => (key ??= await generateSigningKey());

describe('a step-up', () => {
  it('signs the action main built, after the person confirmed the text main rendered from it', async () => {
    const h = harness();
    const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), confirm: h.confirm, now: h.now });
    const signed = await stepUp.sign(spawn);
    if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
    const action = signed.action;
    expect(isAction(action)).toBe(true);
    expect(action).toMatchObject({ v: 1, org: DEVICE.org, device: DEVICE.device, machine: REF, action: 'sminos.spawn', args: spawn.args, created: NOW.toISOString(), opCreated: NOW.toISOString() });
    expect(await verifyStepUp(action, (await stepUpKey()).pub)).toEqual({ ok: true });
    // What was confirmed is the signed action's own rendering: nothing signed went unshown.
    expect(h.prompts).toEqual([renderAction(action)]);
    expect(h.prompts[0].text).toContain('sminos.spawn');
    expect(h.prompts[0].text).toContain('"/Users/owner/w"');
    expect(h.prompts[0].text).toContain('"fix the tests"');
  });

  it('signs nothing when the person cancels, or the confirmation is unavailable', async () => {
    for (const reason of ['cancelled', 'unavailable', 'failed'] as const) {
      const h = harness({ ok: false, reason });
      const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), confirm: h.confirm, now: h.now });
      expect(await stepUp.sign(spawn)).toEqual({ ok: false, reason });
      expect(h.prompts).toHaveLength(1);
    }
  });

  it('signs nothing when the confirmation throws', async () => {
    const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), confirm: () => Promise.reject(new Error('LAContext failed')), now: () => NOW });
    expect(await stepUp.sign(spawn)).toEqual({ ok: false, reason: 'failed' });
  });

  it('stamps the action when the person confirms, so a slow confirmation is not sent stale', async () => {
    let clock = NOW.getTime();
    const later = NOW.getTime() + 5 * 60_000;
    const stepUp = createStepUp({
      device: DEVICE,
      key: await stepUpKey(),
      confirm: async () => {
        clock = later;
        return { ok: true };
      },
      now: () => new Date(clock),
    });
    const signed = await stepUp.sign(spawn);
    if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
    expect(signed.action.created).toBe(new Date(later).toISOString());
    expect(signed.action.opCreated).toBe(new Date(later).toISOString());
  });

  it('keeps a reseal’s opId and opCreated, so the executing side sees one operation', async () => {
    const h = harness();
    const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), confirm: h.confirm, now: h.now });
    const opCreated = new Date(NOW.getTime() - 30_000).toISOString();
    const signed = await stepUp.sign({ ...spawn, opId: 'op-reseal-0123456789', opCreated });
    if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
    expect([signed.action.opId, signed.action.opCreated]).toEqual(['op-reseal-0123456789', opCreated]);
  });

  it('takes nothing from a request but its typed fields: a caller-supplied signature, nonce, time or device is dropped', async () => {
    const h = harness();
    const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), confirm: h.confirm, now: h.now });
    const smuggled = { ...spawn, device: 'dev-other', org: 'org-other', nonce: 'BBBBBBBBBBBBBBBBBBBBBB', created: '2020-01-01T00:00:00.000Z', stepUp: 'x', webauthn: {} };
    const signed = await stepUp.sign(smuggled as typeof spawn);
    if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
    expect(signed.action).toMatchObject({ org: DEVICE.org, device: DEVICE.device, created: NOW.toISOString() });
    expect(signed.action.nonce).not.toBe(smuggled.nonce);
    expect(signed.action.webauthn).toBeUndefined();
    expect(await verifyStepUp(signed.action, (await stepUpKey()).pub)).toEqual({ ok: true });
  });

  it('signs what was shown even when the caller changes its request, or the device identity, while the person decides', async () => {
    const request = {
      machine: REF,
      action: 'sminos.spawn',
      args: { checkout: '/Users/owner/w', permission_mode: 'default', brief: 'fix the tests', nested: { mode: 'plan' } },
      session: 'sess-1',
      context: { lane: 'A' as const, session: 'sess-1', launch: 'launch-1' },
      requestDigest: { session: 'sess-1', request: 'toolu_1', tool: 'Bash', input_sha256: 'a'.repeat(64) },
    };
    const device = { ...DEVICE };
    const prompts: StepUpPrompt[] = [];
    const stepUp = createStepUp({
      device,
      key: await stepUpKey(),
      now: () => NOW,
      confirm: async (prompt) => {
        prompts.push(prompt);
        request.args.permission_mode = 'bypassPermissions';
        request.args.brief = 'rm -rf ~';
        request.args.nested.mode = 'bypassPermissions';
        request.context.launch = 'launch-2';
        request.requestDigest.tool = 'Write';
        device.device = 'dev-other';
        device.org = 'org-other';
        return { ok: true };
      },
    });
    const signed = await stepUp.sign(request);
    if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
    expect(signed.action).toMatchObject({
      org: DEVICE.org,
      device: DEVICE.device,
      args: { permission_mode: 'default', brief: 'fix the tests', nested: { mode: 'plan' } },
      context: { launch: 'launch-1' },
      requestDigest: { tool: 'Bash' },
    });
    expect(prompts).toEqual([renderAction(signed.action)]);
    expect(await verifyStepUp(signed.action, (await stepUpKey()).pub)).toEqual({ ok: true });
  });

  it('seals the opCreated the request had when the person was asked, whatever the caller sets it to meanwhile', async () => {
    const given = new Date(NOW.getTime() - 30_000).toISOString();
    const resealed: { machine: string; action: string; args: Record<string, unknown>; opId: string; opCreated?: string } = { ...spawn, opId: 'op-reseal-0123456789', opCreated: given };
    const fresh: { machine: string; action: string; args: Record<string, unknown>; opCreated?: string } = { ...spawn };
    const stepUp = createStepUp({
      device: DEVICE,
      key: await stepUpKey(),
      now: () => NOW,
      confirm: async () => {
        resealed.opCreated = '2020-01-01T00:00:00.000Z';
        fresh.opCreated = '2020-01-01T00:00:00.000Z';
        return { ok: true };
      },
    });
    // both are built before either confirmation runs
    const [kept, stamped] = await Promise.all([stepUp.sign(resealed), stepUp.sign(fresh)]);
    if (!kept.ok || !stamped.ok) throw new Error('refused');
    expect(kept.action.opCreated).toBe(given);
    expect(stamped.action.opCreated).toBe(NOW.toISOString());
    expect(await verifyStepUp(kept.action, (await stepUpKey()).pub)).toEqual({ ok: true });
  });

  it('treats an arg whose value is undefined as absent, as the canonical form the signature covers does', async () => {
    const h = harness();
    const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), confirm: h.confirm, now: h.now });
    const signed = await stepUp.sign({ ...spawn, args: { ...spawn.args, worktree: undefined } });
    if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
    expect('worktree' in signed.action.args).toBe(false);
    expect(h.prompts[0].text).not.toContain('worktree');
    expect(h.prompts).toEqual([renderAction(signed.action)]);
    expect(renderAction({ ...signed.action, args: { ...signed.action.args, worktree: undefined } })).toEqual(h.prompts[0]);
  });

  it('refuses a request whose fields make no action, before asking anyone', async () => {
    const h = harness();
    const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), confirm: h.confirm, now: h.now });
    expect(await stepUp.sign({ ...spawn, machine: 'no' })).toEqual({ ok: false, reason: 'malformed' });
    expect(await stepUp.sign({ ...spawn, session: 'sess-1' })).toEqual({ ok: false, reason: 'malformed' }); // a session needs its context
    expect(await stepUp.sign({ ...spawn, args: { ...spawn.args, extra: 1n } as unknown as Record<string, unknown> })).toEqual({ ok: false, reason: 'malformed' });
    expect(h.prompts).toEqual([]);
  });
});

// P5 O8 M6b: a Share sheet's save is several record acts, signed under one confirmation (Interfaces §Q, `signActions`).
describe('several step-ups under one confirmation', () => {
  const MREF = 'mini_0000000000000000000000';
  const access = { machine: MREF, action: 'record.access', args: { appSessionId: 'app-1', access: 'private' } };
  const share = { machine: MREF, action: 'record.shares', args: { appSessionId: 'app-1', member: 'm-ana', grade: 'view' } };
  const unshare = { machine: MREF, action: 'record.shares', args: { appSessionId: 'app-1', member: 'm-ben', grade: null } };

  it('asks once, listing every act, then signs each in order, each verifying under the step-up key', async () => {
    const h = harness();
    const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), confirm: h.confirm, now: h.now });
    const signed = await stepUp.signActions([access, share, unshare]);
    if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
    expect(h.prompts).toHaveLength(1);
    expect(signed.actions.map((a) => [a.action, a.args])).toEqual([access, share, unshare].map((r) => [r.action, r.args]));
    for (const action of signed.actions) {
      expect(isAction(action)).toBe(true);
      expect(action).toMatchObject({ org: DEVICE.org, device: DEVICE.device, machine: MREF, created: NOW.toISOString() });
      expect(await verifyStepUp(action, (await stepUpKey()).pub)).toEqual({ ok: true });
    }
    expect(new Set(signed.actions.map((a) => a.opId)).size).toBe(3);
    expect(new Set(signed.actions.map((a) => a.nonce)).size).toBe(3);
    // what was confirmed is every signed act's own rendering
    expect(h.prompts).toEqual([renderActions(signed.actions)]);
    for (const action of signed.actions) expect(h.prompts[0].text).toContain(renderAction(action).text);
    expect(h.prompts[0].summary).toBe(`3 actions on ${MREF}`); // S-13: with no org view held, the ref
  });

  it('signs none when the person cancels, the confirmation is unavailable, fails or throws', async () => {
    for (const reason of ['cancelled', 'unavailable', 'failed'] as const) {
      const h = harness({ ok: false, reason });
      const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), confirm: h.confirm, now: h.now });
      expect(await stepUp.signActions([access, share])).toEqual({ ok: false, reason });
      expect(h.prompts).toHaveLength(1);
    }
    const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), confirm: () => Promise.reject(new Error('LAContext failed')), now: () => NOW });
    expect(await stepUp.signActions([access])).toEqual({ ok: false, reason: 'failed' });
  });

  it('refuses before asking when any request makes no action, or there is none', async () => {
    const h = harness();
    const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), confirm: h.confirm, now: h.now });
    expect(await stepUp.signActions([access, { ...share, machine: 'no' }])).toEqual({ ok: false, reason: 'malformed' });
    expect(await stepUp.signActions([])).toEqual({ ok: false, reason: 'malformed' });
    expect(h.prompts).toEqual([]);
  });

  it('signs what was shown, keeps each opId it is given, and stamps every act when the person confirms', async () => {
    let clock = NOW.getTime();
    const later = NOW.getTime() + 90_000;
    const request = { ...share, args: { ...share.args }, opId: 'op-given-0123456789', opCreated: NOW.toISOString() };
    const prompts: StepUpPrompt[] = [];
    const stepUp = createStepUp({
      device: DEVICE,
      key: await stepUpKey(),
      now: () => new Date(clock),
      confirm: async (prompt) => {
        prompts.push(prompt);
        request.args.grade = 'approve';
        clock = later;
        return { ok: true };
      },
    });
    const signed = await stepUp.signActions([access, request]);
    if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
    expect(signed.actions[1]).toMatchObject({ args: { grade: 'view' }, opId: 'op-given-0123456789', opCreated: NOW.toISOString(), created: new Date(later).toISOString() });
    expect(signed.actions[0]).toMatchObject({ opCreated: new Date(later).toISOString(), created: new Date(later).toISOString() });
    expect(prompts).toEqual([renderActions(signed.actions)]);
  });

  it('seals each opCreated as it was when the person was asked, whatever the caller sets meanwhile', async () => {
    const given = new Date(NOW.getTime() - 30_000).toISOString();
    const later = NOW.getTime() + 5_000;
    let clock = NOW.getTime();
    const resealed: { machine: string; action: string; args: Record<string, unknown>; opId: string; opCreated?: string } = { ...share, opId: 'op-given-0123456789', opCreated: given };
    const fresh: { machine: string; action: string; args: Record<string, unknown>; opCreated?: string } = { ...access };
    const stepUp = createStepUp({
      device: DEVICE,
      key: await stepUpKey(),
      now: () => new Date(clock),
      confirm: async () => {
        resealed.opCreated = '2020-01-01T00:00:00.000Z';
        fresh.opCreated = '2020-01-01T00:00:00.000Z';
        clock = later;
        return { ok: true };
      },
    });
    const signed = await stepUp.signActions([fresh, resealed]);
    if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
    expect(signed.actions.map((a) => a.opCreated)).toEqual([new Date(later).toISOString(), given]);
  });

  it('never signs unasked, not even a spawn the single path would exempt', async () => {
    const h = harness();
    const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), confirm: h.confirm, now: h.now, org: () => null });
    expect((await stepUp.signActions([{ machine: REF, action: 'session.spawn', args: { checkout: '/w' } }])).ok).toBe(true);
    expect(h.prompts).toHaveLength(1);
  });
});

describe('the rendered text of several acts', () => {
  it('is one act’s own text for one, and each act’s text under its place for more, naming each machine once', async () => {
    const h = harness();
    const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), confirm: h.confirm, now: h.now });
    const signed = await stepUp.signActions([
      { machine: 'mini_0000000000000000000000', action: 'record.access', args: { session: 'eng-1', access: 'listed' } },
      { machine: 'vm_00000000000000000000000', action: 'record.access', args: { session: 'eng-2', access: 'listed' } },
    ]);
    if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
    expect(renderActions(signed.actions.slice(0, 1))).toEqual(renderAction(signed.actions[0]));
    const both = renderActions(signed.actions);
    expect(both.summary).toBe('2 actions on mini_0000000000000000000000, vm_00000000000000000000000');
    expect(both.text).toBe(`1 of 2\n${renderAction(signed.actions[0]).text}\n\n2 of 2\n${renderAction(signed.actions[1]).text}`);
  });
});

describe('the rendered text', () => {
  const base: Action = {
    v: 1,
    org: DEVICE.org,
    machine: REF,
    device: DEVICE.device,
    opId: 'op-0123456789abcdef',
    opCreated: NOW.toISOString(),
    action: 'session.answer',
    session: 'app-session-1',
    context: { lane: 'B', launchId: 'launch-1', engineSessionId: 'engine-1' },
    args: { requestId: 'req-1', answer: { behavior: 'allow' } },
    requestDigest: { session: 'engine-1', request: 'toolu_1', tool: 'Bash', input_sha256: 'a'.repeat(64) },
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    created: NOW.toISOString(),
  };

  it('shows every field the person is agreeing to, and a short summary for the system prompt', () => {
    const { summary, text } = renderAction(base);
    expect(summary).toBe(`Approve a request on ${REF}`); // S-13's sentence; the ref, with no org view
    for (const shown of ['session.answer', REF, 'app-session-1', 'launch-1', 'engine-1', 'toolu_1', 'Bash', 'a'.repeat(64), 'requestId: "req-1"', 'answer: {"behavior":"allow"}']) {
      expect(text).toContain(shown);
    }
  });

  it('is the same whatever the reseal changes (nonce, time, opId), and differs when a signed field differs', () => {
    const reseal = { ...base, opId: 'op-another-0123456789', nonce: 'BBBBBBBBBBBBBBBBBBBBBB', created: new Date(NOW.getTime() + 1000).toISOString() };
    expect(renderAction(reseal)).toEqual(renderAction(base));
    expect(renderAction({ ...base, args: { ...base.args, answer: { behavior: 'deny' } } }).text).not.toBe(renderAction(base).text);
  });

  it('keeps each value on its own line: a line break, a bidi override or another control in a value is escaped', () => {
    const forged = { ...base, args: { brief: 'ok\nMachine: elsewhere', label: 'abc\u202Edef', 'odd\nkey': 1 } };
    const { text } = renderAction(forged);
    const lines = text.split('\n');
    expect(lines.filter((line) => line.startsWith('Machine:'))).toEqual([`Machine: ${REF}`]);
    expect(text).toContain('brief: "ok\\nMachine: elsewhere"');
    expect(text).toContain('label: "abc\\u202edef"');
    expect(text).toContain('"odd\\nkey": 1');
    expect(text).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  });
});

describe('the confirmation main uses: promptTouchID (U5)', () => {
  const prompt: StepUpPrompt = { summary: 'Start a terminal session on mini', text: `Action: sminos.spawn\nMachine: mini (${REF})` };

  beforeEach(() => {
    touchID.reasons.length = 0;
    touchID.answer = async () => {};
  });

  it('asks with the summary as the reason, and confirms when the person authenticates', async () => {
    const reasons: string[] = [];
    const confirm = promptTouchIDConfirmation({ promptTouchID: async (reason) => void reasons.push(reason) });
    expect(await confirm(prompt)).toEqual({ ok: true });
    expect(reasons).toEqual([prompt.summary]);
  });

  it('refuses when the prompt is rejected: a cancel, or any failure to authenticate', async () => {
    // What macOS answered to the spike's cancel (Korean locale): Electron rejects with the localized description alone.
    const confirm = promptTouchIDConfirmation({ promptTouchID: () => Promise.reject(new Error('인증이 취소되었습니다.')) });
    expect(await confirm(prompt)).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('is what a step-up uses when main injects no confirmation', async () => {
    const stepUp = createStepUp({ device: DEVICE, key: await stepUpKey(), now: () => NOW });
    const signed = await stepUp.sign(spawn);
    if (!signed.ok) throw new Error(`refused: ${signed.reason}`);
    expect(touchID.reasons).toEqual([renderAction(signed.action).summary]);
    expect(await verifyStepUp(signed.action, (await stepUpKey()).pub)).toEqual({ ok: true });

    touchID.answer = () => Promise.reject(new Error('Authentication canceled.'));
    expect(await stepUp.sign(spawn)).toEqual({ ok: false, reason: 'cancelled' });
    expect(touchID.reasons).toHaveLength(2);
  });
});

describe('a state signer (M3: the org state, signed with the step-up key behind Touch ID)', () => {
  const MEMBER = '0123456789abcdef0123456789abcdef';
  const prompt: StepUpPrompt = { summary: 'Re-sign the org state (no change)', text: 'Version: 1\nNo change' };

  /** A genesis state whose one root is `key`, so `verifyGenesis` checks the signature against it. */
  async function genesisOf(key: SigningKey): Promise<OrgState> {
    const recovery = await generateSigningKey();
    return {
      org: 'org-state-signer',
      version: 1,
      prev: null,
      issued: NOW.toISOString(),
      root: { keys: [await keyId(key.pub)], recoveryPub: recovery.pub },
      members: [{ id: MEMBER, email: 'owner@example.com', role: 'admin', devices: [{ id: 'dev-mac', class: 'native-mac', keyStorage: 'software', channelPub: (await generateSigningKey()).pub, stepUpPub: key.pub }] }],
      machines: [],
      machineNames: [],
      retired: [],
      revoked: [],
      delegations: [],
      projects: [],
    };
  }

  /** Counts the signatures WebCrypto makes, and when: the step-up key signs only through `crypto.subtle.sign`. */
  function signatures() {
    const spy = vi.spyOn(crypto.subtle, 'sign');
    return { count: () => spy.mock.calls.length, restore: () => spy.mockRestore() };
  }

  it('names its key by the step-up key id the org state lists in root.keys', async () => {
    const signer = await createStateSigner({ key: await stepUpKey(), confirm: harness().confirm });
    expect(signer.kid).toBe(await keyId((await stepUpKey()).pub));
  });

  it('asks the confirmation with the prompt it is given, and only then signs the state', async () => {
    const state = await genesisOf(await stepUpKey());
    const sigs = signatures();
    try {
      const asked: { prompt: StepUpPrompt; signedBefore: number }[] = [];
      const signer = await createStateSigner({
        key: await stepUpKey(),
        confirm: async (shown) => {
          asked.push({ prompt: shown, signedBefore: sigs.count() });
          return { ok: true };
        },
      });
      const result = await signer.sign(state, prompt);
      if (!result.ok) throw new Error(`refused: ${result.reason}`);
      expect(asked).toEqual([{ prompt, signedBefore: 0 }]);
      expect(sigs.count()).toBe(1);
      expect(result.signed.state).toEqual(state);
      expect(result.signed.sigs.map((sig) => sig.kid)).toEqual([signer.kid]);
      expect(await verifyGenesis(result.signed)).toEqual({ ok: true });
    } finally {
      sigs.restore();
    }
  });

  it('signs nothing when the person cancels, the confirmation is unavailable or fails, or it throws', async () => {
    const state = await genesisOf(await stepUpKey());
    const answers: Confirm[] = [
      ...(['cancelled', 'unavailable', 'failed'] as const).map((reason): Confirm => async () => ({ ok: false, reason })),
      () => Promise.reject(new Error('LAContext failed')),
    ];
    const sigs = signatures();
    try {
      for (const confirm of answers) {
        const signer = await createStateSigner({ key: await stepUpKey(), confirm });
        expect(await signer.sign(state, prompt)).toEqual({ ok: false, reason: 'cancelled' });
      }
      expect(sigs.count()).toBe(0);
    } finally {
      sigs.restore();
    }
  });

  it('signs the state as it was when the person was asked, even if the caller changes it meanwhile', async () => {
    const state = await genesisOf(await stepUpKey());
    const asked = structuredClone(state);
    const signer = await createStateSigner({
      key: await stepUpKey(),
      confirm: async () => {
        state.members[0]!.role = 'member';
        state.root.keys.push('AAAAAAAAAAAAAAAAAAAAAA');
        state.issued = '2030-01-01T00:00:00.000Z';
        return { ok: true };
      },
    });
    const result = await signer.sign(state, prompt);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(result.signed.state).toEqual(asked);
    expect(await verifyGenesis(result.signed)).toEqual({ ok: true });
  });

  describe('endorsing a device inside the same confirmation (M4a: pairing your own device)', () => {
    /** The genesis signed by `key`, and its successor adding `fresh` (unendorsed) to the member `key`'s device is under. */
    async function adding(): Promise<{ head: SignedOrgState; next: OrgState; fresh: Device }> {
      const genesis = await genesisOf(await stepUpKey());
      const head = await signOrgState(genesis, [await stepUpKey()]);
      const fresh: Device = { id: 'dev-new', class: 'native-mac', keyStorage: 'software', channelPub: (await generateSigningKey()).pub, stepUpPub: (await generateSigningKey()).pub };
      const next = structuredClone(genesis);
      next.version = 2;
      next.prev = await stateHash(genesis);
      next.members[0]!.devices.push(fresh);
      return { head, next, fresh };
    }

    it('asks once, then endorses the named device with the step-up key and signs the state: the endorsement verifies', async () => {
      const { head, next, fresh } = await adding();
      const sigs = signatures();
      try {
        const asked: number[] = [];
        const signer = await createStateSigner({ key: await stepUpKey(), confirm: async () => (asked.push(sigs.count()), { ok: true }) });
        const result = await signer.sign(next, prompt, { endorse: [{ member: MEMBER, device: fresh.id }] });
        if (!result.ok) throw new Error(`refused: ${result.reason}`);
        expect(asked).toEqual([0]); // one confirmation, before either signature
        expect(sigs.count()).toBe(2); // the endorsement, then the state
        const listed = result.signed.state.members[0]!.devices.find((d) => d.id === fresh.id)!;
        expect(listed.endorsement?.kid).toBe(signer.kid);
        // The package's verdict checks the endorsement under the member's own step-up key in the head.
        expect(await verifySuccessor(head, result.signed, [])).toEqual({ ok: true });
        // The caller's state is not touched: the endorsement is on the copy that was signed.
        expect(next.members[0]!.devices.find((d) => d.id === fresh.id)!.endorsement).toBeUndefined();
      } finally {
        sigs.restore();
      }
    });

    it('replaces an endorsement the caller left on the device, so only its own key endorses what it signs', async () => {
      const { head, next, fresh } = await adding();
      const stranger = await generateSigningKey();
      next.members[0]!.devices.find((d) => d.id === fresh.id)!.endorsement = await endorseDevice(next.org, MEMBER, fresh, stranger.privateKey, stranger.pub);
      const signer = await createStateSigner({ key: await stepUpKey(), confirm: harness().confirm });
      const result = await signer.sign(next, prompt, { endorse: [{ member: MEMBER, device: fresh.id }] });
      if (!result.ok) throw new Error(`refused: ${result.reason}`);
      expect(await verifySuccessor(head, result.signed, [])).toEqual({ ok: true });
    });

    it('endorses and signs nothing when the person cancels', async () => {
      const { next, fresh } = await adding();
      const sigs = signatures();
      try {
        const signer = await createStateSigner({ key: await stepUpKey(), confirm: async () => ({ ok: false, reason: 'cancelled' }) });
        expect(await signer.sign(next, prompt, { endorse: [{ member: MEMBER, device: fresh.id }] })).toEqual({ ok: false, reason: 'cancelled' });
        expect(sigs.count()).toBe(0);
      } finally {
        sigs.restore();
      }
    });

    it('endorses and signs nothing when the change ended while the person was asked (`live` says no after a yes)', async () => {
      const { next, fresh } = await adding();
      const sigs = signatures();
      try {
        let live = true;
        const checked: boolean[] = [];
        const signer = await createStateSigner({ key: await stepUpKey(), confirm: async () => ((live = false), { ok: true }) });
        const result = await signer.sign(next, prompt, { endorse: [{ member: MEMBER, device: fresh.id }], live: () => (checked.push(live), live) });
        expect(result).toEqual({ ok: false, reason: 'cancelled' });
        expect(checked).toEqual([false]); // read once, after the confirmation
        expect(sigs.count()).toBe(0);
      } finally {
        sigs.restore();
      }
    });

    it('refuses, before asking, to endorse a device the state does not list under the named member', async () => {
      const { next, fresh } = await adding();
      const h = harness();
      const signer = await createStateSigner({ key: await stepUpKey(), confirm: h.confirm });
      await expect(signer.sign(next, prompt, { endorse: [{ member: MEMBER, device: 'dev-absent' }] })).rejects.toThrow(/dev-absent/);
      await expect(signer.sign(next, prompt, { endorse: [{ member: 'ffffffffffffffffffffffffffffffff', device: fresh.id }] })).rejects.toThrow(/dev-new/);
      expect(h.prompts).toEqual([]);
    });
  });

  it('asks through promptTouchID when main injects no confirmation', async () => {
    touchID.reasons.length = 0;
    touchID.answer = async () => {};
    const signer = await createStateSigner({ key: await stepUpKey() });
    const state = await genesisOf(await stepUpKey());
    const result = await signer.sign(state, prompt);
    expect(result.ok).toBe(true);
    expect(touchID.reasons).toEqual([prompt.summary]);

    touchID.answer = () => Promise.reject(new Error('Authentication canceled.'));
    expect(await signer.sign(state, prompt)).toEqual({ ok: false, reason: 'cancelled' });
    expect(touchID.reasons).toHaveLength(2);
  });
});

describe('a record signer (P5 O8 M4b: a grant, signed with the step-up key behind one confirmation)', () => {
  const MEMBER = '0123456789abcdef0123456789abcdef';
  const OTHER = 'fedcba9876543210fedcba9876543210';
  const MACHINE = 'mref-record-00001';
  const prompt: StepUpPrompt = { summary: 'Grant spawn on mini to bea@example.com', text: 'Machine: mini\nMember: bea@example.com\nRights: spawn' };

  /** A state whose member MEMBER owns MACHINE through a device holding `key` as its step-up key, and lists OTHER. */
  async function owning(key: SigningKey): Promise<{ state: OrgState; machineKid: string }> {
    const machinePub = (await generateSigningKey()).pub;
    const device = { id: 'dev-mac', class: 'native-mac' as const, keyStorage: 'software' as const, channelPub: (await generateSigningKey()).pub, stepUpPub: key.pub };
    const state: OrgState = {
      org: 'org-record-signer',
      version: 3,
      prev: null,
      issued: NOW.toISOString(),
      root: { keys: [], recoveryPub: (await generateSigningKey()).pub },
      members: [
        { id: MEMBER, email: 'owner@example.com', role: 'member', devices: [device] },
        { id: OTHER, email: 'bea@example.com', role: 'member', devices: [] },
      ],
      machines: [{ name: 'mini', ref: MACHINE, pub: machinePub, owners: [MEMBER] }],
      machineNames: [{ name: 'mini', ref: MACHINE }],
      retired: [],
      revoked: [],
      delegations: [],
      projects: [],
    };
    return { state, machineKid: await keyId(machinePub) };
  }
  const grantOf = (state: OrgState, machineKid: string): Grant => ({ org: state.org, machine: MACHINE, machineKey: machineKid, member: OTHER, rights: ['spawn'], version: 1, issued: NOW.toISOString() });

  function signatures() {
    const spy = vi.spyOn(crypto.subtle, 'sign');
    return { count: () => spy.mock.calls.length, restore: () => spy.mockRestore() };
  }

  it('names its key by the step-up key id, asks once with the prompt it is given, then signs a grant that verifies under that key', async () => {
    const { state, machineKid } = await owning(await stepUpKey());
    const sigs = signatures();
    try {
      const asked: { prompt: StepUpPrompt; signedBefore: number }[] = [];
      const signer = await createRecordSigner({ key: await stepUpKey(), confirm: async (shown) => (asked.push({ prompt: shown, signedBefore: sigs.count() }), { ok: true }) });
      expect(signer.kid).toBe(await keyId((await stepUpKey()).pub));
      const body = grantOf(state, machineKid);
      const result = await signer.sign(SIGNING_DOMAINS.grant, body, prompt);
      if (!result.ok) throw new Error(`refused: ${result.reason}`);
      expect(asked).toEqual([{ prompt, signedBefore: 0 }]);
      expect(sigs.count()).toBe(1);
      expect(result.signed.body).toEqual(body);
      expect(result.signed.sig.kid).toBe(signer.kid);
      expect(await verifyGrant(state, result.signed, undefined, NOW)).toEqual({ ok: true });
    } finally {
      sigs.restore();
    }
  });

  it('signs nothing when the person cancels, the confirmation is unavailable or fails, or it throws', async () => {
    const { state, machineKid } = await owning(await stepUpKey());
    const answers: Confirm[] = [
      ...(['cancelled', 'unavailable', 'failed'] as const).map((reason): Confirm => async () => ({ ok: false, reason })),
      () => Promise.reject(new Error('LAContext failed')),
    ];
    const sigs = signatures();
    try {
      for (const confirm of answers) {
        const signer = await createRecordSigner({ key: await stepUpKey(), confirm });
        expect(await signer.sign(SIGNING_DOMAINS.grant, grantOf(state, machineKid), prompt)).toEqual({ ok: false, reason: 'cancelled' });
      }
      expect(sigs.count()).toBe(0);
    } finally {
      sigs.restore();
    }
  });

  it('signs nothing when what the person was asked about ended meanwhile (`live` says no after a yes), reading it once', async () => {
    const { state, machineKid } = await owning(await stepUpKey());
    const sigs = signatures();
    try {
      let live = true;
      const checked: boolean[] = [];
      const signer = await createRecordSigner({ key: await stepUpKey(), confirm: async () => ((live = false), { ok: true }) });
      expect(await signer.sign(SIGNING_DOMAINS.grant, grantOf(state, machineKid), prompt, { live: () => (checked.push(live), live) })).toEqual({ ok: false, reason: 'cancelled' });
      expect(checked).toEqual([false]);
      expect(sigs.count()).toBe(0);
    } finally {
      sigs.restore();
    }
  });

  it('signs the copy taken before the person was asked: a change to the caller’s body meanwhile is not signed', async () => {
    const { state, machineKid } = await owning(await stepUpKey());
    const body = grantOf(state, machineKid);
    const signer = await createRecordSigner({
      key: await stepUpKey(),
      confirm: async () => {
        body.rights.push('shell');
        body.member = MEMBER;
        return { ok: true };
      },
    });
    const result = await signer.sign(SIGNING_DOMAINS.grant, body, prompt);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(result.signed.body).toMatchObject({ member: OTHER, rights: ['spawn'] });
    expect(await verifyGrant(state, result.signed, undefined, NOW)).toEqual({ ok: true });
  });

  it('signs several records under one confirmation, each in the order given, or none', async () => {
    const { state, machineKid } = await owning(await stepUpKey());
    const first = grantOf(state, machineKid);
    const second = { ...grantOf(state, machineKid), member: MEMBER, rights: ['shell' as const], version: 4 };
    const h = harness();
    const signer = await createRecordSigner({ key: await stepUpKey(), confirm: h.confirm });
    const result = await signer.signMany(SIGNING_DOMAINS.grant, [first, second], prompt);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(h.prompts).toEqual([prompt]);
    expect(result.signed.map((s) => s.body)).toEqual([first, second]);
    for (const signed of result.signed) expect(await verifyGrant(state, signed, undefined, NOW)).toEqual({ ok: true });

    const sigs = signatures();
    try {
      const declined = await createRecordSigner({ key: await stepUpKey(), confirm: async () => ({ ok: false, reason: 'cancelled' }) });
      expect(await declined.signMany(SIGNING_DOMAINS.grant, [first, second], prompt)).toEqual({ ok: false, reason: 'cancelled' });
      expect(sigs.count()).toBe(0);
    } finally {
      sigs.restore();
    }
  });

  it('refuses, before asking, a domain that is not a record’s (an org state, an action) and an empty batch', async () => {
    const { state, machineKid } = await owning(await stepUpKey());
    const h = harness();
    const signer = await createRecordSigner({ key: await stepUpKey(), confirm: h.confirm });
    for (const domain of [SIGNING_DOMAINS.orgState, SIGNING_DOMAINS.action, SIGNING_DOMAINS.rl2]) {
      await expect(signer.sign(domain as typeof SIGNING_DOMAINS.grant, grantOf(state, machineKid), prompt)).rejects.toThrow(/not a record/);
    }
    await expect(signer.signMany(SIGNING_DOMAINS.grant, [], prompt)).rejects.toThrow(/nothing/);
    expect(h.prompts).toEqual([]);
  });
});
