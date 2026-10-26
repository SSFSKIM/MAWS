// The fake machine as the machine-side wave's MW3 producer (`producer: 'mw3'`), on the local runtime through the
// stand-in: a bridged session's presence carries `decide.scope` and `decide.addDirectory` available; the MW3 live
// check's permission requests are raised with the engine's suggestions as the bridge raised them on 2.1.310 (and the
// one a secrets guard beneath had restored, without them); a `decide` with `scope` is resolved from the request the
// machine holds as the daemon resolves it — `session` in place of any destination, `localSettings` only where the
// suggestion names it, a rule or a directory only — and refused before anything runs otherwise; an MW2 producer says
// the scoped allows are not in its sminos.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMachine, loadRecording, MW3_CAPABILITIES, MW3_SCOPED, TWO_SUBAGENTS, type Producer } from '../../fake-machine';
import type { ProjectDown } from '../../src/protocol/browser';
import { importOrgKey, inputSha256, newNonce, sealRpc } from '../../src/protocol/codes';
import type { RpcArgs, RpcDraft, RpcName } from '../../src/protocol/rpc';
import { CONTROL_KEYS, type Raised, type SessionMessage, type SessionPresence } from '../../src/protocol/session';
import { BrowserClient, enroll } from '../support/clients';
import { ADMIN, startLocalHub, type LocalHub } from '../support/local';

let hub: LocalHub;
let member: string;
beforeAll(async () => {
  hub = await startLocalHub();
  member = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
});
afterAll(() => hub?.close());

const RAW_KEY = new Uint8Array(32).fill(14);
const KEY = importOrgKey(RAW_KEY);
let count = 0;
const newProject = () => `9c3e0a8e-3b2d-4c5e-9f73-${(++count).toString(16).padStart(12, '0')}`;

async function setUp(options: { producer?: Producer; readOnly?: boolean } = {}) {
  const project = newProject();
  const name = `mw3-${count}`;
  const recording = loadRecording(TWO_SUBAGENTS);
  const credentials = await enroll(hub, ADMIN, name);
  const fm = new FakeMachine({ hub: hub.url, machine: name, credentials, orgKey: RAW_KEY, project, recordings: [recording], member, producer: options.producer ?? 'mw3', readOnly: options.readOnly });
  await fm.connect();
  const b = await BrowserClient.open(hub, ADMIN, project);
  await b.next((f) => f.t === 'deliveries', 'the end of the connect sequence');
  const S = recording.session;
  const call = async (rpc: RpcName, args: Record<string, unknown>) => {
    const sealed = await sealRpc(await KEY, { rpc, project, machine: fm.name, member, created: new Date().toISOString(), nonce: newNonce(), args: { session: S, ...args } } as unknown as RpcDraft);
    b.send({ t: 'rpc', rpc: sealed });
    return (await b.next((f) => f.t === 'rpc-state' && f.nonce === sealed.nonce && f.state !== 'forwarded', `the ${rpc}`, 0, 10_000)) as Extract<ProjectDown, { t: 'rpc-state' }>;
  };
  return { fm, b, S, call };
}

const sessionMessages = (b: BrowserClient, kind: SessionMessage['kind']) => b.frames.flatMap((f) => (f.t === 'session' && f.message.kind === kind ? [f.message] : []));
const presences = (b: BrowserClient) => sessionMessages(b, 'presence').map((m) => m.body as SessionPresence);

/** A decide's args for a raised request, as the web draws it: its digest, and a scope naming suggestion `index`. */
async function scoped(r: Raised, index: number, destination: string, decision = 'allow') {
  const suggestion = r.suggestions![index]!;
  return {
    decision,
    digest: { session: r.session, request: r.request, tool: r.tool, input_sha256: await inputSha256(r.input) },
    scope: { suggestion: index, sha256: await inputSha256(suggestion as never), destination },
  };
}

describe('the MW3 recording', () => {
  it('is the file the README names, byte for byte', () => {
    const at = (name: string) => fileURLToPath(new URL(`../../fake-machine/dx4/${name}`, import.meta.url));
    const sha = createHash('sha256').update(readFileSync(at('mw3-scoped.json'))).digest('hex');
    expect(readFileSync(at('README.md'), 'utf8')).toContain(sha);
  });

  it("holds the live check's scoped allows: a rule as session and as the suggestion's own localSettings, a directory; and the guarded request without suggestions", async () => {
    expect(MW3_SCOPED.scoped.map((s) => [s.updatedPermissions[0]?.type, s.scope.destination])).toEqual([
      ['addRules', 'session'],
      ['addRules', 'localSettings'],
      ['addDirectories', 'session'],
    ]);
    for (const s of MW3_SCOPED.scoped) {
      const suggestion = s.raised.suggestions![s.scope.suggestion]!;
      expect(s.scope.sha256).toBe(await inputSha256(suggestion as never));
      expect(s.updatedPermissions).toEqual([{ ...suggestion, destination: s.scope.destination }]);
    }
    expect(MW3_SCOPED.withheld.raised).not.toHaveProperty('suggestions');
    expect(String(MW3_SCOPED.withheld.raised.input.command)).toContain('[secret:');
  });

  it('types a scope as the daemon admits it', () => {
    const ok: RpcArgs['decide']['scope'] = { suggestion: 0, sha256: 'a'.repeat(64), destination: 'localSettings' };
    // @ts-expect-error the terminal changes the user's and the project's settings, never the desk
    const user: RpcArgs['decide']['scope'] = { suggestion: 0, sha256: 'a'.repeat(64), destination: 'userSettings' };
    expect([ok, user]).toHaveLength(2);
  });
});

