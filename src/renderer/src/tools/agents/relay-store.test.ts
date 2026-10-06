import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentId, AppSessionId, ParentToolUseId, SessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import { parseTranscriptRecord } from '@shared/wire/transcript';
import { createBackfillContext, recordToEvents } from '../../../../engine-host/fs/backfill';
import { setAgentWorkClient } from './client';
import { relayText, restoreDraft } from './model/relay';
import { createRelayStore, relayKey } from './relay-store';
import { peerRelayKey } from './relay-store'; // E7
import { useTranscriptStore } from '../../stores/transcript';
import { event, recordedReceiptRecord, replayed } from '../../../../../test/support/agents-events';
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

  // Debt wave 4: the recorded receipt (R1's queued_command attachment in the looping child's transcript, seq 232 and
  // 351) through C4's backfill, as the child's follower delivers it.
  describe('a live child’s receipt from its transcript', () => {
    const receipt = (kase: 'idle' | 'busy') => {
      const record = recordedReceiptRecord(kase);
      const ctx = createBackfillContext({ sessionId: 'sess-1' as SessionId, agent: { agentId: LOOPER.agentId, parentToolUseId: 'toolu_019WWfE6Ry9diHmJymKAtX7Q' as ParentToolUseId } });
      return recordToEvents(parseTranscriptRecord(record), ctx);
    };

    it('follows the child once forwarded, and delivers on the attachment arriving on the batches', async () => {
      await send(LOOPER, 'Say PING in your next inbox line', IDLE_UUID);
      expect(fake.inputs.agentEvents).toEqual([]);
      batch(between(150, 200));
      expect(stateOf(LOOPER)?.kind).toBe('forwarded');
      expect(fake.inputs.agentEvents).toEqual([['A', LOOPER.agentId]]);
      await fake.answer('agentEvents', []); // nothing written yet: the child's next tool round writes it
      expect(stateOf(LOOPER)?.kind).toBe('forwarded');
      batch(receipt('idle'));
      expect(stateOf(LOOPER)).toEqual({ kind: 'delivered', deliveredAt: '2026-09-29T15:47:33.186Z' });
      expect(fake.listeners()).toBe(0);
    });

    it('delivers from the follow’s answer when the attachment was written before it', async () => {
      await send(LOOPER, 'Say PONG in your next inbox line', 'be019ba5-e49d-4ce6-8116-9a893ac8520f', true);
      batch(between(285, 320));
      expect(stateOf(LOOPER)?.kind).toBe('forwarded');
      await fake.answer('agentEvents', [...receipt('idle'), ...receipt('busy')]); // the earlier PING receipt does not match
      expect(stateOf(LOOPER)).toEqual({ kind: 'delivered', deliveredAt: '2026-09-29T15:48:46.208Z' });
      expect(fake.listeners()).toBe(0);
    });

    it('the same text relayed again is not delivered by the earlier relay’s receipt already in the transcript', async () => {
      await send(LOOPER, 'Say PING in your next inbox line', IDLE_UUID);
      batch(between(150, 200));
      await fake.answer('agentEvents', []);
      batch(receipt('idle'));
      expect(stateOf(LOOPER)?.kind).toBe('delivered');
      // the same words again, forwarded by the busy case's SendMessage (15:48:4x): the follow answers the whole transcript
      await send(LOOPER, 'Say PING in your next inbox line', 'be019ba5-e49d-4ce6-8116-9a893ac8520f', true);
      batch(between(285, 320));
      expect(stateOf(LOOPER)?.kind).toBe('forwarded');
      await fake.answer('agentEvents', receipt('idle')); // written 15:47:33, before this forward
      expect(stateOf(LOOPER)?.kind).toBe('forwarded');
      batch(receipt('idle')); // a follower's re-delivery of the old record changes nothing either
      expect(stateOf(LOOPER)?.kind).toBe('forwarded');
    });

    const unfollows = () => fake.calls.filter((c) => c.startsWith('unfollow '));

    it('releases the follow once delivered, or once the child ends, and not while its drill-in holds the transcript', async () => {
      await send(LOOPER, 'Say PING in your next inbox line', IDLE_UUID);
      batch(between(150, 200));
      await fake.answer('agentEvents', []);
      expect(unfollows()).toEqual([]);
      batch(receipt('idle'));
      expect(unfollows()).toEqual([`unfollow A ${LOOPER.agentId}`]);

      await send(LOOPER, 'Say PONG in your next inbox line', 'be019ba5-e49d-4ce6-8116-9a893ac8520f', true);
      batch(between(285, 320));
      await fake.answer('agentEvents', []);
      batch([event('subagent.finished', { taskId: LOOPER.agentId, agentId: LOOPER.agentId }, { seq: 321 })]);
      expect(relayOf(LOOPER)).toBeUndefined();
      expect(unfollows()).toHaveLength(2);

      useTranscriptStore.setState((s) => ({ entries: { ...s.entries, [relayKey(A, LOOPER.agentId)]: {} as never } }));
      try {
        await send(LOOPER, 'Say PING in your next inbox line', 'third', true);
        batch(between(150, 200).map((e) => ({ ...e, seq: e.seq! + 1000 })));
        await fake.answer('agentEvents', []);
        batch([event('subagent.finished', { taskId: LOOPER.agentId, agentId: LOOPER.agentId }, { seq: 1300 })]);
        expect(relayOf(LOOPER)).toBeUndefined();
        expect(unfollows()).toHaveLength(2); // the drill-in's entry keeps the shared follower
      } finally {
        useTranscriptStore.getState().drop(relayKey(A, LOOPER.agentId));
      }
    });

    it('a follow the host refuses leaves the relay forwarded; a relay forwarded to an ended child follows nothing', async () => {
      await send(LOOPER, 'Say PING in your next inbox line', IDLE_UUID);
      batch(between(150, 200));
      await fake.fail('agentEvents', 'agent meta not yet available');
      expect(stateOf(LOOPER)?.kind).toBe('forwarded');
      await send(WALKER, 'Say PANG in your next inbox line', FOREGROUND_UUID, true);
      batch(between(454, 547));
      expect(stateOf(WALKER)).toMatchObject({ kind: 'forwarded', childEndedAt: '2026-09-29T15:49:19.672Z' });
      expect(fake.inputs.agentEvents).toEqual([['A', LOOPER.agentId]]);
      batch([event('subagent.finished', { taskId: LOOPER.agentId, agentId: LOOPER.agentId }, { seq: 548 })]);
      expect(relayOf(LOOPER)).toBeUndefined();
      expect(unfollows()).toEqual([]); // the refused follow has nothing to release
    });
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

// E7 start (E7 execution document, Design §4; Decision Log 6): a Reply to another session, over M0's peer probe
// (pass3/e7-peer-a: A's own answer to B at seq 130; the owner's reply steered at 160 (uuid fab15aee…), sent by the
// SendMessage at 191 and answered `success: true` at 195; a send to `nobody-e7` at 307, answered `success: false` at 311).
describe('relay store, peer targets (E7)', () => {
  const peerA = replayed('pass3', 'e7-peer-a');
  const peerBetween = (from: number, to: number) => peerA.filter((e) => e.seq !== null && e.seq > from && e.seq <= to);
  const B = { kind: 'peer', address: 'uds:/tmp/cc-socks/10562.sock', name: 'repo-b-gen1il-79', mode: 'reply' } as const;
  const NOBODY = { kind: 'peer', address: 'nobody-e7', name: null, mode: 'message' } as const;
  const REPLY_UUID = 'fab15aee-8755-4d22-be95-fe6a693bb43e';
  const peerOf = (target: { address: string }) => relays.getState().peers.get(peerRelayKey(A, target.address));
  const sendPeer = async (target: typeof B | typeof NOBODY, text: string, uuid: string, parentTurnOpen = false) => {
    const sent = relays.getState().send(A, target, text, parentTurnOpen);
    await fake.answer('steer', { messageUuid: uuid });
    await sent;
  };

  it('keys a peer relay by the session and address, beside the agent key format', () => {
    expect(peerRelayKey(A, B.address)).toBe('A:peer:uds:/tmp/cc-socks/10562.sock');
    expect(relayKey(A, LOOPER.agentId)).toBe('A:a7aea42f9bed9b3ea');
  });

  it('steers once with the peer relayText; asked, not matched by the agent’s own answer, forwarded on the SendMessage carrying the owner’s text, sent on its result', async () => {
    const sent = relays.getState().send(A, B, 'E7 probe: reply from A', true);
    expect(fake.inputs.steer).toEqual([['A', relayText(B, 'E7 probe: reply from A'), 'next']]);
    await fake.answer('steer', { messageUuid: REPLY_UUID });
    await sent;
    expect(peerOf(B)).toMatchObject({ appSessionId: 'A', target: B, text: 'E7 probe: reply from A', state: { kind: 'asked', messageUuid: REPLY_UUID, parentTurnOpenAtSend: true } });
    expect(relays.getState().relays.size).toBe(0); // the agent relays are not touched
    batch(peerBetween(100, 140)); // A's own answer to B by name: not the owner's text
    expect(peerOf(B)?.state.kind).toBe('asked');
    batch(peerBetween(160, 192));
    const use = peerA.find((e) => e.seq === 191 && e.kind === 'tool.use')!;
    expect(peerOf(B)?.state).toMatchObject({ kind: 'forwarded', toolUseId: 'toolu_014MYinuDDFrreJtW6nkbeVh', forwardedAt: use.at });
    batch(peerBetween(192, 200));
    expect(peerOf(B)?.state).toEqual({ kind: 'sent', sentAt: peerA.find((e) => e.seq === 195 && e.kind === 'tool.result')!.at });
    expect(fake.listeners()).toBe(0);
    batch(peerBetween(200, 220)); // the steer's own turn ends after the reply (command_lifecycle completed, seq 216): still sent
    expect(peerOf(B)?.state.kind).toBe('sent');
  });

  it('reads failed when the steer’s own turn ends with no SendMessage carrying the owner’s text', async () => {
    await sendPeer(NOBODY, 'a text the session never sends', 'c762441a-e67e-4d7d-bf40-f40a32c465ec');
    batch(peerBetween(281, 338)); // the turn's own SendMessage to nobody-e7 carries other text: no match
    expect(peerOf(NOBODY)?.state.kind).toBe('asked');
    batch(peerBetween(338, 340)); // command_lifecycle completed for the steer's uuid, seq 339
    expect(peerOf(NOBODY)?.state).toEqual({ kind: 'failed', message: 'the session ended that turn without sending it' });
    expect(restoreDraft('', peerOf(NOBODY))).toBe('a text the session never sends');
    expect(fake.listeners()).toBe(0);
  });

  it('reads failed with the engine’s message when the send answers `success: false`', async () => {
    await sendPeer(NOBODY, 'E7 probe: nobody', 'c762441a-e67e-4d7d-bf40-f40a32c465ec');
    batch(peerBetween(281, 340));
    expect(peerOf(NOBODY)?.state).toEqual({ kind: 'failed', message: "No agent named 'nobody-e7' is reachable.\nUse ListAgents to see everyone you can message." });
    expect(fake.listeners()).toBe(0);
  });

  it('reads failed when the engine drops the steer before starting it, or the host refuses it; dismissed with the session’s exit', async () => {
    await sendPeer(B, 'one', REPLY_UUID);
    batch([event('command.lifecycle', { commandUuid: REPLY_UUID, state: 'discarded' }, { seq: 161 })]);
    expect(peerOf(B)?.state).toEqual({ kind: 'failed', message: 'the engine discarded it before starting it' });
    expect(restoreDraft('', peerOf(B))).toBe('one');
    const refused = relays.getState().send(A, B, 'two', false);
    await fake.fail('steer', 'the session is not ready');
    await refused;
    expect(peerOf(B)?.state).toEqual({ kind: 'failed', message: 'the session is not ready' });
    await sendPeer(B, 'three', 'third');
    batch([event('process.exited', {}, { seq: 170 })]);
    expect(peerOf(B)).toBeUndefined();
    expect(fake.listeners()).toBe(0);
  });

  it('refuses a second reply to the same address while one is asked; dismiss removes it by key', async () => {
    await sendPeer(B, 'one', REPLY_UUID);
    await relays.getState().send(A, B, 'two', false);
    expect(fake.inputs.steer).toHaveLength(1);
    await sendPeer(NOBODY, 'elsewhere', 'other-uuid'); // another address goes
    expect(fake.inputs.steer).toHaveLength(2);
    relays.getState().dismiss(peerRelayKey(A, B.address));
    relays.getState().dismiss(peerRelayKey(A, NOBODY.address));
    expect(relays.getState().peers.size).toBe(0);
    expect(fake.listeners()).toBe(0);
  });
});
// E7 end
