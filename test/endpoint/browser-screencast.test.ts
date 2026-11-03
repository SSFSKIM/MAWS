// The agent's browser across RL2 at the endpoint (P5 O17 M9a; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M9,
// Interfaces §K; O7's Interfaces §N's read open): the `browser.screencast` read open, read-only at `view` on its session or
// controlling at `approve` under a done `machine.browserControl` act of the same member, device, session and epoch; its
// frames in the envelope over the device's byte credit, its controls, its one-frame backlog and its close words, mapped
// from `mawsd`'s; the act under the endpoint's own ledger; the `browser.inventory` feed; and O10's four pins (§K) over the
// real authorizer: step-up per grant for a non-owner, the web-cards class kept out, the grant dead with its epoch and its
// ledger's orphans `expired`, and a controlling stream re-authorized at every record change.
import { randomBytes } from 'node:crypto';
import { actionFingerprint, ScreencastFrameReader, type Action, type ScreencastFrame } from 'org-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OpLedger } from '@shared/host/op-ledger';
import { BROWSER_WORDS, closeWord, refusalWord } from '../../src/endpoint/browser-words';
import { BY_EFFECT, type EffectReads, type EffectRule } from '../../src/endpoint/by-effect';
import { OWN_ACTIONS } from '../../src/endpoint/endpoint-actions';
import { OFFERS, READ_OPENS } from '../../src/endpoint/offers';
import type { SessionRecord, SessionTarget, RecordSource } from '../../src/endpoint/sources';
import { ENDPOINT_CAPABILITIES } from '../../src/endpoint/capabilities';
import { fakeBrowser } from './fake-services';
import { act, CHECKOUT, done, evs, laneAMember, makeOrg, of, openRemote, PROJECT, Records, sleep, sminos, snapshot, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote, type StartOptions } from './sub-harness';

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

const CAPS = ['rl2.read-open', 'rl2.browser-screencast'];
const TAB = 'b_000000000001';
const OTHER = 'b_000000000002';
const id16 = () => randomBytes(16).toString('base64url');

async function start(options: StartOptions = {}) {
  const f = await startEndpoint(org, started, options);
  return { f, browser: fakeBrowser(f.services) };
}
type Browser = ReturnType<typeof fakeBrowser>;

/** A lane B session: its engine host row, its spine record and its member record. */
function session(f: Fixture, app: string, owners: string[], fields: Partial<SessionRecord> = {}): string {
  const s = f.host.add(app);
  f.spine.set(app, s.engineSessionId);
  f.records.set({ lane: 'B', session: s.engineSessionId!, owners, access: 'private', ...fields }, app);
  return s.engineSessionId!;
}
const share = (member: string, grade: 'view' | 'approve') => ({ shares: [{ member, grade }] });
/** The session's agent tabs under `epoch`, as the machine's tab engine holds them. */
const tabs = (browser: Browser, app: string, epoch = 'ep-1') =>
  browser.set(app, {
    epoch,
    selected: TAB,
    tabs: [
      { tabId: TAB, title: 'dev server', url: 'http://127.0.0.1:5173/', control: 'agent' },
      { tabId: OTHER, title: 'docs', url: 'http://127.0.0.1:8080/', control: 'idle' },
    ],
  });

type Open = { appSessionId: string; epoch: string; tabId: string; control?: { op: string } };
/** A screencast open and the endpoint's answer (`streamOpened` or `streamRefused`). */
async function openView(r: Remote, browser: Open, credit = 4 * 1024 * 1024): Promise<{ id: string; answer: Msg }> {
  const id = id16();
  const from = r.inbox.length;
  await r.channel.send({ t: 'streamOpen', id, kind: 'browser.screencast', credit, browser });
  return { id, answer: await waitFor(r, (m) => m.id === id && (m.t === 'streamOpened' || m.t === 'streamRefused'), `the answer to stream ${id}`, from) };
}
const ofStream = (r: Remote, id: string) => r.inbox.filter((m) => (m as Msg).id === id) as Msg[];
/** The frames the stream carried so far, read as the device reads them. */
function frames(r: Remote, id: string): ScreencastFrame[] {
  const reader = new ScreencastFrameReader();
  return ofStream(r, id)
    .filter((m) => m.t === 'streamData')
    .flatMap((m) => reader.push(m.offset as number, new Uint8Array(Buffer.from(m.data as string, 'base64url'))));
}
const closeOf = (r: Remote, id: string) => ofStream(r, id).find((m) => m.t === 'streamClose')?.reason as string | undefined;
const closed = (r: Remote, id: string) => until(() => closeOf(r, id), `stream ${id}'s close`);
const control = (r: Remote, id: string, body: Record<string, unknown>) => r.channel.send({ t: 'streamControl', id, control: body });
const latest = (browser: Browser) => browser.views.at(-1)!;

