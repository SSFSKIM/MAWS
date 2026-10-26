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
  // A task's output tail, on a main or an agent sub: the machine is told the sub's whole scope.
  { t: 'output', project, session: 's', agentId: null, sub: 'x', taskId: 'b7k2m9q4x', tail: 65536 },
  { t: 'output', project, session: 's', agentId: 'a1', sub: 'y', taskId: 'b7k2m9q4x', tail: 1 },
  // @ts-expect-error output names the sub's scope, agentId included
  { t: 'output', project, session: 's', sub: 'x', taskId: 'b7k2m9q4x', tail: 1 },
  // A read, carried with the sub's whole route; its args only when the browser sent some.
  { t: 'read', project, session: 's', agentId: null, sub: 'x', id: 'r1', what: 'status' },
  { t: 'read', project, session: 's', agentId: null, sub: 'x', id: 'r2', what: 'usage', args: { breakdown: 'full' } },
  // @ts-expect-error a read names the sub's scope, agentId included
  { t: 'read', project, session: 's', sub: 'x', id: 'r3', what: 'status' },
  // The welcome lists the session kinds the hub relays; an older hub's lists none.
  { t: 'welcome', org: 'o', machine: 'mini', generation: 1, heartbeat_ms: 15000, kinds: ['read', 'op'] },
  { t: 'welcome', org: 'o', machine: 'mini', generation: 1, heartbeat_ms: 15000 },
];

export const browserUp: ProjectUp[] = [
  { t: 'subscribe', machine: 'mini', session: 's', agentId: null, sub: 'x' },
  // @ts-expect-error the browser names the scope too
  { t: 'subscribe', machine: 'mini', session: 's', sub: 'x' },
  { t: 'diff', sub: 'x' },
  { t: 'output', sub: 'x', taskId: 'b7k2m9q4x', tail: 524288 },
  // @ts-expect-error output asks for a number of bytes
  { t: 'output', sub: 'x', taskId: 'b7k2m9q4x', tail: '64k' },
  // @ts-expect-error output names its task
  { t: 'output', sub: 'x', tail: 1024 },
  { t: 'read', sub: 'x', id: 'r1', what: 'status' },
  { t: 'read', sub: 'x', id: 'r2', what: 'usage', args: { breakdown: 'summary' } },
  // @ts-expect-error a read's id correlates its answer
  { t: 'read', sub: 'x', what: 'status' },
  // @ts-expect-error a read's args are an object
  { t: 'read', sub: 'x', id: 'r3', what: 'usage', args: 'full' },
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
  stop: { taskId: 'b7k2m9q4x' },
  // Answered at once; the outcome follows as `op`.
  command: { queued: true, route: 'run', id: 'cmd-1' },
  // Started at once; the answer follows as `op`.
  btw: { started: true, id: 'b1' },
  // The answer is the outcome: a name answered with the id it resolved to, an id alone; no `op` follows.
  'stop-agent': { agentId: 'bg-sleeper', accepted: true, resolvedAgentId: 'a7a362db27418152f' },
  tell: { sent: true },
  // Answered once the bridge holds the upload; each attachment's state follows as `op`.
  media: { queued: true, upload: 'hXa9Nm6s5JfNqGzwKtg70A', intake: 'native-read', root: '/w/.claude/desk-uploads/s', paths: ['hXa9Nm6s5JfNqGzwKtg70A.0.png'] },
};

export const outcomes: RpcOutcome<'interrupt' | 'steer'>[] = [
  // A steer to a session without a bridge names no row.
  { state: 'done', result: { row: null } },
  { state: 'failed', error: { code: 'idle', message: 'no turn is running to steer: send it instead' } },
  { state: 'failed', error: { code: 'wrong-machine', message: 'this RPC names another machine' } },
  { state: 'failed', error: { code: 'unknown-project', message: 'no such project on this machine' } },
  // A late decision names the side whose answer was used; one within 200 ms of a background deadline says so.
  { state: 'failed', error: { code: 'not-pending', message: 'already answered in the terminal', winner: 'terminal', by: 'terminal' } },
  { state: 'failed', error: { code: 'not-pending', message: 'the window closed', terminalOnly: true } },
  // @ts-expect-error the winner is a side, as Settled names it
  { state: 'failed', error: { code: 'not-pending', message: '', winner: 'phone' } },
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
    expect(up.length + down.length + browserUp.length + browserDown.length).toBe(38);
    expect(Object.keys(results)).toHaveLength(15);
    expect(outcomes).toHaveLength(8);
  });
});
