// A session's reach from the app (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b's Proves for
// policy.test.ts, and Interfaces §Q): the record acts' shapes for each target, one confirmation per save, the acts sent in
// order with a failure stopping the rest, the best-effort revision check before and after Touch ID, a change landing
// during the acts shown as the policy then stands, and each refusal's code. Real step-up signing behind a counted
// confirmation; another machine's link and this Mac's door played by the test.
import { describe, expect, it } from 'vitest';
import { generateSigningKey, verifyStepUp, type Action } from '../../../apps/org-protocol/src/index.ts';
import type { RecordPolicyAnswer } from '@shared/ipc/schema/endpoint';
import type { OrgPolicy } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import { createStepUp, type Confirm, type StepUpPrompt } from '../device/step-up';
import type { ActOutcome, ActRequest } from '../machines/remote/acts';
import type { CallResult } from '../machines/remote/link';
import { createOrgPolicies, type PolicyLink } from './policy';
import { heldOrgSession, type SignedIn } from './session';

const LOCAL = 'local_00000000000000000000' as MachineRef;
const MINI = 'mini_000000000000000000000' as MachineRef;
const ANA = 'a'.repeat(32);
const BEN = 'b'.repeat(32);

/** What a machine's `record.policy` answers, for one session at a revision. */
const answer = (session: string, policyRev: number, access = 'listed'): RecordPolicyAnswer => ({ supported: true, policies: [{ session, access: access as 'listed', shares: [], policyRev }] });
const done = (changed: boolean, policyRev: number): ActOutcome => ({ state: 'done', result: { changed, policyRev } });

async function world(options: { confirm?: Confirm; lanes?: Record<string, 'A' | 'B'>; link?: boolean } = {}) {
  const prompts: StepUpPrompt[] = [];
  const key = await generateSigningKey();
  const stepUp = createStepUp({ device: { org: 'org-p', device: 'mac' }, key, confirm: async (prompt) => (prompts.push(prompt), options.confirm ? options.confirm(prompt) : { ok: true }) });
  const signedIn = { identity: { org: 'org-p', member: ANA, device: 'mac' }, stepUp } as unknown as SignedIn;
  const session = heldOrgSession(signedIn);
  // Each machine's `record.policy` answers, read in turn (the last repeats), and its acts' outcomes, in turn.
  const reads: Record<string, Array<CallResult>> = { [LOCAL]: [], [MINI]: [] };
  const outcomes: Record<string, unknown[]> = { [LOCAL]: [], [MINI]: [] };
  const calls: Array<{ machine: string; input: unknown }> = [];
  const sent: Array<{ machine: string; action: Action }> = [];
  const batches: ActRequest[][] = [];
  // A machine's next reads wait while it is held (`hold` returns the release).
  const gates: Record<string, Promise<void> | undefined> = {};
  const hold = (machine: string) => {
    let release!: () => void;
    gates[machine] = new Promise<void>((resolve) => (release = resolve));
    return () => {
      gates[machine] = undefined;
      release();
    };
  };
  const read = async (machine: string, input: unknown): Promise<CallResult> => {
    await gates[machine];
    calls.push({ machine, input });
    const queue = reads[machine];
    return (queue.length > 1 ? queue.shift() : queue[0]) ?? { ok: false, error: { code: 'unavailable' } };
  };
  const link: PolicyLink = {
    call: async (name, input) => {
      expect(name).toBe('record.policy');
      return await read(MINI, input);
    },
    actMany: async (requests) => {
      batches.push([...requests]);
      const signed = await stepUp.signActions(requests.map((r) => ({ machine: MINI, action: r.action, args: r.args as Record<string, unknown> })));
      if (!signed.ok) return { ok: false, reason: 'step-up-cancelled' };
      return {
        ok: true,
        acts: signed.actions.map((action) => ({
          opId: action.opId,
          send: () => {
            sent.push({ machine: MINI, action });
            return { opId: action.opId, opCreated: action.opCreated, progress: () => 'sent', onProgress: () => () => {}, outcome: Promise.resolve((outcomes[MINI].shift() ?? done(true, 0)) as ActOutcome) };
          },
        })),
      };
    },
  };
  const emitted: OrgPolicy[] = [];
  const acted: string[] = [];
  const policies = createOrgPolicies({
    session,
    local: LOCAL,
    remote: (ref) => (ref === MINI && options.link !== false ? link : null),
    door: {
      act: async (action) => {
        sent.push({ machine: LOCAL, action });
        return outcomes[LOCAL].shift() ?? { state: 'done', result: { changed: true, policyRev: 0 } };
      },
      call: async (input) => {
        const result = await read(LOCAL, input);
        return result.ok ? { ok: true, output: result.output } : { ok: false, code: result.error.code };
      },
    },
    laneOf: (machine, id) => (machine === MINI ? (options.lanes?.[id] ?? null) : null),
    acted: (machine) => void acted.push(machine),
    emit: (policy) => void emitted.push(policy),
    log: () => {},
  });
  const reading = (machine: string, ...answers: Array<RecordPolicyAnswer | CallResult>) => {
    reads[machine] = answers.map((a) => ('ok' in a ? a : { ok: true, output: a }));
  };
  return { policies, prompts, session, signedIn, key, reads, outcomes, calls, sent, batches, emitted, acted, reading, hold };
}