/** `machine.browserControl` on the session and epoch, stepped up unless `stepUp` is false; its ack's word and its outcome. */
async function grant(f: Fixture, r: Remote, appSessionId: string, epoch: string, stepUp = true): Promise<{ action: Action; ack: string; outcome?: unknown }> {
  const plain = r.device.action({ machine: f.ref, action: 'machine.browserControl', args: { appSessionId, epoch } });
  const action = stepUp ? await r.device.stepUp(plain) : plain;
  const from = r.inbox.length;
  const ack = await act(r, action);
  return { action, ack, ...(ack === 'ok' ? { outcome: await done(r, action, from) } : {}) };
}

/** A feed of `browser.inventory` on the session, and its answer (`subbed` or `ended`). */
async function inventoryFeed(r: Remote, sub: string, app: string): Promise<Msg> {
  const from = r.inbox.length;
  await r.channel.send({ t: 'sub', sub, session: { lane: 'B', id: app }, feed: 'browser.inventory', cursor: null, credit: 4 * 1024 * 1024 });
  return waitFor(r, (m) => m.sub === sub && (m.t === 'subbed' || m.t === 'ended'), `the answer to feed ${sub}`, from);
}

describe('the rows and the words (§K)', () => {
  it('offers the stream at `view` by effect and the act at `approve`, each on the session, and the feed; lists the capability', () => {
    expect(READ_OPENS['browser.screencast']).toBe('browser.screencast');
    expect(OFFERS.commands['browser.screencast']).toMatchObject({ kind: 'stream', stream: 'browser.screencast', executor: 'endpoint', target: 'appSessionId', grade: { floor: 'view', byEffect: true } });
    expect(OFFERS.commands['machine.browserControl']).toMatchObject({ kind: 'act', executor: 'endpoint', target: 'appSessionId', grade: 'approve' });
    expect(OWN_ACTIONS.has('machine.browserControl')).toBe(true);
    expect(OFFERS.feeds).toContain('browser.inventory');
    expect(ENDPOINT_CAPABILITIES).toContain('rl2.browser-screencast');
    const rule = BY_EFFECT['browser.screencast'] as EffectRule;
    const reads = {} as EffectReads; // the rule reads nothing beyond its input
    expect(rule({ appSessionId: 'a', epoch: 'e', tabId: TAB }, reads)).toBe('view');
    expect(rule({ appSessionId: 'a', epoch: 'e', tabId: TAB, control: { op: 'op-0000000000000001' } }, reads)).toBe('approve');
  });

  it('maps every word of `mawsd`’s to a hyphenated one of RL2’s, an unknown one to `producer-failed` and `unavailable`', () => {
    for (const [word, { refused, closed }] of Object.entries(BROWSER_WORDS)) {
      expect(word).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(refusalWord(word)).toBe(refused);
      if (closed !== undefined) expect([word, closeWord(word)]).toEqual([word, word.replaceAll('_', '-')]);
    }
    expect(Object.fromEntries(Object.entries(BROWSER_WORDS).map(([word, row]) => [word, row.refused]))).toEqual({
      tab_closed: 'unknown',
      view_gone: 'unknown',
      frame_too_large: 'unavailable',
      producer_failed: 'unavailable',
      engine_changed: 'engine-changed',
      control_busy: 'control-busy',
      input_overflow: 'unavailable',
      unavailable: 'unavailable',
      viewers: 'busy',
      invalid: 'malformed',
      read_only: 'read-only',
      closed: 'unavailable',
    });
    expect([closeWord('a_newer_word'), refusalWord('a_newer_word')]).toEqual(['producer-failed', 'unavailable']);
    expect(closeWord('control_busy')).toBe('producer-failed'); // a word that only refuses never closes a stream
  });
});

