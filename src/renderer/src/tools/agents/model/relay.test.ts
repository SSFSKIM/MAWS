import { describe, expect, it } from 'vitest';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import { event, replayed } from '../../../../../../test/support/agents-events';
import { matchesReceipt, matchesSendMessage, parentRoundsBetween, relayText, type Relay } from './relay';
import { loadJournal } from '../../../../../../test/support/fixtures'; // E7

const events = replayed('pass3', 'relay-to-child');
const LOOPER = 'a7aea42f9bed9b3ea' as AgentId; // the idle and busy cases' background child
const WALKER = 'accea5ba03e220b64' as AgentId; // the foreground case's child, resumed by the relay
const at = (seq: number, kind: SessionEvent['kind']) => {
  const found = events.find((e) => e.seq === seq && e.kind === kind);
  if (!found) throw new Error(`no ${kind} at ${seq}`);
  return found;
};
const relay = (agentId: AgentId, text: string): Relay => ({
  appSessionId: 'A' as AppSessionId, agentId, name: null, text,
  state: { kind: 'forwarded', messageUuid: 'u1' as never, sentAt: '', toolUseId: 'toolu_x' as never, forwardedAt: '', parentRounds: 1, childEndedAt: null },
});

describe('relay model', () => {
  it('relayText addresses the agent by id, and names it only when a real name exists (the wording R1 routed)', () => {
    expect(relayText({ agentId: LOOPER, name: null }, 'Say PING in your next inbox line')).toBe(
      'Relay to agent a7aea42f9bed9b3ea with SendMessage, verbatim, then continue what you were doing: Say PING in your next inbox line',
    );
    expect(relayText({ agentId: LOOPER, name: 'reader' }, 'hi')).toBe('Relay to agent a7aea42f9bed9b3ea (named "reader") with SendMessage, verbatim, then continue what you were doing: hi');
  });

  describe('matchesSendMessage', () => {
    const idle = at(196, 'tool.use');

    it('matches the recorded SendMessage by id', () => {
      expect(matchesSendMessage(idle, { agentId: LOOPER, name: null })).toBe(true);
      expect(matchesSendMessage(at(543, 'tool.use'), { agentId: WALKER, name: null })).toBe(true);
    });

    it('matches by a real name, never by the description', () => {
      const toName = event('tool.use', { toolName: 'SendMessage', input: { to: 'reader', message: 'x' } }, { seq: 2 });
      expect(matchesSendMessage(toName, { agentId: LOOPER, name: 'reader' })).toBe(true);
      expect(matchesSendMessage(toName, { agentId: LOOPER, name: null })).toBe(false);
      const toDescription = event('tool.use', { toolName: 'SendMessage', input: { to: 'Loop rounds until stop.txt' } }, { seq: 3 });
      expect(matchesSendMessage(toDescription, { agentId: LOOPER, name: null })).toBe(false);
    });

    it('does not match a SendMessage to another agent, from a child, or another tool', () => {
      expect(matchesSendMessage(idle, { agentId: WALKER, name: null })).toBe(false);
      const fromChild = event('tool.use', { toolName: 'SendMessage', input: { to: LOOPER }, agentId: WALKER }, { seq: 4 });
      expect(matchesSendMessage(fromChild, { agentId: LOOPER, name: null })).toBe(false);
      expect(matchesSendMessage(event('tool.use', { toolName: 'Bash', input: { to: LOOPER } }, { seq: 5 }), { agentId: LOOPER, name: null })).toBe(false);
    });
  });

  describe('matchesReceipt (O3: live or disk form; the agent-stopped resume’s start)', () => {
    const text = 'Say PING in your next inbox line';
    const r = relay(LOOPER, text);

    it('matches a child user.message carrying the text in the live form and the disk form, whatever its origin', () => {
      expect(matchesReceipt(event('user.message', { agentId: LOOPER, content: `The coordinator sent a message while you were working:\n${text}` }, { seq: 900 }), r)).toBe(true);
      expect(matchesReceipt(event('user.message', { agentId: LOOPER, origin: 'coordinator', content: [{ type: 'text', text }] }, { seq: null }), r)).toBe(true);
      expect(matchesReceipt(event('user.message', { agentId: LOOPER, origin: 'peer', content: text }, { seq: 901 }), r)).toBe(true);
    });

    it('does not match the parent’s own message, a child message without the text, or another child’s', () => {
      expect(matchesReceipt(event('user.message', { agentId: null, content: text }, { seq: 902 }), r)).toBe(false);
      expect(matchesReceipt(event('user.message', { agentId: LOOPER, content: 'something else' }, { seq: 903 }), r)).toBe(false);
      expect(matchesReceipt(event('user.message', { agentId: WALKER, content: text }, { seq: 904 }), r)).toBe(false);
    });

    it('matches the recorded resume start (seq 548) whose prompt carries the text, and not another agent’s start', () => {
      const resume = at(548, 'subagent.started');
      expect(matchesReceipt(resume, relay(WALKER, 'Say PANG in your next inbox line'))).toBe(true);
      expect(matchesReceipt(resume, relay(WALKER, 'Say PONG'))).toBe(false);
      const rekeyed = { ...resume, taskId: 'aOther', agentId: 'aOther' } as SessionEvent;
      expect(matchesReceipt(rekeyed, relay(WALKER, 'Say PANG in your next inbox line'))).toBe(false);
      expect(matchesReceipt(at(434, 'subagent.started'), relay(WALKER, 'Say PANG in your next inbox line'))).toBe(false); // the first start's prompt
    });
  });

  describe('parentRoundsBetween', () => {
    it('counts one round for a message with two tool_use blocks, and only the parent’s tool_use messages inside the bounds', () => {
      const block = (seq: number, messageUuid: string, type: string, agentId: string | null = null) =>
        event('assistant.block.complete', { messageUuid, block: { type }, agentId }, { seq });
      const list = [block(1, 'm0', 'tool_use'), block(2, 'm1', 'tool_use'), block(3, 'm1', 'tool_use'), block(4, 'm2', 'text'), block(5, 'm3', 'tool_use', 'aChild'), block(6, 'm4', 'tool_use'), block(9, 'm5', 'tool_use')];
      expect(parentRoundsBetween(list, 1, 9)).toBe(2);
      expect(parentRoundsBetween(list, 0, 10)).toBe(4);
    });

    it('counts what R1 recorded from each steer to its SendMessage: 2 idle, 1 busy, 1 foreground', () => {
      expect(parentRoundsBetween(events, 150, 197)).toBe(2);
      expect(parentRoundsBetween(events, 285, 316)).toBe(1);
      expect(parentRoundsBetween(events, 454, 544)).toBe(1);
    });
  });
});

