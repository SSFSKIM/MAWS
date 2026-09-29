import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import { setAgentWorkClient } from './client';
import { relayText, restoreDraft } from './model/relay';
import { createRelayStore, relayKey } from './relay-store';
import { event, replayed } from '../../../../../test/support/agents-events';
import { fakeAgentWorkClient, type FakeAgentWorkClient } from './fake-work-client';

const A = 'A' as AppSessionId;
const recorded = replayed('pass3', 'relay-to-child');
const between = (from: number, to: number) => recorded.filter((e) => e.seq !== null && e.seq > from && e.seq <= to);
const LOOPER = { agentId: 'a7aea42f9bed9b3ea' as AgentId, name: null }; // the idle case: steer at 150 (uuid 2fb7478b…), SendMessage at 196
const WALKER = { agentId: 'accea5ba03e220b64' as AgentId, name: null }; // the foreground case: steer at 454 (uuid e58f0d75…), ended 517, SendMessage 543, resumed 548
const IDLE_UUID = '2fb7478b-2a11-4ae1-8e85-588fd92bd1d3';
const FOREGROUND_UUID = 'e58f0d75-f2f8-428b-b42d-c725406929a5';

let fake: FakeAgentWorkClient;
let relays: ReturnType<typeof createRelayStore>;
const relayOf = (agent: { agentId: AgentId }) => relays.getState().relays.get(relayKey(A, agent.agentId));
const stateOf = (agent: { agentId: AgentId }) => relayOf(agent)?.state;
const send = async (agent: { agentId: AgentId; name: string | null }, text: string, uuid: string, parentTurnOpen = false) => {
  const sent = relays.getState().send(A, agent, text, parentTurnOpen);
  await fake.answer('steer', { messageUuid: uuid });
  await sent;
};
const batch = (events: SessionEvent[]) => fake.batch('A', events);

beforeEach(() => {
  fake = fakeAgentWorkClient();
  setAgentWorkClient(fake.client);
  relays = createRelayStore();
});

afterEach(() => setAgentWorkClient(null));