describe('a read-only screencast', () => {
  it('opens at `view` on the session, answers its epoch and tab, then carries the producer’s frames in the envelope and takes `ack`s', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine'], share(org.B, 'view'));
    tabs(browser, 'app-1');
    const b = await openRemote(f, org.b1, org.B, { capabilities: CAPS });
    const { id, answer } = await openView(b, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB });
    expect(answer).toMatchObject({ t: 'streamOpened', browser: { epoch: 'ep-1', tabId: TAB, control: false } });
    const view = latest(browser);
    expect(view.input).toEqual({ appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB, control: false });
    const sent = view.frame(1, 3000);
    await until(() => frames(b, id).length === 1 || undefined, 'the frame');
    const { jpeg, ...meta } = sent;
    expect(frames(b, id)[0]).toEqual({ ...meta, jpeg });
    await control(b, id, { ack: { seq: 1 } });
    await until(() => view.acks.length === 1 || undefined, 'the ack');
    expect(view.acks).toEqual([1]);
    view.frame(2, 10);
    await until(() => frames(b, id).length === 2 || undefined, 'the second frame');
    expect(closeOf(b, id)).toBeUndefined();
  });

  it('closes `malformed` on an input, data, or a control of another shape, the view let go', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine']);
    tabs(browser, 'app-1');
    const a = await openRemote(f, org.a1, org.A, { capabilities: CAPS });
    for (const bad of [{ input: { seq: 1, event: { kind: 'blur' } } }, { resize: { cols: 1, rows: 1 } }, { ack: { seq: 0 } }]) {
      const { id } = await openView(a, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB });
      await control(a, id, bad);
      expect([bad, await closed(a, id)]).toEqual([bad, 'malformed']);
      expect(latest(browser).closed).toBe(true);
      expect(latest(browser).inputs).toEqual([]);
    }
    const { id } = await openView(a, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB });
    await a.channel.send({ t: 'streamData', id, offset: 0, data: 'AAAA' });
    expect(await closed(a, id)).toBe('malformed');
  });

  it('refuses a session the member doesn’t view `grade`, another epoch `engine-changed`, a tab not held `unknown`, an engine-less session `unavailable`, opening nothing', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine'], share(org.B, 'view'));
    session(f, 'app-2', ['@machine']);
    session(f, 'app-3', ['@machine'], share(org.B, 'view'));
    tabs(browser, 'app-1');
    tabs(browser, 'app-2');
    const b = await openRemote(f, org.b1, org.B, { capabilities: CAPS });
    const reason = async (open: Open) => (await openView(b, open)).answer.reason;
    expect(await reason({ appSessionId: 'app-2', epoch: 'ep-1', tabId: TAB })).toBe('grade');
    expect(await reason({ appSessionId: 'app-9', epoch: 'ep-1', tabId: TAB })).toBe('grade');
    expect(await reason({ appSessionId: 'app-1', epoch: 'ep-0', tabId: TAB })).toBe('engine-changed');
    expect(await reason({ appSessionId: 'app-1', epoch: 'ep-1', tabId: 'b_00000000000f' })).toBe('unknown');
    expect(await reason({ appSessionId: 'app-3', epoch: 'none', tabId: TAB })).toBe('unavailable');
    browser.refuse = 'viewers';
    expect(await reason({ appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB })).toBe('busy');
    browser.refuse = 'invalid';
    expect(await reason({ appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB })).toBe('malformed');
    expect(browser.views).toEqual([]);
    expect(b.channel.closed).toBe(false);
  });

  it('refuses `malformed` an open from a device that listed no `rl2.browser-screencast`, and fields the row does not take', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine']);
    tabs(browser, 'app-1');
    const old = await openRemote(f, org.a1, org.A, { capabilities: ['rl2.read-open'] });
    expect((await openView(old, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB })).answer).toMatchObject({ t: 'streamRefused', reason: 'malformed' });
    const a = await openRemote(f, org.a1, org.A, { capabilities: CAPS });
    const id = id16();
    await a.channel.send({ t: 'streamOpen', id, kind: 'browser.screencast', credit: 1024, browser: { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB, extra: 1 } });
    expect(await waitFor(a, (m) => m.id === id && m.t === 'streamRefused', 'the refusal')).toMatchObject({ reason: 'malformed' });
    expect(browser.views).toEqual([]);
  });

  it('holds a frame the producer sent before the stream was published, and sends it after `streamOpened`', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine']);
    tabs(browser, 'app-1');
    browser.framed = true;
    const a = await openRemote(f, org.a1, org.A, { capabilities: CAPS });
    const { id, answer } = await openView(a, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB });
    expect(answer.t).toBe('streamOpened');
    await until(() => frames(a, id).length === 1 || undefined, 'the first frame');
    const kinds = ofStream(a, id).map((m) => m.t);
    expect(kinds.indexOf('streamOpened')).toBeLessThan(kinds.indexOf('streamData'));
  });

  it('sends a frame within the device’s byte credit, the rest as credit comes, and closes `behind` past one frame plus 4 KiB held', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine']);
    tabs(browser, 'app-1');
    const a = await openRemote(f, org.a1, org.A, { capabilities: CAPS });
    const { id } = await openView(a, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB }, 10_000);
    const view = latest(browser);
    view.frame(1, 200_000);
    const sent = () => ofStream(a, id).filter((m) => m.t === 'streamData').reduce((n, m) => n + Buffer.from(m.data as string, 'base64url').byteLength, 0);
    await until(() => sent() === 10_000 || undefined, 'the credit spent');
    await sleep(30);
    expect(sent()).toBe(10_000);
    await a.channel.send({ t: 'streamCredit', id, bytes: 4 * 1024 * 1024 });
    await until(() => frames(a, id).length === 1 || undefined, 'the frame whole');
    // A device that acknowledges without taking: the producer's frames pile past the bound.
    const stuck = await openView(a, { appSessionId: 'app-1', epoch: 'ep-1', tabId: OTHER }, 1);
    const pile = latest(browser);
    pile.frame(1, 1024 * 1024);
    pile.frame(2, 1024 * 1024);
    expect(await closed(a, stuck.id)).toBe('behind');
    expect(pile.closed).toBe(true);
  });

  it('closes with the producer’s word hyphenated, and an unknown word as `producer-failed`, logged; a frame past 1 MiB `frame-too-large`', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine']);
    tabs(browser, 'app-1');
    const a = await openRemote(f, org.a1, org.A, { capabilities: CAPS });
    for (const [word, wire] of [
      ['tab_closed', 'tab-closed'],
      ['engine_changed', 'engine-changed'],
      ['view_gone', 'view-gone'],
      ['input_overflow', 'input-overflow'],
      ['a_newer_word', 'producer-failed'],
    ]) {
      const { id } = await openView(a, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB });
      latest(browser).end(word);
      expect([word, await closed(a, id)]).toEqual([word, wire]);
    }
    expect(f.services.lines.some((line) => line.includes('a_newer_word'))).toBe(true);
    const { id } = await openView(a, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB });
    latest(browser).frame(1, 1024 * 1024 + 1);
    expect(await closed(a, id)).toBe('frame-too-large');
    expect(latest(browser).closed).toBe(true);
  });

  it('lets the view go when the device closes the stream, or its channel goes', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine']);
    tabs(browser, 'app-1');
    const a = await openRemote(f, org.a1, org.A, { capabilities: CAPS });
    const { id } = await openView(a, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB });
    await a.channel.send({ t: 'streamClose', id, reason: 'closed' });
    await until(() => latest(browser).closed || undefined, 'the view closed');
    await openView(a, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB });
    a.channel.close('closed');
    await until(() => latest(browser).closed || undefined, 'the view closed with its channel');
  });
});

