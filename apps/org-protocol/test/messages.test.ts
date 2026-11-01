// RL2's channel messages as each side reads the other's (O10 M7's addition): a `queried` may say why the endpoint said
// nothing of an operation (`reason`, with `state: 'refused'`), as a short text.
import { describe, expect, it } from 'vitest';
import { RL2_PROTOCOL } from '../src/channel.ts';
import { readMessage } from '../src/messages.ts';

const OP = 'op-0000000000000001';

describe('queried', () => {
  it('reads a refusal with its reason, and an executor’s answer with its outcome', () => {
    expect(readMessage('endpoint', { t: 'queried', opId: OP, state: 'refused', reason: 'grade' }).kind).toBe('message');
    expect(readMessage('endpoint', { t: 'queried', opId: OP, state: 'done', outcome: { state: 'done', result: {} } }).kind).toBe('message');
  });

  it('refuses a reason that is no short text', () => {
    expect(readMessage('endpoint', { t: 'queried', opId: OP, state: 'refused', reason: 7 }).kind).toBe('malformed');
    expect(readMessage('endpoint', { t: 'queried', opId: OP, state: 'refused', reason: 'x'.repeat(65) }).kind).toBe('malformed');
  });
});

// P5 O7 M2: a query names the executor its act went to; `machine` (the services' ledger, behind the capability
// `rl2.executor.machine`) joins RL2's three, and the protocol's minor moves with it.
describe('query', () => {
  const query = (executor: unknown) => ({ t: 'query', opId: OP, opCreated: '2026-10-31T12:00:00.000Z', executor });

  it('admits each executor RL2 names, `machine` and `pty-host` among them', () => {
    for (const executor of ['sminos', 'engine-host', 'endpoint', 'machine', 'pty-host']) expect(readMessage('device', query(executor)).kind).toBe('message');
  });

  it('refuses an executor RL2 does not name', () => {
    for (const executor of ['main', '', 7]) expect(readMessage('device', query(executor)).kind).toBe('malformed');
  });

});

// P5 O7 M4: a call may name the session a path-class read is made from (`rl2.call-session`), and a `sub` may name a feed
// (`rl2.feeds`): `checkout` with its session, `attention` with none, each with an `(epoch, seq)` cursor and no view.
describe('call.session and sub.feed', () => {
  const call = (fields: Record<string, unknown> = {}) => ({ t: 'call', id: 'c1', name: 'git.status', input: { directory: '/w' }, ...fields });
  const sub = (fields: Record<string, unknown>) => ({ t: 'sub', sub: 's1', cursor: null, credit: 1024, ...fields });
  const B = { lane: 'B', id: 'app-1' };

  it('reads a call with or without a session, and refuses one whose session is no session reference', () => {
    expect(readMessage('device', call()).kind).toBe('message');
    expect(readMessage('device', call({ session: B })).kind).toBe('message');
    for (const session of [null, 'app-1', { lane: 'C', id: 'x' }, { lane: 'B', id: '' }]) expect(readMessage('device', call({ session })).kind).toBe('malformed');
  });

  it('reads a checkout feed with its session and an attention feed with none, either from a snapshot or an (epoch, seq) cursor', () => {
    expect(readMessage('device', sub({ feed: 'checkout', session: B })).kind).toBe('message');
    expect(readMessage('device', sub({ feed: 'checkout', session: B, cursor: { epoch: 'checkout:boot', seq: 4 } })).kind).toBe('message');
    expect(readMessage('device', sub({ feed: 'attention' })).kind).toBe('message');
  });

  it('refuses a feed it does not name, a checkout feed with no session, an attention feed with one, a feed with a view or an idx', () => {
    expect(readMessage('device', sub({ feed: 'git', session: B })).kind).toBe('malformed');
    expect(readMessage('device', sub({ feed: 'checkout' })).kind).toBe('malformed');
    expect(readMessage('device', sub({ feed: 'attention', session: B })).kind).toBe('malformed');
    expect(readMessage('device', sub({ feed: 'checkout', session: B, view: 'full' })).kind).toBe('malformed');
    expect(readMessage('device', sub({ feed: 'checkout', session: B, cursor: { epoch: 'e', seq: 1, idx: 0 } })).kind).toBe('malformed');
  });

  it('reads a session’s own subscription as before', () => {
    expect(readMessage('device', sub({ session: B, view: 'cards', cursor: { epoch: 'launch-1', seq: 2, idx: 1 } })).kind).toBe('message');
    expect(readMessage('device', sub({})).kind).toBe('malformed');
  });

});