describe('the fake machine as the MW3 producer', () => {
  it('advertises the scoped allows: decide.scope and decide.addDirectory available', async () => {
    const { fm, b } = await setUp();
    const machines = ((await b.next((f) => f.t === 'machines' && f.machines.length > 0, 'machines')) as Extract<ProjectDown, { t: 'machines' }>).machines;
    expect(machines[0].desk?.sminos).toBe('1.13.0');
    const capabilities = presences(b).at(-1)?.capabilities;
    expect(capabilities).toEqual(MW3_CAPABILITIES);
    const controls = capabilities?.controls ?? {};
    expect(Object.keys(controls)).toEqual([...CONTROL_KEYS]);
    expect(controls['decide.scope']).toEqual({ available: true });
    expect(controls['decide.addDirectory']).toEqual({ available: true });
    b.close();
    await fm.close();
  });

  it('raises the recorded requests with their suggestions, under the code, and the guarded one without; the pending set carries them', async () => {
    const { fm, b, S } = await setUp();
    const raised = await fm.raiseRecordedScoped(S);
    expect(raised.map((r) => r.suggestions?.length ?? 0)).toEqual([...MW3_SCOPED.scoped.map((s) => s.raised.suggestions!.length), 0]);
    await b.next((f) => f.t === 'pending' && f.requests.length === raised.length, 'the pending set');
    const later = await BrowserClient.open(hub, ADMIN, fm.project);
    const pending = ((await later.next((f) => f.t === 'pending', 'pending on connect')) as Extract<ProjectDown, { t: 'pending' }>).requests;
    expect(pending.map((p) => p.raised)).toEqual(raised);
    later.close();
    b.close();
    await fm.close();
  });

  it('allows a scoped request adding the suggestion resolved from the request held, under the destination asked', async () => {
    const { fm, b, S, call } = await setUp();
    const raised = await fm.raiseRecordedScoped(S);
    for (const [i, s] of MW3_SCOPED.scoped.entries()) {
      const asked = await call('decide', await scoped(raised[i]!, s.scope.suggestion, s.scope.destination));
      expect(asked.outcome).toEqual({ state: 'done', result: {} });
    }
    expect(fm.scopedAllows.map((a) => [a.request, a.rule])).toEqual(MW3_SCOPED.scoped.map((s) => [s.raised.request, s.updatedPermissions[0]]));
    b.close();
    await fm.close();
  });

  it('refuses a scope the request does not bear, before anything runs', async () => {
    const { fm, b, S, call } = await setUp();
    const raised = await fm.raiseRecordedScoped(S);
    const [rule, , directory] = raised;
    const setMode = directory!.suggestions!.findIndex((s) => s.type === 'setMode');
    expect(setMode).toBeGreaterThanOrEqual(0);
    const refusals: Array<[string, Record<string, unknown>, string]> = [
      ['another hash', { ...(await scoped(rule!, 0, 'session')), scope: { suggestion: 0, sha256: 'b'.repeat(64), destination: 'session' } }, 'not-pending'],
      ['an index past the list', { ...(await scoped(rule!, 0, 'session')), scope: { suggestion: 9, sha256: (await scoped(rule!, 0, 'session')).scope.sha256, destination: 'session' } }, 'not-pending'],
      ['setMode', await scoped(directory!, setMode, 'session'), 'bad-shape'],
      ['a localSettings the suggestion did not offer', await scoped(directory!, 0, 'localSettings'), 'bad-shape'],
      ['userSettings', await scoped(rule!, 0, 'userSettings'), 'bad-shape'],
      ['a scope on a deny', await scoped(rule!, 0, 'session', 'deny'), 'bad-shape'],
      ['a scope on a request without suggestions', { ...(await scoped(rule!, 0, 'session')), digest: { session: raised[3]!.session, request: raised[3]!.request, tool: raised[3]!.tool, input_sha256: await inputSha256(raised[3]!.input) } }, 'not-pending'],
    ];
    for (const [what, args, code] of refusals) {
      expect((await call('decide', args)).outcome, what).toMatchObject({ state: 'failed', error: { code } });
    }
    expect(fm.scopedAllows).toEqual([]);
    expect(fm.pendingRequests()).toHaveLength(raised.length);
    expect(fm.rpcs.every((r) => !r.executed)).toBe(true);
    b.close();
    await fm.close();
  });

  it('refuses a scoped allow on a read-only machine', async () => {
    const { fm, b, S, call } = await setUp({ readOnly: true });
    const raised = await fm.raiseRecordedScoped(S);
    expect((await call('decide', await scoped(raised[0]!, 0, 'session'))).outcome).toMatchObject({ state: 'failed', error: { code: 'read-only' } });
    expect(fm.scopedAllows).toEqual([]);
    b.close();
    await fm.close();
  });

  it('as an MW2 producer, says the scoped allows are not in its sminos, and raises no recorded scoped request', async () => {
    const { fm, b } = await setUp({ producer: 'mw2' });
    expect(presences(b).at(-1)?.capabilities?.controls?.['decide.scope']).toMatchObject({ available: false, reason: expect.stringContaining('1.12.0') });
    await expect(fm.raiseRecordedScoped()).rejects.toThrow(/mw3/);
    b.close();
    await fm.close();
  });
});