describe('control', () => {
  it('grants the owner control with no step-up, the grant `{appSessionId, epoch}`, idempotent under its op and for the same binding', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine']);
    tabs(browser, 'app-1');
    const a = await openRemote(f, org.a1, org.A, { capabilities: CAPS });
    const first = await grant(f, a, 'app-1', 'ep-1', false);
    expect(first).toMatchObject({ ack: 'ok', outcome: { state: 'done', result: { appSessionId: 'app-1', epoch: 'ep-1' } } });
    const from = a.inbox.length;
    expect(await act(a, a.device.reseal(first.action))).toBe('ok');
    expect(await done(a, first.action, from)).toEqual(first.outcome);
    expect((await grant(f, a, 'app-1', 'ep-1', false)).outcome).toEqual(first.outcome);
    // An epoch the session's tab engine has left grants nothing.
    expect((await grant(f, a, 'app-1', 'ep-0', false)).outcome).toMatchObject({ state: 'failed', error: { code: 'engine-changed' } });
  });

  it('opens a controlling stream naming the done act, its input reaching the producer in order', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine']);
    tabs(browser, 'app-1');
    const a = await openRemote(f, org.a1, org.A, { capabilities: CAPS });
    const { action } = await grant(f, a, 'app-1', 'ep-1', false);
    const { id, answer } = await openView(a, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB, control: { op: action.opId } });
    expect(answer).toMatchObject({ t: 'streamOpened', browser: { epoch: 'ep-1', tabId: TAB, control: true } });
    const view = latest(browser);
    expect(view.input.control).toBe(true);
    view.frame(1);
    await control(a, id, { input: { seq: 1, event: { kind: 'pointer', type: 'down', x: 10, y: 20, button: 'left', buttons: 1, clickCount: 1, modifiers: [] } } });
    await control(a, id, { input: { seq: 2, event: { kind: 'text', text: 'hi' } } });
    await until(() => view.inputs.length === 2 || undefined, 'the input');
    expect(view.inputs.map(([seq, event]) => [seq, event.kind])).toEqual([
      [1, 'pointer'],
      [2, 'text'],
    ]);
  });

  it('refuses a controlling open whose act is not this channel’s grant of this session and epoch `grade`, an unknown op `unknown`, a second controller `control-busy`', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine'], share(org.B, 'approve'));
    session(f, 'app-2', ['@machine']);
    tabs(browser, 'app-1');
    tabs(browser, 'app-2');
    const a = await openRemote(f, org.a1, org.A, { capabilities: CAPS });
    const b = await openRemote(f, org.b1, org.B, { capabilities: CAPS });
    const mine = (await grant(f, a, 'app-1', 'ep-1', false)).action.opId;
    const other = (await grant(f, a, 'app-2', 'ep-1', false)).action.opId;
    const forward = a.device.action({ machine: f.ref, action: 'forward.open', args: { port: 9 } });
    await act(a, forward);
    const open = (r: Remote, op: string, fields: Partial<Open> = {}) => openView(r, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB, control: { op }, ...fields });
    expect((await open(b, mine)).answer.reason).toBe('grade'); // another member's grant
    expect((await open(a, other)).answer.reason).toBe('grade'); // another session's
    expect((await open(a, forward.opId)).answer.reason).toBe('grade'); // not a control act
    expect((await open(a, 'op-unknown-0000000001')).answer.reason).toBe('unknown');
    expect(browser.views).toEqual([]);
    expect((await open(a, mine)).answer.t).toBe('streamOpened');
    expect((await open(a, mine)).answer.reason).toBe('control-busy');
    expect((await open(a, mine, { tabId: OTHER })).answer.t).toBe('streamOpened');
  });

  it('refuses control to a member who views only (`grade`, at the act and at the open) and to a read-only machine (`read-only`)', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine'], share(org.B, 'view'));
    tabs(browser, 'app-1');
    const b = await openRemote(f, org.b1, org.B, { capabilities: CAPS });
    expect((await grant(f, b, 'app-1', 'ep-1')).ack).toBe('grade');
    const a = await openRemote(f, org.a1, org.A, { capabilities: CAPS });
    const { action } = await grant(f, a, 'app-1', 'ep-1', false);
    expect((await openView(b, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB, control: { op: action.opId } })).answer.reason).toBe('grade');
    f.endpoint.policy.set({ read_only: true });
    expect((await openView(a, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB, control: { op: action.opId } })).answer.reason).toBe('read-only');
    expect((await openView(a, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB })).answer.t).toBe('streamOpened');
  });
});