describe('the record acts', () => {
  it('name a lane A target by its session and a lane B one by its appSessionId, the access first, then each share in order', async () => {
    const w = await world({ lanes: { 'eng-1': 'A', 'app-2': 'B' } });
    w.reading(MINI, answer('eng-1', 4));
    const result = await w.policies.set({ address: `${MINI}/eng-1`, access: 'private', shares: [{ member: ANA, grade: 'view' }, { member: BEN, grade: null }], policyRev: 4 });
    expect(result.ok).toBe(true);
    expect(w.batches).toEqual([
      [
        { action: 'record.access', args: { session: 'eng-1', access: 'private' }, executor: 'sminos', stepUp: 'required' },
        { action: 'record.shares', args: { session: 'eng-1', member: ANA, grade: 'view' }, executor: 'sminos', stepUp: 'required' },
        { action: 'record.shares', args: { session: 'eng-1', member: BEN, grade: null }, executor: 'sminos', stepUp: 'required' },
      ],
    ]);
    // no `session` and no `context` on the act itself: the target is in its args
    for (const { action } of w.sent) expect(action.session === undefined && action.context === undefined).toBe(true);
    w.reading(MINI, answer('app-2', 1));
    await w.policies.set({ address: `${MINI}/app-2`, access: 'org-view', policyRev: 1 });
    expect(w.batches[1]).toEqual([{ action: 'record.access', args: { appSessionId: 'app-2', access: 'org-view' }, executor: 'sminos', stepUp: 'required' }]);
  });

  it("go to this Mac's own sessions through the door, each signed for this machine under the device's step-up key", async () => {
    const w = await world();
    w.reading(LOCAL, answer('app-local', 2));
    const result = await w.policies.set({ address: `${LOCAL}/app-local`, access: 'private', shares: [{ member: BEN, grade: 'converse' }], policyRev: 2 });
    expect(result.ok).toBe(true);
    expect(w.sent.map(({ machine, action }) => [machine, action.machine, action.action, action.args])).toEqual([
      [LOCAL, LOCAL, 'record.access', { appSessionId: 'app-local', access: 'private' }],
      [LOCAL, LOCAL, 'record.shares', { appSessionId: 'app-local', member: BEN, grade: 'converse' }],
    ]);
    for (const { action } of w.sent) expect(await verifyStepUp(action, w.key.pub)).toEqual({ ok: true });
    expect(w.calls.every((c) => c.machine === LOCAL)).toBe(true);
  });

  it("add an owner as M5b's act: record.owners {add: true, member} on the target, one confirmation, its outcome shown", async () => {
    const w = await world({ lanes: { 'eng-1': 'A' } });
    w.reading(MINI, answer('eng-1', 3));
    w.outcomes[MINI].push(done(true, 4));
    const result = await w.policies.addOwner({ address: `${MINI}/eng-1`, member: BEN });
    expect(w.batches).toEqual([[{ action: 'record.owners', args: { session: 'eng-1', add: true, member: BEN }, executor: 'sminos', stepUp: 'required' }]]);
    expect(w.prompts).toHaveLength(1);
    expect(result).toEqual({ ok: true, results: [{ line: { kind: 'owner', member: BEN }, state: 'done', changed: true, policyRev: 4, elsewhere: false }], policy: { session: 'eng-1', access: 'listed', shares: [], policyRev: 3 } });
  });
});

