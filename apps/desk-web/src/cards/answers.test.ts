// An answer from the phone (P5 O13 M4, §D; RL4, RL §5.10): the action built in exactly one of §D's five forms, sealed
// with a fresh nonce and a WebAuthn assertion over its digest, its `ack` and `done` read into the client's `Outcome`
// (a `done` is an envelope, never a success by itself), and a lost acknowledgement resealed under the operation it
// retained, which keeps every field the ledgers' fingerprint binds.
import { actionDigest, actionFingerprint, base64urlEncode, canonicalize, generateSigningKey, verifyWebAuthn, type Action, type DeviceIdentity } from 'org-protocol';
import { SoftwareAuthenticator } from 'org-protocol/test-support';
import { beforeAll, describe, expect, it } from 'vitest';
import { inputSha256 } from 'desk-hub/protocol';
import type { SessionEvent } from '@shared/graph/events';
import { requestDigestOf } from '@shared/host/request-digest';
import { FakeChannel } from '../../test/channel';
import { AnswerError, answer, operationFor, outcomeOf, retry, type Assert } from './answers';
import { laneACard, laneBCards, type Card } from './cards';

const ORIGIN = 'https://desk.example';
const MACHINE = 'AAAAAAAAAAAAAAAAAAAAAA';
let identity: DeviceIdentity;
let authenticator: SoftwareAuthenticator;
let assert: Assert;

beforeAll(async () => {
  identity = { org: 'org-cards', member: 'f'.repeat(32), device: 'phone-1', clientClass: 'web-cards', channelKey: await generateSigningKey(), build: 'desk-web/test', capabilities: [] };
  authenticator = new SoftwareAuthenticator(await generateSigningKey(), base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), 'desk.example');
  assert = (challenge) => authenticator.assert(challenge, ORIGIN);
});

