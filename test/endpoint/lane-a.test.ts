// Lane A's copies at the endpoint (O10 M7, review round 4): the cap on held copies, met by every new copy (a reseal
// included) and again after sminos was asked, so first copies waiting on their answers can't all take the last slot.
import type { Action } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import type { RemoteChannel } from '../../src/endpoint/channels';
import { LaneA } from '../../src/endpoint/lane-a';
import type { QueryAnswer } from '../../src/endpoint/rl10/link';

const channel = () => ({ closed: false, send: () => true, onClose: () => () => {} }) as unknown as RemoteChannel;
/** A decision that stands throughout (actions.test.ts drives one that moves). */
const STANDS = () => true;
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
    const first = lane.hand(channel(), copy('op-a'), WHO, 'fp', STANDS);
    await answer();
    expect(await first).toBeNull();
    expect(await lane.hand(channel(), copy('op-a'), WHO, 'fp', STANDS)).toBeNull();
    expect(await lane.hand(channel(), copy('op-a'), WHO, 'fp', STANDS)).toBe('busy');
    expect(sent).toHaveLength(2);
  });

  it('meets it again after sminos answered: first copies waiting on their answers share the last slot, not each take it', async () => {
    const { lane, sent, answer } = laneA(1);
    const one = lane.hand(channel(), copy('op-1'), WHO, 'fp', STANDS);
    const two = lane.hand(channel(), copy('op-2'), WHO, 'fp', STANDS);
    await answer();
    await answer();
    expect([await one, await two].sort()).toEqual(['busy', null].sort());
    expect(sent).toHaveLength(1);
  });
});

// UC-1 (U1a's Interfaces §B, "One holder"): an answer over the link is taken by the session's bridge with nothing on its
// stream until the settlement, so the endpoint tells its own spine (`laneA.accepted`) when sminos's result for a
// `sminos.answer` or a `sminos.decide` says `done`, once per op, with the session and the request the act's digest names.
describe('telling the spine an answer was taken', () => {
  const DIGEST = { session: 'e5b1c0de-0000-4000-8000-000000000001', request: 'toolu_1', tool: 'Bash', input_sha256: 'made-up-hash' };
  const act = (opId: string, action: string, args: Record<string, unknown>): Action => ({ ...copy(opId), action, args }) as unknown as Action;
  function telling(accepted: (session: string, request: string) => Promise<void> = async () => {}) {
    const told: Array<[string, string]> = [];
    const logged: string[] = [];
    const sentTo: unknown[] = [];
    const lane = new LaneA({
      rl10: { draw: () => ({ ok: true, frame: { t: 'rpc' } }), rpc: () => ({ ok: true, frame: { t: 'rpc' } }), query: async () => ({ state: 'not-received' }) },
      hold: () => () => {},
      now: () => Date.now(),
      accepted: (session, request) => (told.push([session, request]), accepted(session, request)),
      log: (line) => void logged.push(line),
    });
    const open = () => ({ closed: false, send: (m: unknown) => (sentTo.push(m), true), onClose: () => () => {} }) as unknown as RemoteChannel;
    return { lane, told, logged, sentTo, open };
  }

  it.each(['sminos.decide', 'sminos.answer'])('tells it once for a %s whose result is done, however many copies of the op are held', async (name) => {
    const { lane, told, sentTo, open } = telling();
    const first = act('op-1', name, { session: DIGEST.session, digest: DIGEST });
    const again = act('op-1', name, { session: DIGEST.session, digest: DIGEST });
    expect(await lane.hand(open(), first, WHO, 'fp', STANDS)).toBeNull();
    expect(await lane.hand(open(), again, WHO, 'fp', STANDS)).toBeNull();
    lane.result({ project: 'p', opId: 'op-1', nonce: again.nonce, outcome: { state: 'done', result: {} } });
    await Promise.resolve();
    expect(told).toEqual([[DIGEST.session, 'toolu_1']]);
    expect(sentTo).toHaveLength(2);
  });

  it('tells nothing for a refused or failed result, or for an op that answers nothing', async () => {
    const { lane, told, open } = telling();
    const cases: Array<[Action, unknown]> = [
      [act('op-r', 'sminos.decide', { session: DIGEST.session, digest: DIGEST }), { state: 'refused', reason: 'not-pending' }],
      [act('op-f', 'sminos.answer', { session: DIGEST.session, digest: DIGEST }), { state: 'failed', error: { code: 'internal' } }],
      [act('op-s', 'sminos.send', { session: DIGEST.session, text: 'made-up words' }), { state: 'done', result: {} }],
    ];
    for (const [a, outcome] of cases) {
      expect(await lane.hand(open(), a, WHO, 'fp', STANDS)).toBeNull();
      lane.result({ project: 'p', opId: a.opId, nonce: a.nonce, outcome });
    }
    await Promise.resolve();
    expect(told).toEqual([]);
  });

  it('logs a telling that fails, and the done still goes to the device', async () => {
    const { lane, logged, sentTo, open } = telling(async () => {
      throw new Error('the spine is away');
    });
    const a = act('op-1', 'sminos.decide', { session: DIGEST.session, digest: DIGEST });
    expect(await lane.hand(open(), a, WHO, 'fp', STANDS)).toBeNull();
    lane.result({ project: 'p', opId: 'op-1', nonce: a.nonce, outcome: { state: 'done', result: {} } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sentTo).toEqual([{ t: 'done', opId: 'op-1', outcome: { state: 'done', result: {} } }]);
    expect(logged).toEqual([expect.stringContaining('the spine is away')]);
  });
});
