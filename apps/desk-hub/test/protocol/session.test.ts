// The DX4 envelope's per-kind invariants are types: `pnpm typecheck` (tsconfig.test.json) fails if any
// `@ts-expect-error` below stops being an error. The runtime cases only keep the file a suite.
import { describe, expect, it } from 'vitest';
import { INTERPRETED_KINDS, SUBSCRIPTION_KINDS, type SessionMessage } from '../../src/protocol/session';

const base = { project: 'p', machine: 'mini' };
const chunk = { turnId: 't', agentId: null, step: 0, chunkIndex: 0, chunk: { text: 'hi' } };
const presence = { record: null, bridge: true };
const machine = { online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] };

const streaming = [{ turnId: 't', agentId: null, step: 0, blocks: [{ index: 1, kind: 'text', text: 'Hel', upTo: 3 }] }];

export const admitted: SessionMessage[] = [
  { ...base, session: 's', kind: 'chunk', sub: 'x', n: 4, body: chunk },
  { ...base, session: 's', kind: 'snapshot', sub: 'x', n: 0, body: { rows: [], more: false, subagents: [], presence, streaming } },
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
];

describe('the DX4 envelope', () => {
  it('splits its kinds between subscriptions and what the hub interprets, with none in both', () => {
    expect(SUBSCRIPTION_KINDS.filter((kind) => (INTERPRETED_KINDS as readonly string[]).includes(kind))).toEqual([]);
    expect(SUBSCRIPTION_KINDS).toContain('block-row');
    expect(admitted).toHaveLength(6);
    expect(refused).toHaveLength(7);
  });
});
