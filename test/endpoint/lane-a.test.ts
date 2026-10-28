// Lane A's copies at the endpoint (O10 M7, review round 4): the cap on held copies, met by every new copy (a reseal
// included) and again after sminos was asked, so first copies waiting on their answers can't all take the last slot.
import type { Action } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import type { RemoteChannel } from '../../src/endpoint/channels';
import { LaneA } from '../../src/endpoint/lane-a';
import type { QueryAnswer } from '../../src/endpoint/rl10/link';

const channel = () => ({ closed: false, send: () => true, onClose: () => () => {} }) as unknown as RemoteChannel;
const WHO = { member: 'm-a', device: 'd-a' };
let n = 0;
const copy = (opId: string): Action => ({ opId, opCreated: new Date().toISOString(), nonce: `nonce-${++n}` }) as unknown as Action;

/** A LaneA holding at most `max` copies, whose sminos answers each query when the test says. */
function laneA(max: number) {
  const asked: Array<(answer: QueryAnswer) => void> = [];
  const sent: string[] = [];
  const lane = new LaneA({
    rl10: {
      draw: () => ({ ok: true, frame: { t: 'rpc' } }),
      rpc: (action) => (sent.push(action.nonce), { ok: true, frame: { t: 'rpc' } }),
      query: () => new Promise<QueryAnswer>((resolve) => asked.push(resolve)),
    },
    hold: () => () => {},
    now: () => Date.now(),
    max,
  });
  const answer = async (state = 'not-received') => {
    while (asked.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    asked.shift()!({ state });
  };
  return { lane, sent, answer };
}

describe('the cap on held lane A copies', () => {
  it('meets a reseal of an op already held too: past the cap it is `busy` and goes nowhere', async () => {
    const { lane, sent, answer } = laneA(2);
    const first = lane.hand(channel(), copy('op-a'), WHO, 'fp');
    await answer();
    expect(await first).toBeNull();
    expect(await lane.hand(channel(), copy('op-a'), WHO, 'fp')).toBeNull();
    expect(await lane.hand(channel(), copy('op-a'), WHO, 'fp')).toBe('busy');
    expect(sent).toHaveLength(2);
  });

  it('meets it again after sminos answered: first copies waiting on their answers share the last slot, not each take it', async () => {
    const { lane, sent, answer } = laneA(1);
    const one = lane.hand(channel(), copy('op-1'), WHO, 'fp');
    const two = lane.hand(channel(), copy('op-2'), WHO, 'fp');
    await answer();
    await answer();
    expect([await one, await two].sort()).toEqual(['busy', null].sort());
    expect(sent).toHaveLength(1);
  });
});