describe('relay store', () => {
  it('sends one next steer with relayText and moves to asked with the uuid and the turn state', async () => {
    expect(fake.listeners()).toBe(0);
    const sent = relays.getState().send(A, LOOPER, 'Say PING in your next inbox line', true);
    expect(fake.listeners()).toBe(1); // subscribed before the steer goes out
    expect(fake.inputs.steer).toEqual([['A', relayText(LOOPER, 'Say PING in your next inbox line'), 'next']]);
    await fake.answer('steer', { messageUuid: IDLE_UUID });
    await sent;
    expect(stateOf(LOOPER)).toMatchObject({ kind: 'asked', messageUuid: IDLE_UUID, parentTurnOpenAtSend: true, childEndedAt: null, sentSeq: null });
    expect(relayOf(LOOPER)).toMatchObject({ appSessionId: 'A', agentId: LOOPER.agentId, name: null, text: 'Say PING in your next inbox line' });
  });

  it('moves to forwarded on the recorded SendMessage with the parent rounds counted per message, and rests there with no receipt (O3)', async () => {
    await send(LOOPER, 'Say PING in your next inbox line', IDLE_UUID);
    batch(between(150, 200));
    expect(stateOf(LOOPER)).toMatchObject({ kind: 'forwarded', toolUseId: 'toolu_01Qaxf8jouoxCCBVYbapoat5', forwardedAt: '2026-09-29T15:47:32.278Z', parentRounds: 2, childEndedAt: null });
    batch(between(200, 290)); // the child's next rounds: it acted on the message (seq 225) but no receipt reaches the wire
    expect(stateOf(LOOPER)?.kind).toBe('forwarded');
    expect(fake.listeners()).toBe(1);
  });

  it('counts the rounds from the steer, not before it: a busy parent folds it in at its next tool boundary (1 round)', async () => {
    await send(WALKER, 'unrelated', 'another-uuid'); // a relay already pending keeps the session subscribed
    batch(between(200, 285)); // the parent's own rounds before the steer, its sleep 45 among them
    await send(LOOPER, 'Say PONG in your next inbox line', 'be019ba5-e49d-4ce6-8116-9a893ac8520f', true);
    expect(stateOf(LOOPER)).toMatchObject({ kind: 'asked', parentTurnOpenAtSend: true });
    expect((stateOf(LOOPER) as { sentSeq: number | null }).sentSeq).toBeGreaterThan(270);
    batch(between(285, 320));
    expect(stateOf(LOOPER)).toMatchObject({ kind: 'forwarded', toolUseId: 'toolu_01XHfXNYpLn3zuvyD7quV2Ek', parentRounds: 1 });
    expect(stateOf(WALKER)?.kind).toBe('asked');
  });

  it('takes the parent’s SendMessage and its rounds in the live form only', async () => {
    await send(LOOPER, 'Say PING', IDLE_UUID);
    const disk = (e: SessionEvent) => ({ ...e, seq: null, id: `disk-${e.id}` }) as SessionEvent;
    batch(between(150, 200).map(disk));
    expect(stateOf(LOOPER)?.kind).toBe('asked');
    batch(between(150, 200));
    expect(stateOf(LOOPER)).toMatchObject({ kind: 'forwarded', parentRounds: 2 });
  });

  it('moves to delivered on a receipt in the child’s stream, live or disk form', async () => {
    await send(LOOPER, 'Say PING', IDLE_UUID);
    batch(between(150, 200));
    batch([event('user.message', { agentId: LOOPER.agentId, content: 'The coordinator sent a message while you were working:\nSay PING' }, { seq: null, at: '2026-09-29T15:47:33.000Z' })]);
    expect(stateOf(LOOPER)).toEqual({ kind: 'delivered', deliveredAt: '2026-09-29T15:47:33.000Z' });
    expect(fake.listeners()).toBe(0);
  });

  it('dismisses a forwarded relay when its agent ends', async () => {
    await send(LOOPER, 'Say PING', IDLE_UUID);
    batch(between(150, 200));
    batch([event('subagent.finished', { taskId: LOOPER.agentId, agentId: LOOPER.agentId }, { seq: 201 })]);
    expect(relayOf(LOOPER)).toBeUndefined();
    expect(fake.listeners()).toBe(0);
  });

  it('keeps an asked relay whose agent ended with childEndedAt, forwards it on the SendMessage, and delivers it on the resume start (seq 548)', async () => {
    await send(WALKER, 'Say PANG in your next inbox line', FOREGROUND_UUID, true);
    batch(between(454, 520));
    expect(stateOf(WALKER)).toMatchObject({ kind: 'asked', childEndedAt: '2026-09-29T15:49:19.672Z' });
    batch(between(520, 547));
    expect(stateOf(WALKER)).toMatchObject({ kind: 'forwarded', toolUseId: 'toolu_01LhBx8vFkJpnjJqTP5YyNyn', parentRounds: 1, childEndedAt: '2026-09-29T15:49:19.672Z' });
    batch([event('subagent.finished', { taskId: WALKER.agentId, agentId: WALKER.agentId }, { seq: 547 })]); // not dismissed: it was forwarded to an ended agent
    expect(stateOf(WALKER)?.kind).toBe('forwarded');
    batch(between(547, 548));
    expect(stateOf(WALKER)).toEqual({ kind: 'delivered', deliveredAt: '2026-09-29T15:49:21.222Z' });
  });

  it('a refused steer reads failed with the message; the draft stays with the composer', async () => {
    const sent = relays.getState().send(A, LOOPER, 'hi', false);
    await fake.fail('steer', 'the session is not ready');
    await sent;
    expect(stateOf(LOOPER)).toEqual({ kind: 'failed', message: 'the session is not ready' });
    expect(fake.listeners()).toBe(0);
    expect(restoreDraft('hi', relayOf(LOOPER))).toBe('hi');
  });

  it('refuses a text past C3’s bound before any steer', async () => {
    await relays.getState().send(A, LOOPER, 'x'.repeat(1024 * 1024 + 1), false);
    expect(fake.inputs.steer).toEqual([]);
    expect(stateOf(LOOPER)).toEqual({ kind: 'failed', message: 'text is larger than 1 MiB; attach it as a file instead' });
  });

  describe('the engine dropping the steer before starting it (O1)', () => {
    it.each(['cancelled', 'discarded', 'refused'] as const)('an asked relay reads failed on command.lifecycle %s for its uuid', async (state) => {
      await send(LOOPER, 'Say PING', IDLE_UUID);
      batch([event('command.lifecycle', { commandUuid: 'another', state }, { seq: 151 }), event('command.lifecycle', { commandUuid: IDLE_UUID, state: 'queued' }, { seq: 152 })]);
      expect(stateOf(LOOPER)?.kind).toBe('asked');
      batch([event('command.lifecycle', { commandUuid: IDLE_UUID, state }, { seq: 153 })]);
      expect(stateOf(LOOPER)).toEqual({ kind: 'failed', message: `the engine ${state} it before starting it` });
      expect(fake.listeners()).toBe(0);
    });

    it('not once the engine started it', async () => {
      await send(LOOPER, 'Say PING', IDLE_UUID);
      batch([event('command.lifecycle', { commandUuid: IDLE_UUID, state: 'started' }, { seq: 153 }), event('command.lifecycle', { commandUuid: IDLE_UUID, state: 'cancelled' }, { seq: 160 })]);
      expect(stateOf(LOOPER)?.kind).toBe('asked');
    });

    it('the text returns to an empty box and never over a draft typed since', async () => {
      await send(LOOPER, 'Say PING', IDLE_UUID);
      batch([event('command.lifecycle', { commandUuid: IDLE_UUID, state: 'discarded' }, { seq: 153 })]);
      expect(restoreDraft('', relayOf(LOOPER))).toBe('Say PING');
      expect(restoreDraft('  ', relayOf(LOOPER))).toBe('Say PING');
      expect(restoreDraft('a new thought', relayOf(LOOPER))).toBe('a new thought');
      expect(restoreDraft('', undefined)).toBe('');
    });
  });

  it('dismisses every pending relay of the session, asked or forwarded, on the parent’s process.exited, and not on a child’s', async () => {
    await send(LOOPER, 'Say PING', IDLE_UUID);
    batch(between(150, 200));
    await send(WALKER, 'Say PANG', FOREGROUND_UUID);
    batch([event('process.exited', { agentId: WALKER.agentId }, { seq: 201 })]);
    expect(stateOf(LOOPER)?.kind).toBe('forwarded');
    expect(stateOf(WALKER)?.kind).toBe('asked');
    batch([event('process.exited', {}, { seq: 202 })]);
    expect(relays.getState().relays.size).toBe(0);
    expect(fake.listeners()).toBe(0);
  });

  it('refuses a second send while the steer is in flight or asked, and replaces a forwarded relay with the next send', async () => {
    const first = relays.getState().send(A, LOOPER, 'one', false);
    await relays.getState().send(A, LOOPER, 'two', false);
    expect(fake.inputs.steer).toHaveLength(1);
    await fake.answer('steer', { messageUuid: IDLE_UUID });
    await first;
    await relays.getState().send(A, LOOPER, 'three', false);
    expect(fake.inputs.steer).toHaveLength(1);
    expect(relayOf(LOOPER)).toMatchObject({ text: 'one', state: { kind: 'asked' } });
    batch(between(150, 200)); // the parent's SendMessage: forwarded, where 2.1.283 leaves it
    expect(stateOf(LOOPER)?.kind).toBe('forwarded');
    const second = relays.getState().send(A, LOOPER, 'four', false);
    expect(fake.inputs.steer).toHaveLength(2);
    await fake.answer('steer', { messageUuid: 'second-uuid' });
    await second;
    expect(relayOf(LOOPER)).toMatchObject({ text: 'four', state: { kind: 'asked', messageUuid: 'second-uuid' } });
    expect(fake.listeners()).toBe(1);
  });

  it('applies what arrived while the steer was in flight', async () => {
    const sent = relays.getState().send(A, LOOPER, 'Say PING in your next inbox line', false);
    batch(between(150, 200)); // the SendMessage beat the steer's answer
    await fake.answer('steer', { messageUuid: IDLE_UUID });
    await sent;
    expect(stateOf(LOOPER)).toMatchObject({ kind: 'forwarded', parentRounds: 2 });
  });

  it('dismiss removes a relay by key and releases the subscription', async () => {
    await send(LOOPER, 'Say PING', IDLE_UUID);
    relays.getState().dismiss(relayKey(A, LOOPER.agentId));
    expect(relayOf(LOOPER)).toBeUndefined();
    expect(fake.listeners()).toBe(0);
  });
});
