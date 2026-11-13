// The renderer's record of connector sign-ins (the Discover spec, Design "Signing in"; M4 fix wave): a result belongs to
// the configured server it was started for (its name, scope, and the directory for a project or local one) and to the
// session that signed in, never to every server that shares the name.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import type { MawsBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { signInViewOf } from './present';
import { cancelSignIn, connectSignInEvents, forgetSignIn, heard, resetSignIns, signInKeyOf, startSignIn, startSignInDynamic, useSignIns } from './sign-in';
import type { AppSessionId } from '@shared/graph/ids';

const event = (opId: string, state: ConnectorSignInChanged['state'], name = 'linear'): ConnectorSignInChanged => ({ opId, name, state, reason: null, message: null, where: null });
const USER = { name: 'linear', scope: 'user', cwd: '/a', path: '/cfg/.claude.json', fingerprint: 'print-user' } as const;
const PROJECT_A = { name: 'linear', scope: 'project', cwd: '/a', path: '/a/.mcp.json', fingerprint: 'print-a' } as const;
const PROJECT_B = { name: 'linear', scope: 'project', cwd: '/b', path: '/b/.mcp.json', fingerprint: 'print-b' } as const;
const recordOf = (target: Parameters<typeof signInKeyOf>[0]) => useSignIns.getState().byServer.get(signInKeyOf(target));
// main answers the receipt after it has already said `starting` (and cancelled an earlier operation), as connectors.signIn does
const bridgeAnswering = (...opIds: string[]) => {
  const queue = [...opIds];
  return { invoke: vi.fn(async () => ({ ok: true, value: { opId: queue.shift()! } })) } as unknown as MawsBridge;
};

describe('a server’s latest sign-in', () => {
  beforeEach(() => resetSignIns());

  it('is the configured server’s own: user scope ignores the directory, project scope keys it', () => {
    expect(signInKeyOf(USER)).toBe(signInKeyOf({ ...USER, cwd: '/b' }));
    expect(signInKeyOf(PROJECT_A)).not.toBe(signInKeyOf(PROJECT_B));
    expect(signInKeyOf(PROJECT_A)).not.toBe(signInKeyOf({ ...PROJECT_A, scope: 'local' }));
  });

  it('binds the events heard before the receipt to the server it was started for, with the signing session and when', async () => {
    const bridge = bridgeAnswering('one');
    const started = startSignIn(PROJECT_A, PROJECT_A.fingerprint, 'session-a', bridge);
    heard(event('one', 'starting'), 100); // before the invoke answered
    expect(recordOf(PROJECT_A)).toBeUndefined();
    await started;
    expect(recordOf(PROJECT_A)).toEqual({ event: event('one', 'starting'), appSessionId: 'session-a', at: 100, fingerprint: 'print-a' });
    heard(event('one', 'done'), 200);
    expect(recordOf(PROJECT_A)).toMatchObject({ event: { state: 'done' }, at: 200 });
    expect(recordOf(PROJECT_B)).toBeUndefined(); // another project's server of the same name has nothing
    expect(recordOf(USER)).toBeUndefined();
  });

  it('follows its newest operation: a second press replaces the first, whose later events are dropped', async () => {
    const bridge = bridgeAnswering('one', 'two');
    heard(event('one', 'starting'), 1);
    await startSignIn(USER, USER.fingerprint, 's', bridge);
    heard(event('one', 'waiting_callback'), 2);
    expect(recordOf(USER)).toMatchObject({ event: { opId: 'one', state: 'waiting_callback' } });
    const second = startSignIn(USER, USER.fingerprint, 's', bridge);
    heard(event('one', 'cancelled'), 3); // main cancels the first before the second starts
    heard(event('two', 'starting'), 4);
    await second;
    heard(event('one', 'failed'), 5); // nothing more of the first counts
    expect(recordOf(USER)).toMatchObject({ event: { opId: 'two', state: 'starting' } });
    heard(event('two', 'done'), 6);
    expect(recordOf(USER)).toMatchObject({ event: { opId: 'two', state: 'done' } });
  });

  it('two servers of one name in two projects keep their own results', async () => {
    const bridge = bridgeAnswering('a', 'b');
    await startSignIn(PROJECT_A, PROJECT_A.fingerprint, 's-a', bridge);
    await startSignIn(PROJECT_B, PROJECT_B.fingerprint, 's-b', bridge);
    heard(event('a', 'done'), 1);
    heard(event('b', 'failed'), 2);
    expect(recordOf(PROJECT_A)).toMatchObject({ event: { state: 'done' }, appSessionId: 's-a' });
    expect(recordOf(PROJECT_B)).toMatchObject({ event: { state: 'failed' }, appSessionId: 's-b' });
  });

  it('reads a refused invoke as a sign-in that did not finish, in the transport’s words', async () => {
    const bridge = { invoke: vi.fn(async () => ({ ok: false, error: { code: 'unavailable', message: 'main is not ready' } })) } as unknown as MawsBridge;
    await startSignIn(USER, USER.fingerprint, 'session-1', bridge);
    expect(bridge.invoke).toHaveBeenCalledWith('connectors.signIn', { name: 'linear', scope: 'user', cwd: '/a', path: '/cfg/.claude.json', appSessionId: 'session-1' });
    expect(recordOf(USER)).toMatchObject({ event: { state: 'failed', reason: 'engine' }, appSessionId: 'session-1' });
    expect(recordOf(USER)!.event.message).toBeTruthy();
  });

  it('forgets a server’s result when MAWS removes or replaces its configuration, and drops the rest of a running operation', async () => {
    const bridge = bridgeAnswering('one');
    await startSignIn(USER, USER.fingerprint, 's', bridge);
    heard(event('one', 'waiting_callback'), 1);
    forgetSignIn(USER);
    expect(recordOf(USER)).toBeUndefined();
    heard(event('one', 'done'), 2); // main's operation ends after the removal: it says nothing about what is configured now
    expect(recordOf(USER)).toBeUndefined();
  });
});