describe('a save', () => {
  it('asks Touch ID once for everything it changes, on another machine or on this Mac', async () => {
    const w = await world({ lanes: { 'eng-1': 'A' } });
    w.reading(MINI, answer('eng-1', 4));
    await w.policies.set({ address: `${MINI}/eng-1`, access: 'private', shares: [{ member: ANA, grade: 'view' }, { member: BEN, grade: 'approve' }], policyRev: 4 });
    expect(w.prompts).toHaveLength(1);
    expect(w.prompts[0].summary).toBe(`3 actions on ${MINI}`);
    w.reading(LOCAL, answer('app-local', 1));
    await w.policies.set({ address: `${LOCAL}/app-local`, access: 'listed', shares: [{ member: BEN, grade: 'list' }], policyRev: 1 });
    expect(w.prompts).toHaveLength(2);
  });

  it('sends its acts in order, each after the last one’s outcome, and a failure stops the rest, shown as not sent', async () => {
    const w = await world();
    w.reading(LOCAL, answer('app-local', 4));
    w.outcomes[LOCAL].push({ state: 'done', result: { changed: true, policyRev: 5 } }, { state: 'refused', reason: 'read-only' });
    const result = await w.policies.set({ address: `${LOCAL}/app-local`, access: 'private', shares: [{ member: ANA, grade: 'view' }, { member: BEN, grade: 'view' }], policyRev: 4 });
    expect(w.sent.map((s) => s.action.args)).toEqual([
      { appSessionId: 'app-local', access: 'private' },
      { appSessionId: 'app-local', member: ANA, grade: 'view' },
    ]);
    expect(result).toMatchObject({
      ok: true,
      results: [
        { line: { kind: 'access', access: 'private' }, state: 'done', changed: true, policyRev: 5, elsewhere: false },
        { line: { kind: 'share', member: ANA, grade: 'view' }, state: 'refused', reason: 'read-only' },
        { line: { kind: 'share', member: BEN, grade: 'view' }, state: 'not-sent' },
      ],
    });
  });

  it('stops at a `done` that says no change and revision, as at an outcome that may have run: it invents no change', async () => {
    const w = await world();
    w.reading(LOCAL, answer('app-local', 4));
    w.outcomes[LOCAL].push({ state: 'done', result: { ok: true } }, { state: 'done', result: { changed: true, policyRev: 6 } });
    const result = await w.policies.set({ address: `${LOCAL}/app-local`, access: 'private', shares: [{ member: ANA, grade: 'view' }], policyRev: 4 });
    expect(w.sent).toHaveLength(1);
    expect(result).toMatchObject({
      ok: true,
      results: [
        { line: { kind: 'access', access: 'private' }, state: 'unknown', reason: 'malformed' },
        { line: { kind: 'share', member: ANA, grade: 'view' }, state: 'not-sent' },
      ],
    });
  });

  it('sends nothing, and asks nothing, when the revision moved before Touch ID', async () => {
    const w = await world();
    w.reading(LOCAL, answer('app-local', 5));
    expect(await w.policies.set({ address: `${LOCAL}/app-local`, access: 'private', policyRev: 4 })).toEqual({ ok: false, reason: 'changed-elsewhere' });
    expect(w.prompts).toEqual([]);
    expect(w.sent).toEqual([]);
    expect(w.calls).toEqual([{ machine: LOCAL, input: { session: 'app-local' } }]);
  });

  it('sends nothing when the revision moved after Touch ID, before the first act', async () => {
    const w = await world({ lanes: { 'eng-1': 'A' } });
    w.reading(MINI, answer('eng-1', 4), answer('eng-1', 5));
    expect(await w.policies.set({ address: `${MINI}/eng-1`, access: 'private', shares: [{ member: BEN, grade: 'view' }], policyRev: 4 })).toEqual({ ok: false, reason: 'changed-elsewhere' });
    expect(w.prompts).toHaveLength(1);
    expect(w.sent).toEqual([]);
    expect(w.calls).toHaveLength(2);
  });

  it('shows a change landing during its acts as the policy then stands, marking the line whose revision skipped one', async () => {
    const w = await world();
    const after: RecordPolicyAnswer = { supported: true, policies: [{ session: 'app-local', access: 'private', shares: [{ member: BEN, grade: 'approve' }], policyRev: 7 }] };
    w.reading(LOCAL, answer('app-local', 4), answer('app-local', 4), after);
    w.outcomes[LOCAL].push({ state: 'done', result: { changed: true, policyRev: 5 } }, { state: 'done', result: { changed: true, policyRev: 7 } });
    const result = await w.policies.set({ address: `${LOCAL}/app-local`, access: 'private', shares: [{ member: ANA, grade: 'view' }], policyRev: 4 });
    expect(result).toEqual({
      ok: true,
      results: [
        { line: { kind: 'access', access: 'private' }, state: 'done', changed: true, policyRev: 5, elsewhere: false },
        { line: { kind: 'share', member: ANA, grade: 'view' }, state: 'done', changed: true, policyRev: 7, elsewhere: true },
      ],
      policy: after.supported && after.policies[0],
    });
    // the machine's policies read again whole after the save, and told; its channel listings read again after each act
    expect(w.calls.at(-1)).toEqual({ machine: LOCAL, input: null });
    expect(w.emitted).toEqual([{ ok: true, machine: LOCAL, ...after }]);
    expect(w.acted).toEqual([LOCAL, LOCAL]);
  });

  it('shows changed: false as a no-op that bumps nothing, and marks it only when the revision moved under it', async () => {
    const w = await world();
    w.reading(LOCAL, answer('app-local', 4));
    w.outcomes[LOCAL].push({ state: 'done', result: { changed: false, policyRev: 4 } }, { state: 'done', result: { changed: true, policyRev: 5 } }, { state: 'done', result: { changed: false, policyRev: 6 } });
    const result = await w.policies.set({ address: `${LOCAL}/app-local`, access: 'listed', shares: [{ member: ANA, grade: 'view' }, { member: BEN, grade: 'view' }], policyRev: 4 });
    expect(result.ok && result.results.map((r) => (r.state === 'done' ? [r.changed, r.elsewhere] : r.state))).toEqual([
      [false, false],
      [true, false],
      [false, true],
    ]);
  });

  it('sends nothing more to this Mac once signed out between its acts', async () => {
    const w = await world();
    w.reading(LOCAL, answer('app-local', 4));
    let land!: (outcome: unknown) => void;
    w.outcomes[LOCAL].push(new Promise((resolve) => (land = resolve)));
    const door = w.sent;
    const result = w.policies.set({ address: `${LOCAL}/app-local`, access: 'private', shares: [{ member: BEN, grade: 'view' }], policyRev: 4 });
    while (door.length === 0) await new Promise((resolve) => setImmediate(resolve));
    w.session.set(null); // while the first act runs
    land({ state: 'done', result: { changed: true, policyRev: 5 } });
    expect(await result).toMatchObject({ ok: true, results: [{ state: 'done' }, { state: 'refused', reason: 'signed-out' }] });
    expect(door).toHaveLength(1);
  });

  describe('belongs to the sign-in it started under: once that ends, no line it signed is sent, even after a new sign-in', () => {
    const LINES = { access: 'private' as const, shares: [{ member: BEN, grade: 'view' as const }, { member: 'c'.repeat(32), grade: 'list' as const }] };
    const STOPPED = [
      { state: 'refused', reason: 'signed-out' },
      { state: 'not-sent', line: { kind: 'share', member: BEN, grade: 'view' } },
      { state: 'not-sent', line: { kind: 'share', member: 'c'.repeat(32), grade: 'list' } },
    ];

    for (const machine of [LOCAL, MINI]) {
      it(`a sign-out during the confirmation, on ${machine === LOCAL ? 'this Mac' : 'another machine'}: its lines are stopped and shown so`, async () => {
        let during = () => {};
        const w = await world({ lanes: { s: 'B' }, confirm: async () => (during(), { ok: true }) });
        during = () => {
          w.session.set(null);
          w.session.set(w.signedIn); // the same member again: another sign-in all the same
        };
        w.reading(machine, answer('s', 4));
        const result = await w.policies.set({ address: `${machine}/s`, ...LINES, policyRev: 4 });
        expect(result).toMatchObject({ ok: true, results: STOPPED, policy: null });
        expect(w.prompts).toHaveLength(1);
        expect(w.sent).toEqual([]);
      });
    }

    const between = async (signIn: (w: Awaited<ReturnType<typeof world>>) => void) => {
      const w = await world({ lanes: { s: 'B' } });
      w.reading(MINI, answer('s', 4));
      let land!: (outcome: unknown) => void;
      w.outcomes[MINI].push(new Promise((resolve) => (land = resolve)) as never);
      const result = w.policies.set({ address: `${MINI}/s`, ...LINES, policyRev: 4 });
      while (w.sent.length === 0) await new Promise((resolve) => setImmediate(resolve));
      w.session.set(null); // while the first act runs
      signIn(w);
      land(done(true, 5));
      return { w, result: await result };
    };

    it('a sign-out between two acts, the same member signing in again before the next', async () => {
      const { w, result } = await between((w) => w.session.set(w.signedIn));
      expect(result).toMatchObject({ ok: true, results: [{ state: 'done', changed: true, policyRev: 5 }, { state: 'refused', reason: 'signed-out' }, { state: 'not-sent' }] });
      expect(w.sent).toHaveLength(1);
    });

    it('a sign-out between two acts, another member signing in before the next', async () => {
      const { w, result } = await between((w) => w.session.set({ ...w.signedIn, identity: { ...w.signedIn.identity, member: BEN } }));
      expect(result).toMatchObject({ ok: true, results: [{ state: 'done' }, { state: 'refused', reason: 'signed-out' }, { state: 'not-sent' }] });
      expect(w.sent).toHaveLength(1);
    });
  });

  it('signs nothing when the person cancels', async () => {
    const w = await world({ confirm: async () => ({ ok: false, reason: 'cancelled' }), lanes: { 'eng-1': 'A' } });
    w.reading(MINI, answer('eng-1', 4));
    expect(await w.policies.set({ address: `${MINI}/eng-1`, access: 'private', policyRev: 4 })).toEqual({ ok: false, reason: 'cancelled' });
    w.reading(LOCAL, answer('app-local', 1));
    expect(await w.policies.set({ address: `${LOCAL}/app-local`, access: 'private', policyRev: 1 })).toEqual({ ok: false, reason: 'cancelled' });
    expect(w.sent).toEqual([]);
  });
});