// E7 start (E7 execution document, Design §4; Decision Log 6): the Reply to another session rides the relay, its target
// a peer address. M0 ran the reply wording verbatim (pass3/e7-peer-a: the steer at seq 160, its SendMessage at 191),
// and A's own unasked answer to the same sender (seq 130) shows why the owner's text must be in the match.
describe('peer relay (E7)', () => {
  const peerA = replayed('pass3', 'e7-peer-a');
  const peerAt = (seq: number) => peerA.find((e) => e.seq === seq && e.kind === 'tool.use')!;
  const B = { kind: 'peer', address: 'uds:/tmp/cc-socks/10562.sock', name: 'repo-b-gen1il-79', mode: 'reply' } as const;
  const STEER = (loadJournal('pass3', 'e7-peer-a').find((row) => row.seq === 160)!.frame as { message: { content: string } }).message.content;

  it('relayText asks the session to reply to the sender’s address with exactly the owner’s text (the wording M0 ran)', () => {
    expect(relayText(B, 'E7 probe: reply from A')).toBe(STEER);
    expect(relayText({ ...B, name: null }, 'hi')).toBe('Reply to the cross-session message from uds:/tmp/cc-socks/10562.sock with SendMessage, to: "uds:/tmp/cc-socks/10562.sock", sending exactly this text, then continue what you were doing: hi');
    expect(relayText({ kind: 'peer', address: 'repo-b', name: 'repo-b', mode: 'message' }, 'hi')).toBe('Send a message to repo-b with SendMessage, to: "repo-b", sending exactly this text, then continue what you were doing: hi');
  });

  it('matches the parent’s SendMessage to the address or the sender’s name only when its message carries the owner’s text', () => {
    expect(matchesSendMessage(peerAt(191), B, 'E7 probe: reply from A')).toBe(true);
    expect(matchesSendMessage(peerAt(130), B, 'E7 probe: reply from A')).toBe(false); // the agent's own answer, to the name
    const byName = event('tool.use', { toolName: 'SendMessage', input: { to: 'repo-b-gen1il-79', message: 'Sure. E7 probe: reply from A' } }, { seq: 400 });
    expect(matchesSendMessage(byName, B, 'E7 probe: reply from A')).toBe(true);
    expect(matchesSendMessage(byName, { ...B, name: null }, 'E7 probe: reply from A')).toBe(false);
    const fromChild = event('tool.use', { toolName: 'SendMessage', input: { to: B.address, message: 'E7 probe: reply from A' }, agentId: WALKER }, { seq: 401 });
    expect(matchesSendMessage(fromChild, B, 'E7 probe: reply from A')).toBe(false);
  });
});
// E7 end