// P5 O7 M3 (`rl2.streams`, `rl2.executor.pty-host`; RL2 1.3): the stream kinds, each read whole.
describe('streams', () => {
  const ID = 'AAAAAAAAAAAAAAAAAAAAAA';
  const EPOCH = 'BBBBBBBBBBBBBBBBBBBBBA';
  const pty = { ptyId: 'p1', from: 0, inputEpoch: EPOCH, inputFrom: 0 };
  const open = (fields: Record<string, unknown> = {}) => ({ t: 'streamOpen', id: ID, kind: 'pty', op: OP, credit: 65536, pty, ...fields });
  const read = (from: 'device' | 'endpoint', m: Record<string, unknown>) => readMessage(from as 'device', m).kind;

  it('reads a pty open with its start and a tcp open with its forward', () => {
    expect(read('device', open())).toBe('message');
    expect(read('device', open({ kind: 'tcp', pty: undefined, tcp: { forward: 'fw-1' } }))).toBe('message');
  });

  it('refuses an open of another kind, with the other kind’s start, without its own, or with an id, op, credit or epoch out of shape', () => {
    for (const bad of [
      open({ kind: 'http' }),
      open({ tcp: { forward: 'fw-1' } }),
      open({ pty: undefined }),
      open({ kind: 'tcp', tcp: { forward: 'fw-1' } }),
      open({ id: 'short' }),
      open({ id: `${ID}A` }),
      open({ op: 'x' }),
      open({ credit: 0 }),
      open({ credit: 4 * 1024 * 1024 + 1 }),
      open({ pty: { ...pty, inputEpoch: 'e' } }),
      open({ pty: { ...pty, from: -1 } }),
      open({ pty: { ...pty, inputFrom: 1.5 } }),
      open({ pty: { ...pty, ptyId: '' } }),
    ])
      expect(read('device', bad)).toBe('malformed');
  });

  it('reads a chunk of 1 to 64 KiB of base64url either way, and refuses padding, another alphabet, an empty or longer one', () => {
    const chunk = (bytes: number) => Buffer.alloc(bytes, 7).toString('base64url');
    for (const from of ['device', 'endpoint'] as const) {
      expect(read(from, { t: 'streamData', id: ID, offset: 0, data: chunk(1) })).toBe('message');
      expect(read(from, { t: 'streamData', id: ID, offset: 9, data: chunk(64 * 1024) })).toBe('message');
      for (const data of ['', chunk(64 * 1024 + 3), 'AQ==', 'A+/B', 'A', 7]) expect(read(from, { t: 'streamData', id: ID, offset: 0, data })).toBe('malformed');
      expect(read(from, { t: 'streamData', id: ID, offset: -1, data: chunk(1) })).toBe('malformed');
      expect(read(from, { t: 'streamCredit', id: ID, bytes: 1 })).toBe('message');
      expect(read(from, { t: 'streamCredit', id: ID, bytes: 0 })).toBe('malformed');
      expect(read(from, { t: 'streamClose', id: ID, reason: 'closed' })).toBe('message');
      expect(read(from, { t: 'streamClose', id: ID, reason: '' })).toBe('malformed');
    }
  });

  it('reads a control from the device only, and the endpoint’s opened and refused answers', () => {
    expect(read('device', { t: 'streamControl', id: ID, control: { resize: { cols: 80, rows: 24 } } })).toBe('message');
    expect(read('device', { t: 'streamControl', id: ID, control: 'resize' })).toBe('malformed');
    expect(read('endpoint', { t: 'streamControl', id: ID, control: {} })).toBe('unknown');
    expect(read('endpoint', { t: 'streamOpened', id: ID, credit: 1024, pty: { info: { ptyId: 'p1' }, ringStart: 0, nextOffset: 12 } })).toBe('message');
    expect(read('endpoint', { t: 'streamOpened', id: ID, credit: 1024 })).toBe('message');
    expect(read('endpoint', { t: 'streamOpened', id: ID, credit: 1024, pty: { info: null, ringStart: 0, nextOffset: 0 } })).toBe('malformed');
    for (const reason of ['grade', 'unknown', 'unreachable', 'busy', 'malformed', 'unavailable']) expect(read('endpoint', { t: 'streamRefused', id: ID, reason })).toBe('message');
    expect(read('endpoint', { t: 'streamRefused', id: ID, reason: 'nope' })).toBe('malformed');
    expect(read('device', { t: 'streamOpened', id: ID, credit: 1 })).toBe('unknown');
  });

  it('is at minor 3 of major 1', () => {
    expect(RL2_PROTOCOL).toEqual({ major: 1, minor: 3 });
  });
});