const RAISED = { request: 'toolu_1', session: 'la-1', tool: 'Bash', input: { command: 'pnpm test' } };
const ASKED = { request: 'toolu_2', session: 'la-1', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which way?', options: [{ label: 'left' }] }] } };
const APP = 'app-1';
const PERMISSION = { id: `${APP}:launch-1:1:0`, sessionId: 'eng-1', at: '', seq: 1, agentId: null, parentToolUseId: null, kind: 'permission.requested', requestId: 'rq-p', toolUseId: 'tu-p', toolName: 'Bash', input: { command: 'git log' } } as unknown as SessionEvent;
const QUESTION = { ...PERMISSION, kind: 'question.requested', requestId: 'rq-q', questions: [{ question: 'Which way?', options: [{ label: 'left' }] }] } as unknown as SessionEvent;
const item = (requestId: string, kind: string) => ({ id: `att-${requestId}`, appSessionId: APP, sessionId: 'eng-1', kind, request: { requestId, toolUseId: null, taskId: null, agentId: null }, summary: kind, createdAt: '', state: 'pending', stateChangedAt: '', expiresAt: null });

async function laneB(request: SessionEvent, kind: string): Promise<Card> {
  const id = (request as unknown as { requestId: string }).requestId;
  const [card] = await laneBCards(APP, { pendingItems: [{ item: item(id, kind), request, context: { launchId: 'launch-1', engineSessionId: 'eng-1' }, requestDigest: requestDigestOf(APP, request) }] });
  return card;
}

const NOW = Date.parse('2026-10-28T09:00:00.000Z');
const at = new Date(NOW).toISOString();

/** The operation's fields but the ones minted per operation, for comparing shapes. */
const shape = (op: Record<string, unknown>) => {
  const kept = { ...op };
  expect(kept.opId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  delete kept.opId;
  return kept;
};

describe('the five forms an answer takes, and nothing else', () => {
  it('lane A: a question is `sminos.answer`, a permission `sminos.decide`, each with the session’s launch and the digest twice', async () => {
    const asked = await laneACard(ASKED, 'L1');
    const raised = await laneACard(RAISED, 'L1');
    const qDigest = { session: 'la-1', request: 'toolu_2', tool: 'AskUserQuestion', input_sha256: await inputSha256(ASKED.input) };
    const pDigest = { session: 'la-1', request: 'toolu_1', tool: 'Bash', input_sha256: await inputSha256(RAISED.input) };
    const common = { v: 1, org: 'org-cards', machine: MACHINE, device: 'phone-1', opCreated: at, session: 'la-1', context: { lane: 'A', session: 'la-1', launch: 'L1' } };
    expect(shape(operationFor(identity, MACHINE, asked, { kind: 'question', answers: { 'Which way?': 'left' } }, NOW))).toEqual({ ...common, action: 'sminos.answer', args: { session: 'la-1', answers: { 'Which way?': 'left' }, digest: qDigest }, requestDigest: qDigest });
    for (const decision of ['allow', 'deny'] as const) {
      expect(shape(operationFor(identity, MACHINE, raised, { kind: 'decision', decision }, NOW))).toEqual({ ...common, action: 'sminos.decide', args: { session: 'la-1', decision, digest: pDigest }, requestDigest: pDigest });
    }
    // The ask mod's async question, raised under its MCP name, is answered as a question.
    const ASYNC = { ...ASKED, tool: 'mcp__sminos__AskUserQuestion' };
    const aDigest = { ...qDigest, tool: 'mcp__sminos__AskUserQuestion' };
    expect(shape(operationFor(identity, MACHINE, await laneACard(ASYNC, 'L1'), { kind: 'question', answers: { 'Which way?': 'left' } }, NOW))).toEqual({ ...common, action: 'sminos.answer', args: { session: 'la-1', answers: { 'Which way?': 'left' }, digest: aDigest }, requestDigest: aDigest });
  });

  it('lane B: Allow carries scope once, Deny no scope, a question its answers, byte for byte', async () => {
    const permission = await laneB(PERMISSION, 'permission');
    const question = await laneB(QUESTION, 'question');
    const json = (card: Card, given: Parameters<typeof operationFor>[3]) => {
      const op = operationFor(identity, MACHINE, card, given, NOW);
      return JSON.stringify((op.args as { answer: unknown }).answer);
    };
    expect(json(permission, { kind: 'decision', decision: 'allow' })).toBe('{"kind":"permission","decision":"allow","scope":"once"}');
    expect(json(permission, { kind: 'decision', decision: 'deny' })).toBe('{"kind":"permission","decision":"deny"}');
    expect(json(question, { kind: 'question', answers: { 'Which way?': 'left' } })).toBe('{"kind":"question","answers":{"Which way?":"left"}}');
    expect(shape(operationFor(identity, MACHINE, permission, { kind: 'decision', decision: 'deny' }, NOW))).toEqual({
      v: 1,
      org: 'org-cards',
      machine: MACHINE,
      device: 'phone-1',
      opCreated: at,
      action: 'session.answer',
      session: APP,
      context: { lane: 'B', launchId: 'launch-1', engineSessionId: 'eng-1' },
      args: { appSessionId: APP, requestId: 'rq-p', answer: { kind: 'permission', decision: 'deny' } },
      requestDigest: requestDigestOf(APP, PERMISSION),
    });
  });

  it('builds nothing for a card it cannot answer, or an answer the card does not take', async () => {
    const raised = await laneACard(RAISED, null);
    expect(() => operationFor(identity, MACHINE, raised, { kind: 'decision', decision: 'allow' }, NOW)).toThrow(AnswerError);
    const permission = await laneB(PERMISSION, 'permission');
    expect(() => operationFor(identity, MACHINE, permission, { kind: 'question', answers: {} }, NOW)).toThrow(AnswerError);
    const question = await laneACard(ASKED, 'L1');
    expect(() => operationFor(identity, MACHINE, question, { kind: 'decision', decision: 'allow' }, NOW)).toThrow(AnswerError);
  });
});

describe('outcomes', () => {
  it('reads a `done` envelope by its inner state: only `done` is done, `in-progress` and `unknown` uncertain', () => {
    expect(outcomeOf({ state: 'done', result: { outcome: 'delivered' } })).toEqual({ state: 'done', result: { outcome: 'delivered' } });
    expect(outcomeOf({ state: 'failed', error: { code: 'not_pending' } })).toEqual({ state: 'failed', error: { code: 'not_pending' } });
    expect(outcomeOf({ state: 'refused', reason: 'digest-mismatch' })).toEqual({ state: 'refused', reason: 'digest-mismatch' });
    expect(outcomeOf({ state: 'in-progress' })).toEqual({ state: 'uncertain', why: 'in-progress' });
    expect(outcomeOf({ state: 'unknown', reason: 'host_unavailable' })).toEqual({ state: 'uncertain', why: 'unknown' });
    for (const odd of [null, 'done', { state: 'weird' }, { state: 'refused' }]) expect(outcomeOf(odd), JSON.stringify(odd)).toEqual({ state: 'uncertain', why: 'unknown' });
  });
});

/** A channel answering each `act` as `reply` says (nothing by default). */
function channelReplying(reply: (action: Action, channel: FakeChannel) => void = () => {}): FakeChannel {
  const channel = new FakeChannel(MACHINE);
  channel.respond = (message) => {
    if (message.t === 'act') queueMicrotask(() => reply(message.action as Action, channel));
  };
  return channel;
}

const accepted = (action: Action, channel: FakeChannel, outcome: unknown) => {
  channel.deliver({ t: 'ack', opId: action.opId, state: 'accepted' });
  channel.deliver({ t: 'done', opId: action.opId, outcome });
};

describe('answer', () => {
  it('seals the operation with a nonce, its time and an assertion over its digest, and reads `ack` then `done`', async () => {
    const channel = channelReplying((action, c) => accepted(action, c, { state: 'done', result: {} }));
    const card = await laneACard(RAISED, 'L1');
    const { operation, outcome } = await answer(channel, identity, card, { kind: 'decision', decision: 'allow' }, assert, { now: () => NOW });
    expect(outcome).toEqual({ state: 'done', result: {} });
    const [sent] = channel.of('act').map((m) => m.action as Action);
    expect(sent.created).toBe(at);
    expect(sent.opCreated).toBe(at);
    expect(sent.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const kept: Record<string, unknown> = { ...sent };
    for (const field of ['nonce', 'created', 'webauthn']) delete kept[field];
    expect(canonicalize(operation)).toBe(canonicalize(kept));
    expect(await verifyWebAuthn(sent, authenticator.passkey, ORIGIN, 0)).toMatchObject({ ok: true });
  });

  it('answers an `ack` refusal by its reason, and waits for no `done` after it', async () => {
    const channel = channelReplying((action, c) => c.deliver({ t: 'ack', opId: action.opId, state: 'refused', reason: 'class' }));
    const { outcome } = await answer(channel, identity, await laneACard(RAISED, 'L1'), { kind: 'decision', decision: 'deny' }, assert, { ackMs: 50, doneMs: 50 });
    expect(outcome).toEqual({ state: 'refused', reason: 'class' });
  });

  it('is uncertain with no `ack` in time, with an `ack` and no `done` in time, and when the channel ends first', async () => {
    const card = await laneACard(RAISED, 'L1');
    const decide = { kind: 'decision', decision: 'allow' } as const;
    expect((await answer(channelReplying(), identity, card, decide, assert, { ackMs: 20, doneMs: 1000 })).outcome).toEqual({ state: 'uncertain', why: 'no-ack' });
    const acked = channelReplying((action, c) => c.deliver({ t: 'ack', opId: action.opId, state: 'accepted' }));
    expect((await answer(acked, identity, card, decide, assert, { ackMs: 1000, doneMs: 20 })).outcome).toEqual({ state: 'uncertain', why: 'no-done' });
    const cut = channelReplying((_, c) => c.close('app-gone'));
    expect((await answer(cut, identity, card, decide, assert)).outcome).toEqual({ state: 'uncertain', why: 'no-ack' });
    const cutAfter = channelReplying((action, c) => {
      c.deliver({ t: 'ack', opId: action.opId, state: 'accepted' });
      c.close('app-gone');
    });
    expect((await answer(cutAfter, identity, card, decide, assert)).outcome).toEqual({ state: 'uncertain', why: 'no-done' });
    const closed = channelReplying();
    closed.close();
    expect((await answer(closed, identity, card, decide, assert)).outcome).toEqual({ state: 'uncertain', why: 'no-ack' });
  });

  it('reads only its own operation’s `ack` and `done`', async () => {
    const channel = channelReplying((action, c) => {
      c.deliver({ t: 'ack', opId: 'another-operation-00', state: 'refused', reason: 'class' });
      accepted(action, c, { state: 'done', result: 1 });
    });
    expect((await answer(channel, identity, await laneACard(RAISED, 'L1'), { kind: 'decision', decision: 'allow' }, assert)).outcome).toEqual({ state: 'done', result: 1 });
  });
});

describe('retry', () => {
  it('reseals the retained operation: a fresh nonce, time and gesture, every bound field kept, so the fingerprint is the first copy’s', async () => {
    let clock = NOW;
    const channel = channelReplying();
    const card = await laneB(PERMISSION, 'permission');
    const first = await answer(channel, identity, card, { kind: 'decision', decision: 'allow' }, assert, { now: () => clock, ackMs: 10, doneMs: 10 });
    expect(first.outcome).toEqual({ state: 'uncertain', why: 'no-ack' });
    clock += 30_000;
    const again = channelReplying((action, c) => accepted(action, c, { state: 'done', result: { outcome: 'delivered' } }));
    expect(await retry(again, first.operation, assert, { now: () => clock })).toEqual({ state: 'done', result: { outcome: 'delivered' } });
    const [one] = channel.of('act').map((m) => m.action as Action);
    const [two] = again.of('act').map((m) => m.action as Action);
    expect(two.opId).toBe(one.opId);
    expect(two.opCreated).toBe(one.opCreated);
    expect(two.created).toBe(new Date(clock).toISOString());
    expect(two.nonce).not.toBe(one.nonce);
    expect(two.webauthn).not.toEqual(one.webauthn);
    expect(await actionFingerprint(two)).toBe(await actionFingerprint(one));
    expect(JSON.parse(base64urlDecodeText(two.webauthn!.clientDataJSON)).challenge).toBe(base64urlEncode(await actionDigest(two)));
  });
});

function base64urlDecodeText(text: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
}