// P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Consent and the client port"): an operation is the
// machine's its session is on, heard from that machine alone; such a machine's failures read in its own words.
describe('a sign-in on another machine', () => {
  beforeEach(() => resetSignIns());
  const ON_B = addressOf(OTHER_MACHINE, 'session-b');
  const ON_MINI = { ...USER, machine: OTHER_MACHINE }; // the same server, configured on the other machine
  const failed = (opId: string, message: string): ConnectorSignInChanged => ({ ...event(opId, 'failed'), reason: 'engine', message });
  // the bridge's `on`, as the renderer's client hands a listener the machine an event came from
  const events = () => {
    let listener: ((payload: ConnectorSignInChanged, from: { machine: MachineRef }) => void) | null = null;
    const bridge = { ...bridgeAnswering('op-1'), on: vi.fn((_name: string, l: typeof listener) => ((listener = l), () => {})) } as unknown as MawsBridge;
    return { bridge, say: (payload: ConnectorSignInChanged, machine: MachineRef) => listener!(payload, { machine }) };
  };

  it('binds only that machine’s events, and says its unrelayable sign-in and its busy port as it words them', async () => {
    const { bridge, say } = events();
    connectSignInEvents(bridge);
    await startSignIn(USER, USER.fingerprint, ON_B, bridge);
    say({ ...event('op-1', 'waiting_browser') }, TEST_MACHINE); // this Mac's operation of the same id: not the machine's
    expect(recordOf(ON_MINI)).toBeUndefined();
    say(failed('op-1', 'sign in on mini'), OTHER_MACHINE);
    expect(recordOf(ON_MINI)).toMatchObject({ event: { state: 'failed', message: 'sign in on mini' }, appSessionId: ON_B });
    expect(recordOf(USER)).toBeUndefined(); // the machine's, never this Mac's row's
    const view = signInViewOf({ live: undefined, liveRead: null, posture: null, last: recordOf(ON_MINI)!, transport: 'http' });
    expect(view).toMatchObject({ text: 'Sign-in didn’t finish: sign in on mini', tone: 'danger', signIn: true });
  });

  it('reads the busy port’s failure as busy, not as a generic one', async () => {
    const { bridge, say } = events();
    connectSignInEvents(bridge);
    await startSignIn(USER, USER.fingerprint, ON_B, bridge);
    const busy = 'another sign-in from this device is waiting on the same callback port';
    say(failed('op-1', busy), OTHER_MACHINE);
    expect(signInViewOf({ live: undefined, liveRead: null, posture: null, last: recordOf(ON_MINI)!, transport: 'http' })?.text).toBe(`Sign-in didn’t finish: ${busy}`);
  });

  it('keeps another machine’s operations heard before any receipt apart from this Mac’s', async () => {
    heard(event('mine', 'starting'), 100, TEST_MACHINE); // main says `starting` before the receipt
    for (let i = 0; i < 40; i += 1) heard(event(`b-${i}`, 'starting'), 200 + i, OTHER_MACHINE); // a machine's crowd of sign-ins
    const bridge = bridgeAnswering('mine');
    await startSignIn(USER, USER.fingerprint, addressOf(TEST_MACHINE, 'session-a'), bridge);
    expect(recordOf(USER)).toMatchObject({ event: { opId: 'mine', state: 'starting' }, at: 100 });
  });

  // The task review's finding 4: a server's sign-ins are its machine's, so the same server signing in on this Mac and on
  // another machine at once are two newest operations, each with its own result, neither cancelling the other's record
  it('keeps the same server’s concurrent sign-ins on this Mac and on another machine apart', async () => {
    let listener: ((payload: ConnectorSignInChanged, from: { machine: MachineRef }) => void) | null = null;
    const bridge = { ...bridgeAnswering('here-1', 'there-1'), on: vi.fn((_name: string, l: typeof listener) => ((listener = l), () => {})) } as unknown as MawsBridge;
    connectSignInEvents(bridge);
    const ON_A = addressOf(TEST_MACHINE, 'session-a');
    await startSignIn(USER, USER.fingerprint, ON_A, bridge);
    await startSignIn(USER, USER.fingerprint, ON_B, bridge);
    listener!(event('here-1', 'waiting_browser'), { machine: TEST_MACHINE });
    listener!(event('there-1', 'waiting_callback'), { machine: OTHER_MACHINE });
    expect(recordOf(USER)).toMatchObject({ event: { opId: 'here-1', state: 'waiting_browser' }, appSessionId: ON_A });
    expect(recordOf({ ...USER, machine: TEST_MACHINE })).toBe(recordOf(USER)); // this Mac named or not, one key
    expect(recordOf(ON_MINI)).toMatchObject({ event: { opId: 'there-1', state: 'waiting_callback' }, appSessionId: ON_B });
    forgetSignIn(USER); // MAWS replaced this Mac's configuration: the machine's sign-in is not about it
    expect(recordOf(USER)).toBeUndefined();
    listener!(event('there-1', 'done'), { machine: OTHER_MACHINE });
    expect(recordOf(ON_MINI)).toMatchObject({ event: { opId: 'there-1', state: 'done' } });
  });

  it('cancels on the machine its session is on', () => {
    const bridge = { invoke: vi.fn(async () => ({ ok: true, value: { cancelled: true } })) } as unknown as MawsBridge;
    cancelSignIn('op-1', ON_B, bridge);
    expect(bridge.invoke).toHaveBeenCalledWith('connectors.signInCancel', { opId: 'op-1' }, { machine: OTHER_MACHINE });
  });
});