describe('O10’s pins (§K)', () => {
  it('1. asks a non-owner’s step-up once per grant, again for each new epoch; never the owner’s, nor the spawner’s before sminos’s record', async () => {
    const { f, browser } = await start({ records: new SminosRecords() });
    f.host.add('app-1', 'eng-1');
    f.spine.set('app-1', 'eng-1');
    f.host.add('app-s', 'eng-s');
    f.spine.set('app-s', 'eng-s', { launchedBy: { member: org.B, device: 'b1', opId: 'op-spawn-000000000001', action: null } });
    await sminos(f, [laneAMember(), laneBMember('eng-1', ['@machine'], { shares: [{ member: org.B, grade: 'approve' }] })]);
    tabs(browser, 'app-1');
    tabs(browser, 'app-s');
    const b = await openRemote(f, org.b1, org.B, { capabilities: CAPS });
    expect((await grant(f, b, 'app-1', 'ep-1', false)).ack).toBe('step-up');
    const stepped = await grant(f, b, 'app-1', 'ep-1');
    expect(stepped.ack).toBe('ok');
    // The grant serves every open of its epoch with no further step-up.
    for (const tabId of [TAB, OTHER]) expect((await openView(b, { appSessionId: 'app-1', epoch: 'ep-1', tabId, control: { op: stepped.action.opId } })).answer.t).toBe('streamOpened');
    // A handover mints a new epoch: the old grant names nothing of it, and a new grant asks the step-up again.
    tabs(browser, 'app-1', 'ep-2');
    expect((await openView(b, { appSessionId: 'app-1', epoch: 'ep-2', tabId: TAB, control: { op: stepped.action.opId } })).answer.reason).toBe('grade');
    expect((await grant(f, b, 'app-1', 'ep-2', false)).ack).toBe('step-up');
    expect((await grant(f, b, 'app-1', 'ep-2')).ack).toBe('ok');
    // The spawner owns their session through M11's bridge, and the machine's owner owns every session: neither steps up.
    expect((await grant(f, b, 'app-s', 'ep-1', false)).ack).toBe('ok');
    const a = await openRemote(f, org.a1, org.A, { capabilities: CAPS });
    expect((await grant(f, a, 'app-1', 'ep-2', false)).ack).toBe('ok');
  });

  it('2. refuses a web-cards device `class`: the act and the controlling open at the WEB_CARDS allowlist, the feed at the subscription', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', [org.C]);
    tabs(browser, 'app-1');
    const c = await openRemote(f, org.c1, org.C, { capabilities: CAPS, passkey: org.passkey });
    expect((await grant(f, c, 'app-1', 'ep-1', false)).ack).toBe('class');
    const who = { member: org.C, device: org.c1.device.id, clientClass: 'web-cards' as const };
    for (const input of [
      { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB },
      { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB, control: { op: 'op-0000000000000001' } },
    ])
      expect(await f.endpoint.authorizer.authorize({ kind: 'stream', name: 'browser.screencast', input }, who, Date.now())).toEqual({ ok: false, reason: 'class' });
    // On the wire a stream's refusal has no `class`: the device reads it `grade`.
    expect((await openView(c, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB })).answer.reason).toBe('grade');
    expect(await inventoryFeed(c, 'inv', 'app-1')).toMatchObject({ t: 'ended', reason: 'class' });
    expect(browser.views).toEqual([]);
  });

  it('3. answers a claim the last process left unfinished `expired`; a done grant held across a restart validates nothing once the epoch moved', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine']);
    tabs(browser, 'app-1');
    const a = await openRemote(f, org.a1, org.A, { capabilities: CAPS });
    const kept = await grant(f, a, 'app-1', 'ep-1', false);
    const orphan = a.device.action({ machine: f.ref, action: 'machine.browserControl', args: { appSessionId: 'app-1', epoch: 'ep-1' } });
    await f.endpoint.stop();
    started.splice(started.indexOf(f), 1);
    const claim = { member: org.A, device: org.a1.device.id, fingerprint: await actionFingerprint(orphan), target: null, name: 'machine.browserControl' };
    expect(OpLedger.open(f.services.machine.stateDir, 'ops.jsonl').begin(orphan.opId, orphan.opCreated, claim, () => null)).toEqual({ kind: 'claimed' });
    const g = await startEndpoint(org, started, { services: f.services, host: f.host, records: f.records, chain: f.chain, key: f.key });
    tabs(browser, 'app-1', 'ep-2'); // the restarted mawsd's route minted a new epoch
    const a2 = await openRemote(g, org.a1, org.A, { capabilities: CAPS });
    const from = a2.inbox.length;
    await a2.channel.send({ t: 'query', opId: orphan.opId, opCreated: orphan.opCreated, executor: 'endpoint' });
    expect(await waitFor(a2, (m) => m.t === 'queried' && m.opId === orphan.opId, 'the query', from)).toMatchObject({ state: 'expired' });
    expect((await openView(a2, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB, control: { op: kept.action.opId } })).answer.reason).toBe('engine-changed');
    expect((await openView(a2, { appSessionId: 'app-1', epoch: 'ep-2', tabId: TAB, control: { op: kept.action.opId } })).answer.reason).toBe('grade');
    expect(browser.views).toEqual([]);
  });

  it('4. re-authorizes a controlling stream at every record change: control lost closes it `control-revoked`, its queued input dropped; view lost `removed`', async () => {
    const { f, browser } = await start();
    const engine = session(f, 'app-1', ['@machine'], share(org.B, 'approve'));
    tabs(browser, 'app-1');
    const b = await openRemote(f, org.b1, org.B, { capabilities: CAPS });
    const { action } = await grant(f, b, 'app-1', 'ep-1');
    const { id } = await openView(b, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB, control: { op: action.opId } });
    const view = latest(browser);
    const viewer = await openView(b, { appSessionId: 'app-1', epoch: 'ep-1', tabId: OTHER });
    view.frame(1);
    // The re-check held: input sent meanwhile waits, and is dropped once control is gone.
    const authorizer = f.endpoint.authorizer;
    const authorize = authorizer.authorize.bind(authorizer);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    authorizer.authorize = async (...args) => (await gate, authorize(...args));
    f.records.set({ lane: 'B', session: engine, owners: ['@machine'], access: 'private', ...share(org.B, 'view') }, 'app-1');
    await control(b, id, { input: { seq: 1, event: { kind: 'text', text: 'late' } } });
    await sleep(30);
    release();
    expect(await closed(b, id)).toBe('control-revoked');
    expect(view.closed).toBe(true);
    expect(view.inputs).toEqual([]);
    // The read-only stream beside it stands on `view`, and ends `removed` once that goes too.
    expect(closeOf(b, viewer.id)).toBeUndefined();
    authorizer.authorize = authorize;
    f.records.set({ lane: 'B', session: engine, owners: ['@machine'], access: 'private' }, 'app-1');
    expect(await closed(b, viewer.id)).toBe('removed');
    // A controlling stream whose member loses everything ends `removed`.
    f.records.set({ lane: 'B', session: engine, owners: ['@machine'], access: 'private', ...share(org.B, 'approve') }, 'app-1');
    const again = await grant(f, b, 'app-1', 'ep-1');
    const third = await openView(b, { appSessionId: 'app-1', epoch: 'ep-1', tabId: TAB, control: { op: again.action.opId } });
    f.records.set({ lane: 'B', session: engine, owners: ['@machine'], access: 'private' }, 'app-1');
    expect(await closed(b, third.id)).toBe('removed');
  });

  it('4. takes the spawner’s control away when sminos’s record arrives granting less, as for every stream (M11’s hand-off)', async () => {
    const { f, browser } = await start({ records: new SminosRecords() });
    f.host.add('app-s', 'eng-s');
    f.spine.set('app-s', 'eng-s', { launchedBy: { member: org.B, device: 'b1', opId: 'op-spawn-000000000001', action: null } });
    tabs(browser, 'app-s');
    const b = await openRemote(f, org.b1, org.B, { capabilities: CAPS });
    const { action, ack } = await grant(f, b, 'app-s', 'ep-1', false);
    expect(ack).toBe('ok');
    const { id, answer } = await openView(b, { appSessionId: 'app-s', epoch: 'ep-1', tabId: TAB, control: { op: action.opId } });
    expect(answer.t).toBe('streamOpened');
    await sminos(f, [laneAMember(), laneBMember('eng-s', [org.C], { shares: [{ member: org.B, grade: 'view' }] })]);
    expect(await closed(b, id)).toBe('control-revoked');
  });
});

