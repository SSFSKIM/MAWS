// P5 O16 M3b fix wave 2 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3): DRAIN_REPLIES is an allowlist, the
// completions that reach the engine host that raised their request (a handover's draining one included) rather than wait
// for a successor. Pinned against the command table: every engine-host command whose input names a request the host
// raised (`requestId`, `askId`) is either in it or excluded here with its reason, so a new answer to a host's request
// fails this test until someone decides which it is. And the remote endpoint offers none of them: they cross only from
// the machine's own app.
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { DRAIN_REPLIES } from '@shared/host/host-supervisor';
import { REGISTRY } from '@shared/ipc/registry';
import { OFFERS } from '../../src/endpoint/offers';

// Each excluded answer, and why it waits for the successor (held, or re-sent by the app) instead
const EXCLUDED: Record<string, string> = {
  'session.pendingRequest': 'a read of what a session asks, which settles nothing',
  'session.answer': 'a human’s answer to a permission or elicitation; the drain does not wait for it, and the successor’s fold raises the request again',
  'session.ui.answer': 'an answer to the engine’s own UI request; the drain does not wait for it, and the successor raises it again',
  'maws.ask.answer': 'the drain waits for every tool call but `ask` (session-maws.ts): the successor holds the ask and takes its answer',
};

const REQUEST_KEYS = ['requestId', 'askId'];

function answersToHostRequests(): string[] {
  return Object.entries(REGISTRY.commands)
    .filter(([, spec]) => spec.owner === 'engine-host' && spec.input instanceof z.ZodObject && Object.keys(spec.input.shape).some((key) => REQUEST_KEYS.includes(key)))
    .map(([name]) => name)
    .sort();
}

describe('DRAIN_REPLIES', () => {
  it('with the exclusions, is exactly the engine-host commands that answer a request the host raised', () => {
    const decided = [...DRAIN_REPLIES, ...Object.keys(EXCLUDED)];
    expect(new Set(decided).size).toBe(decided.length); // none both in and excluded
    expect(answersToHostRequests()).toEqual(decided.sort());
  });

  it('every one names the request it settles by `requestId`, the key its raising host is found by', () => {
    for (const name of DRAIN_REPLIES) {
      const input = REGISTRY.commands[name as keyof typeof REGISTRY.commands]!.input;
      expect(input instanceof z.ZodObject && 'requestId' in input.shape, name).toBe(true);
    }
  });

  it('none is offered to a remote caller', () => {
    expect(Object.keys(OFFERS.commands).filter((name) => DRAIN_REPLIES.has(name))).toEqual([]);
  });
});