describe('the refusals', () => {
  it('say why nothing was sent: signed out, no session, no link, nothing to change, a doubled member, not an address', async () => {
    const w = await world({ lanes: { 'eng-1': 'A' } });
    expect(await w.policies.set({ address: `${MINI}/unlisted`, access: 'private', policyRev: 1 })).toEqual({ ok: false, reason: 'no-session' });
    expect(await w.policies.set({ address: `${MINI}/eng-1`, policyRev: 1 })).toEqual({ ok: false, reason: 'empty' });
    expect(await w.policies.set({ address: `${MINI}/eng-1`, shares: [{ member: BEN, grade: 'view' }, { member: BEN, grade: null }], policyRev: 1 })).toEqual({ ok: false, reason: 'malformed' });
    expect(await w.policies.set({ address: 'no-address', access: 'private', policyRev: 1 })).toEqual({ ok: false, reason: 'malformed' });
    w.session.set(null);
    expect(await w.policies.set({ address: `${MINI}/eng-1`, access: 'private', policyRev: 1 })).toEqual({ ok: false, reason: 'signed-out' });
    const unlinked = await world({ lanes: { 'eng-1': 'A' }, link: false });
    expect(await unlinked.policies.set({ address: `${MINI}/eng-1`, access: 'private', policyRev: 1 })).toEqual({ ok: false, reason: 'offline' });
    expect([w.prompts, w.sent, unlinked.prompts]).toEqual([[], [], []]);
  });

  it("say when the machine can't keep a session's reach, can't read it now, or refused the read", async () => {
    const w = await world();
    w.reading(LOCAL, { supported: false });
    expect(await w.policies.set({ address: `${LOCAL}/app-local`, access: 'private', policyRev: 1 })).toEqual({ ok: false, reason: 'not-supported' });
    w.reading(LOCAL, { supported: true, policies: [{ session: 'app-local', unavailable: true }] });
    expect(await w.policies.set({ address: `${LOCAL}/app-local`, access: 'private', policyRev: 1 })).toEqual({ ok: false, reason: 'unavailable' });
    w.reading(LOCAL, { ok: false, error: { code: 'not-offered' } });
    expect(await w.policies.set({ address: `${LOCAL}/app-local`, access: 'private', policyRev: 1 })).toEqual({ ok: false, reason: 'not-offered' });
    w.reading(LOCAL, { ok: true, output: { supported: 'yes' } });
    expect(await w.policies.set({ address: `${LOCAL}/app-local`, access: 'private', policyRev: 1 })).toEqual({ ok: false, reason: 'malformed' });
    expect(w.prompts).toEqual([]);
  });

  it("carry each act's refusal in its own words: sminos's, the endpoint's plain `no-session`, the ledger's, step-up's, and an outcome that may have run", async () => {
    const w = await world({ lanes: { 'eng-1': 'A' } });
    for (const [outcome, line] of [
      [{ state: 'refused', reason: 'no-session' }, { state: 'refused', reason: 'no-session' }],
      [{ state: 'refused', reason: 'unsupported' }, { state: 'refused', reason: 'unsupported' }],
      [{ state: 'refused', reason: 'stale' }, { state: 'refused', reason: 'stale' }],
      [{ state: 'refused', reason: 'step-up-cancelled' }, { state: 'refused', reason: 'cancelled' }],
      [{ state: 'not-sent' }, { state: 'refused', reason: 'tombstoned' }],
      [{ state: 'unknown', reason: 'expired' }, { state: 'unknown', reason: 'expired' }],
      [{ state: 'failed', error: { message: 'boom' } }, { state: 'failed', reason: 'failed' }],
      [{ state: 'done', result: 'not a policy' }, { state: 'unknown', reason: 'malformed' }],
      [{ state: 'done', result: { changed: true } }, { state: 'unknown', reason: 'malformed' }],
      [{ state: 'done', result: { changed: 'yes', policyRev: 5 } }, { state: 'unknown', reason: 'malformed' }],
    ] as const) {
      w.reading(MINI, answer('eng-1', 4));
      w.outcomes[MINI].push(outcome);
      const result = await w.policies.set({ address: `${MINI}/eng-1`, access: 'private', policyRev: 4 });
      expect(result.ok && result.results[0]).toEqual({ line: { kind: 'access', access: 'private' }, ...line });
    }
  });
});

