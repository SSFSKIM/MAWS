// DX2's and DX3's frame shapes as types: `pnpm typecheck` (tsconfig.test.json) fails if any `@ts-expect-error` below
// stops being an error. The runtime case only keeps the file a suite.
import { describe, expect, it } from 'vitest';
import type { ProjectDown, ProjectUp } from '../../src/protocol/browser';
import type { DownFrame, UpFrame } from '../../src/protocol/machine';
import type { RpcOutcome, RpcResults } from '../../src/protocol/rpc';

const project = '6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f';
const event = { writer: 'hub/4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', seq: 3 };

export const up: UpFrame[] = [
  // The daemon's answer to a heartbeat: the only traffic that renews its lease.
  { t: 'hb-ack', generation: 2, at: '2026-10-15T08:00:15.000Z' },
  { t: 'rejected', project, event, nonce: 'AwMDAwMDAwMDAwMDAwMDAw', reason: 'seen-nonce' },
  { t: 'rejected', project, event, reason: 'bad-code', message: 'the code does not verify' },
  // A malformed event named by its nonce alone: no position is made up for it.
  { t: 'rejected', project, event: null, nonce: 'AwMDAwMDAwMDAwMDAwMDAw', reason: 'bad-shape' },
  // One that carried neither is still reported.
  { t: 'rejected', project, event: null, reason: 'bad-shape', message: 'not a JSON object' },
  // An authentic event at a position where the daemon holds another (a hub/ feed re-sequenced).
  { t: 'rejected', project, event, nonce: 'AwMDAwMDAwMDAwMDAwMDAw', reason: 'conflict' },
  // @ts-expect-error a rejection names its reason from the set
  { t: 'rejected', project, event, reason: 'did-not-like-it' },
  // @ts-expect-error a missing position is null, said outright, not left out
  { t: 'rejected', project, nonce: 'AwMDAwMDAwMDAwMDAwMDAw', reason: 'bad-shape' },
  // @ts-expect-error a position is the writer and seq as they arrived, both present
  { t: 'rejected', project, event: { writer: 'hub/x' }, reason: 'bad-shape' },
  // @ts-expect-error an hb-ack names the stream's generation
  { t: 'hb-ack', at: '2026-10-15T08:00:15.000Z' },
];

export const down: DownFrame[] = [
  { t: 'subscribe', project, session: 's', agentId: null, sub: 'x' },
  { t: 'subscribe', project, session: 's', agentId: 'a1', sub: 'y' },
  { t: 'rows', project, session: 's', agentId: 'a1', sub: 'y', before: 'u', limit: 50 },
  // @ts-expect-error a subscription is scoped by session and agentId (null for the main transcript)
  { t: 'subscribe', project, session: 's', sub: 'z' },
  { t: 'diff', project, session: 's', sub: 'x' },
  // @ts-expect-error the machine is told which session's tree to diff
  { t: 'diff', project, sub: 'x' },
];

export const browserUp: ProjectUp[] = [
  { t: 'subscribe', machine: 'mini', session: 's', agentId: null, sub: 'x' },
  // @ts-expect-error the browser names the scope too
  { t: 'subscribe', machine: 'mini', session: 's', sub: 'x' },
  { t: 'diff', sub: 'x' },
];

export const results: { [N in keyof RpcResults]: RpcResults[N] } = {
  steer: { row: 'u' },
  interrupt: { turnId: 't', stopped: ['b1'], running: ['b2'] },
  answer: {},
  decide: {},
  model: { model: 'claude-opus-5-5', effort: null },
  compact: { at: 'turn-end' },
  spawn: { session: 's', alias: 'maws-45' },
  retire: {},
  resume: { session: 's' },
};

export const outcomes: RpcOutcome<'interrupt' | 'steer'>[] = [
  { state: 'failed', error: { code: 'idle', message: 'no turn is running to steer: send it instead' } },
  { state: 'failed', error: { code: 'wrong-machine', message: 'this RPC names another machine' } },
  { state: 'failed', error: { code: 'unknown-project', message: 'no such project on this machine' } },
  // @ts-expect-error an interrupt names the tasks still running
  { state: 'done', result: { turnId: null, stopped: [] } },
];

export const browserDown: ProjectDown[] = [
  {
    t: 'rejected',
    rejection: { id: 7, at: '2026-10-15T08:00:16.000Z', machine: 'mini', event, reason: 'bad-code' },
  },
  {
    t: 'refused',
    refusal: { id: 8, at: '2026-10-15T08:00:17.000Z', machine: 'mini', reason: 'conflict', writer: 'mini/x', seq: 4, message: 'differs' },
  },
  { t: 'rejected', rejection: { id: 9, at: '2026-10-15T08:00:18.000Z', machine: 'mini', event: null, nonce: 'AwMDAwMDAwMDAwMDAwMDAw', reason: 'bad-shape' } },
  // @ts-expect-error a rejection in the audit record names the machine that refused the event
  { t: 'rejected', rejection: { id: 7, at: '2026-10-15T08:00:16.000Z', event, reason: 'bad-code' } },
];

describe("DX2's and DX3's frames", () => {
  it('are pinned by their types', () => {
    expect(up.length + down.length + browserUp.length + browserDown.length).toBe(23);
    expect(Object.keys(results)).toHaveLength(9);
    expect(outcomes).toHaveLength(4);
  });
});
