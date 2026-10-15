// The DX4 envelope's per-kind invariants are types: `pnpm typecheck` (tsconfig.test.json) fails if any
// `@ts-expect-error` below stops being an error. The runtime cases only keep the file a suite.
import { describe, expect, it } from 'vitest';
import { INTERPRETED_KINDS, SESSION_WIDE_KINDS, SUBSCRIPTION_KINDS, type SessionMessage } from '../../src/protocol/session';

const base = { project: 'p', machine: 'mini' };
const chunk = { turnId: 't', agentId: null, step: 0, chunkIndex: 0, chunk: { text: 'hi' } };
const presence = { record: null, bridge: true };
const machine = { online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] };

// The message-level `upTo` is the watermark; a block's own is informational; a tool block names its call.
const streaming = [
  {
    turnId: 't',
    agentId: null,
    step: 0,
    model: 'claude-opus-5-5',
    upTo: 7,
    blocks: [
      { index: 1, kind: 'text' as const, text: 'Hel', upTo: 3 },
      { index: 2, kind: 'tool' as const, text: '{"command":"ls', upTo: 7, id: 'toolu_01', name: 'Bash' },
    ],
  },
];
const usage = { context: { tokens: 5000, window: 200000, percent: 2 }, cost: { usd: 0.42 } };

export const admitted: SessionMessage[] = [
  { ...base, session: 's', kind: 'chunk', sub: 'x', n: 4, body: chunk },
  { ...base, session: 's', kind: 'snapshot', sub: 'x', n: 0, body: { rows: [], more: false, subagents: [], presence, streaming, usage } },
  // An agent-scope sub's snapshot carries no usage; a main one without a bridge carries null.
  { ...base, session: 's', kind: 'snapshot', sub: 'y', n: 0, body: { rows: [], more: false, subagents: [], presence, streaming: [] } },
  { ...base, session: 's', kind: 'snapshot', sub: 'z', n: 0, body: { rows: [], more: false, subagents: [], presence, streaming: [], usage: null } },
  { ...base, session: 's', kind: 'usage', sub: 'x', n: 7, body: { context: { window: 200000 }, cost: null } },
  { ...base, session: 's', kind: 'diff', sub: 'x', n: 8, body: { base: 'main', text: '' } },
  { ...base, session: 's', kind: 'compact', sub: null, n: null, body: { rpc: 'BQUFBQUFBQUFBQUFBQUFBQ', phase: 'end', tokensBefore: 90000, tokensAfter: 12000 } },
  { ...base, session: 's', kind: 'compact', sub: null, n: null, body: { rpc: null, phase: 'end', skip: 'a hook vetoed it' } },
  { ...base, session: 's', kind: 'block-row', sub: 'x', n: 5, body: { uuid: 'u', turnId: 't', agentId: null, step: 0, index: 1 } },
  { ...base, session: 's', kind: 'end', sub: 'x', n: 6, body: { reason: 'discontinuity' } },
  { ...base, session: 's', kind: 'presence', sub: null, n: null, body: presence },
  { ...base, session: null, kind: 'machine', sub: null, n: null, body: machine },
];

export const refused: SessionMessage[] = [
  // @ts-expect-error a chunk belongs to a subscription
  { ...base, session: 's', kind: 'chunk', sub: null, n: null, body: chunk },
  // @ts-expect-error a snapshot is n = 0
  { ...base, session: 's', kind: 'snapshot', sub: 'x', n: 3, body: { rows: [], more: false, subagents: [], presence, streaming: [] } },
  // @ts-expect-error machine presence names no session
  { ...base, session: 's', kind: 'machine', sub: null, n: null, body: machine },
  // @ts-expect-error session presence is published to every browser, outside any subscription
  { ...base, session: 's', kind: 'presence', sub: 'x', n: 1, body: presence },
  // @ts-expect-error the body follows the kind
  { ...base, session: 's', kind: 'row', sub: 'x', n: 1, body: presence },
  // @ts-expect-error a block-row belongs to a subscription
  { ...base, session: 's', kind: 'block-row', sub: null, n: null, body: { uuid: 'u', turnId: 't', agentId: null, step: 0, index: 1 } },
  // @ts-expect-error a snapshot's streaming entries are per block, not one text per message
  { ...base, session: 's', kind: 'snapshot', sub: 'x', n: 0, body: { rows: [], more: false, subagents: [], presence, streaming: [{ turnId: 't', agentId: null, step: 0, text: 'Hel', upTo: 3 }] } },
  // @ts-expect-error a block is text, thinking, or tool
  { ...base, session: 's', kind: 'snapshot', sub: 'x', n: 0, body: { rows: [], more: false, subagents: [], presence, streaming: [{ turnId: 't', agentId: null, step: 0, upTo: 0, blocks: [{ index: 0, kind: 'image', text: '', upTo: 0 }] }] } },
  // @ts-expect-error the watermark is the message's: an entry carries `upTo`
  { ...base, session: 's', kind: 'snapshot', sub: 'x', n: 0, body: { rows: [], more: false, subagents: [], presence, streaming: [{ turnId: 't', agentId: null, step: 0, blocks: [] }] } },
  // @ts-expect-error usage belongs to a (main-scope) subscription
  { ...base, session: 's', kind: 'usage', sub: null, n: null, body: usage },
  // @ts-expect-error a compaction goes to every browser, outside any subscription
  { ...base, session: 's', kind: 'compact', sub: 'x', n: 3, body: { rpc: null, phase: 'start' } },
];

describe('the DX4 envelope', () => {
  it('splits its kinds between subscriptions and what the hub interprets, with none in both', () => {
    expect(SUBSCRIPTION_KINDS.filter((kind) => (INTERPRETED_KINDS as readonly string[]).includes(kind))).toEqual([]);
    expect(SUBSCRIPTION_KINDS).toContain('block-row');
    expect(SUBSCRIPTION_KINDS).toContain('usage');
    expect(SESSION_WIDE_KINDS.filter((kind) => (SUBSCRIPTION_KINDS as readonly string[]).includes(kind))).toEqual([]);
    expect(admitted).toHaveLength(12);
    expect(refused).toHaveLength(11);
  });
});