// UX wave U11a M8 (§A, "The connector's identity"): a dynamic connector, a plugin's or one of MAWS's own list, is its
// machine and its name, keyed as a user one is (no folder) yet apart from a file-scope server of the name. The dialog
// signs it in by name alone; Customize's row of MAWS's own list also sends the revision it was drawn with, and keeps the
// fingerprint, which decides as today which row shows a finished result.
describe('a dynamic connector’s sign-in', () => {
  beforeEach(() => resetSignIns());
  const DYNAMIC = { name: 'fx-own', scope: 'dynamic', cwd: null } as const;
  const SESSION = 'session-a' as AppSessionId;

  it('is keyed by its machine and name, with no folder, apart from a user-scope server of the name', () => {
    expect(signInKeyOf(DYNAMIC)).toBe(signInKeyOf({ ...DYNAMIC, cwd: '/b' }));
    expect(signInKeyOf(DYNAMIC)).not.toBe(signInKeyOf({ ...DYNAMIC, scope: 'user' }));
    expect(signInKeyOf({ ...DYNAMIC, machine: OTHER_MACHINE })).not.toBe(signInKeyOf(DYNAMIC));
  });

  it('from the dialog: the name alone, no fingerprint, bound to the dynamic connector’s record', async () => {
    const bridge = bridgeAnswering('op-d');
    heard(event('op-d', 'starting', 'plugin:fx-plugin:fx-oauth'), 10);
    await startSignInDynamic({ name: 'plugin:fx-plugin:fx-oauth' }, null, SESSION, bridge);
    expect(bridge.invoke).toHaveBeenCalledWith('connectors.signInDynamicServer', { name: 'plugin:fx-plugin:fx-oauth', appSessionId: SESSION });
    expect(recordOf({ ...DYNAMIC, name: 'plugin:fx-plugin:fx-oauth' })).toEqual({ event: event('op-d', 'starting', 'plugin:fx-plugin:fx-oauth'), appSessionId: SESSION, at: 10, fingerprint: null });
  });

  it('from Customize’s row of MAWS’s own list: the revision the row was drawn with goes, the fingerprint stays in the window', async () => {
    const bridge = bridgeAnswering('op-c');
    await startSignInDynamic({ name: 'fx-own', revision: 'rev-1' }, 'print-own', SESSION, bridge);
    expect(bridge.invoke).toHaveBeenCalledWith('connectors.signInDynamicServer', { name: 'fx-own', appSessionId: SESSION, entry: { revision: 'rev-1' } });
    heard(event('op-c', 'done', 'fx-own'), 20);
    expect(recordOf(DYNAMIC)).toMatchObject({ event: { state: 'done' }, fingerprint: 'print-own' });
    expect(recordOf({ ...DYNAMIC, scope: 'user' })).toBeUndefined();
  });

  it('reads a refused invoke, an older daemon’s unknown command among them, as a sign-in that did not finish in the transport’s words', async () => {
    const bridge = { invoke: vi.fn(async () => ({ ok: false, error: { code: 'unknown_command', message: 'unknown command connectors.signInDynamicServer' } })) } as unknown as MawsBridge;
    await startSignInDynamic({ name: 'fx-own' }, null, SESSION, bridge);
    expect(recordOf(DYNAMIC)).toMatchObject({ event: { state: 'failed', reason: 'engine' }, appSessionId: SESSION });
    expect(recordOf(DYNAMIC)!.event.message).toBeTruthy();
  });
});