describe('the policies read', () => {
  it("read a machine's whole policies, and tell them; one session's, untold", async () => {
    const w = await world();
    const whole: RecordPolicyAnswer = { supported: true, policies: [{ session: 'a', access: 'private', shares: [], policyRev: 1 }, { session: 'b', unavailable: true }] };
    w.reading(LOCAL, whole);
    expect(await w.policies.get({ machine: LOCAL })).toEqual({ ok: true, machine: LOCAL, ...whole });
    expect(w.emitted).toEqual([{ ok: true, machine: LOCAL, ...whole }]);
    w.reading(MINI, { supported: true, policies: [{ session: 'eng-1', access: 'org-view', shares: [], policyRev: 9 }] });
    expect(await w.policies.get({ address: `${MINI}/eng-1` })).toEqual({ ok: true, machine: MINI, supported: true, policies: [{ session: 'eng-1', access: 'org-view', shares: [], policyRev: 9 }] });
    expect(w.calls.at(-1)).toEqual({ machine: MINI, input: { session: 'eng-1' } });
    expect(w.emitted).toHaveLength(1);
  });

  it("say a machine whose sminos can't keep a session's reach, one that can't be reached, and a refused read", async () => {
    const w = await world({ link: false });
    w.reading(LOCAL, { supported: false });
    expect(await w.policies.get({ machine: LOCAL })).toEqual({ ok: true, machine: LOCAL, supported: false });
    expect(await w.policies.get({ machine: MINI })).toEqual({ ok: false, machine: MINI, reason: 'offline' });
    w.reading(LOCAL, { ok: false, error: { code: 'unavailable' } });
    expect(await w.policies.get({ machine: LOCAL })).toEqual({ ok: false, machine: LOCAL, reason: 'unavailable' });
    w.session.set(null);
    expect(await w.policies.get({ machine: LOCAL })).toEqual({ ok: false, machine: LOCAL, reason: 'signed-out' });
  });

  describe('belong to the sign-in they started under: one that ends before they answer tells nothing, and answers signed out', () => {
    const whole: RecordPolicyAnswer = { supported: true, policies: [{ session: 'a', access: 'private', shares: [], policyRev: 1 }] };
    const heldThrough = async (change: (w: Awaited<ReturnType<typeof world>>) => void) => {
      const w = await world();
      w.reading(MINI, whole);
      const release = w.hold(MINI);
      const asked = w.policies.get({ machine: MINI });
      const one = w.policies.get({ address: `${MINI}/a` });
      await Promise.resolve();
      change(w);
      release();
      return { w, answers: await Promise.all([asked, one]) };
    };
    const SIGNED_OUT = { ok: false, machine: MINI, reason: 'signed-out' };

    it('signed out', async () => {
      const { w, answers } = await heldThrough((w) => w.session.set(null));
      expect(answers).toEqual([SIGNED_OUT, SIGNED_OUT]);
      expect(w.emitted).toEqual([]);
    });

    it('another member signed in', async () => {
      const { w, answers } = await heldThrough((w) => w.session.set({ ...w.signedIn, identity: { ...w.signedIn.identity, member: BEN } }));
      expect(answers).toEqual([SIGNED_OUT, SIGNED_OUT]);
      expect(w.emitted).toEqual([]);
    });

    it('the same member signed out and in again: a new sign-in, not theirs', async () => {
      const { w, answers } = await heldThrough((w) => {
        w.session.set(null);
        w.session.set(w.signedIn);
      });
      expect(answers).toEqual([SIGNED_OUT, SIGNED_OUT]);
      expect(w.emitted).toEqual([]);
    });

    it('but a new head adopted under the same sign-in is no new reader: the read is told', async () => {
      const { w, answers } = await heldThrough((w) => w.session.changed());
      expect(answers[0]).toEqual({ ok: true, machine: MINI, ...whole });
      expect(w.emitted).toEqual([{ ok: true, machine: MINI, ...whole }]);
    });
  });
});
