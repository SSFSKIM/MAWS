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
  stateHash,
  verifyGenesis,
  verifyStepUp,
  verifySuccessor,
  type Action,
  type Device,
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

import { createStateSigner, createStepUp, promptTouchIDConfirmation, renderAction, type Confirm, type StepUpPrompt } from './step-up';

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
    expect(summary).toBe(`session.answer on machine ${REF}`);
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
  const prompt: StepUpPrompt = { summary: `sminos.spawn on machine ${REF}`, text: `Action: sminos.spawn\nMachine: ${REF}` };

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