describe('the `browser.inventory` feed', () => {
  it('opens as a snapshot of the session’s tabs at `view`, then a complete inventory at each change, and ends `removed` once view goes', async () => {
    const { f, browser } = await start();
    const engine = session(f, 'app-1', ['@machine'], share(org.B, 'view'));
    const first = tabs(browser, 'app-1');
    const b = await openRemote(f, org.b1, org.B, { capabilities: CAPS });
    const subbed = await inventoryFeed(b, 'inv', 'app-1');
    expect(subbed).toMatchObject({ t: 'subbed', mode: 'snapshot', seq: 0, epoch: expect.stringMatching(/^browser\.inventory:/) });
    expect((await snapshot(b, 'inv')).body).toEqual(first);
    const second = browser.set('app-1', { tabs: first.tabs.slice(1), selected: OTHER });
    await until(() => evs(b, 'inv').length === 1 || undefined, 'the change');
    expect(evs(b, 'inv')).toEqual([{ epoch: subbed.epoch, seq: 1, body: second }]);
    const third = tabs(browser, 'app-1', 'ep-2');
    await until(() => evs(b, 'inv').length === 2 || undefined, 'the next change');
    expect(evs(b, 'inv')[1]).toEqual({ epoch: subbed.epoch, seq: 2, body: third });
    f.records.set({ lane: 'B', session: engine, owners: ['@machine'], access: 'private' }, 'app-1');
    expect(await waitFor(b, (m) => m.sub === 'inv' && m.t === 'ended', 'the end')).toMatchObject({ reason: 'removed' });
    expect(browser.watchers('app-1')).toBe(0);
  });

  it('refuses a session the member doesn’t view `grade`, and stops watching once unsubscribed or its channel goes', async () => {
    const { f, browser } = await start();
    session(f, 'app-1', ['@machine']);
    tabs(browser, 'app-1');
    const b = await openRemote(f, org.b1, org.B, { capabilities: CAPS });
    expect(await inventoryFeed(b, 'inv', 'app-1')).toMatchObject({ t: 'ended', reason: 'grade' });
    const a = await openRemote(f, org.a1, org.A, { capabilities: CAPS });
    await inventoryFeed(a, 'inv', 'app-1');
    expect(browser.watchers('app-1')).toBe(1);
    await a.channel.send({ t: 'unsub', sub: 'inv' });
    await until(() => browser.watchers('app-1') === 0 || undefined, 'the watch ended');
    await inventoryFeed(a, 'inv2', 'app-1');
    expect(of(a, 'inv2').some((m) => m.t === 'snap')).toBe(true);
    a.channel.close('closed');
    await until(() => browser.watchers('app-1') === 0 || undefined, 'the watch ended with its channel');
  });
});

// ---- P5 O12 M11's records, as sminos reports them (artifact-rule.test.ts' pattern) --------------------------------------

class SminosRecords extends Records {
  #members: RecordSource | null = null;
  override bindLaneA(source: RecordSource): void {
    super.bindLaneA(source);
    this.#members = source;
  }
  override record(target: SessionTarget): SessionRecord | null {
    return this.#members?.record(target) ?? null;
  }
  handedOff(target: SessionTarget): boolean {
    return this.#members?.handedOff?.(target) ?? true;
  }
}
const laneBMember = (session: string, owners: string[], fields: Record<string, unknown> = {}) => ({
  session, alias: 'spawned', project: PROJECT, lane: 'B', state: 'idle', title: 'spawned', cwd: CHECKOUT, owners, ownersProof: [], origin: { kind: 'maws', requester: owners[0] }, ...fields,
});
