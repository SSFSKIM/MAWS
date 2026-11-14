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

  // P5 O7 M5a (`rl2.artifacts`, RL2 1.4): the machine's `artifacts` feed names no session, as `attention`
  it('reads an artifacts feed with no session, and refuses one with a session or a view', () => {
    expect(readMessage('device', sub({ feed: 'artifacts' })).kind).toBe('message');
    expect(readMessage('device', sub({ feed: 'artifacts', cursor: { epoch: 'artifacts:boot', seq: 3 } })).kind).toBe('message');
    expect(readMessage('device', sub({ feed: 'artifacts', session: B })).kind).toBe('malformed');
    expect(readMessage('device', sub({ feed: 'artifacts', view: 'full' })).kind).toBe('malformed');
  });

  // P5 O17 M9a (`rl2.browser-screencast`, RL2 1.8): a session's `browser.inventory` feed names its session, as `checkout`
  it('reads a browser inventory feed with its session, and refuses one with none or with a view', () => {
    expect(readMessage('device', sub({ feed: 'browser.inventory', session: B })).kind).toBe('message');
    expect(readMessage('device', sub({ feed: 'browser.inventory' })).kind).toBe('malformed');
    expect(readMessage('device', sub({ feed: 'browser.inventory', session: B, view: 'full' })).kind).toBe('malformed');
  });

  // P5 O8 M7b (`rl2.channel`, RL2 1.12): the machine's `channel` feed names the project whose to-human entries it carries,
  // and no session; no other feed names a project
  it('reads a channel feed with its project, and refuses one with none, with a session or a view, and a project on any other feed', () => {
    expect(readMessage('device', sub({ feed: 'channel', project: 'proj-1' })).kind).toBe('message');
    expect(readMessage('device', sub({ feed: 'channel', project: 'proj-1', cursor: { epoch: 'channel:boot', seq: 3 } })).kind).toBe('message');
    for (const project of [undefined, '', 7, 'p'.repeat(513)]) expect(readMessage('device', sub({ feed: 'channel', ...(project === undefined ? {} : { project }) })).kind).toBe('malformed');
    expect(readMessage('device', sub({ feed: 'channel', project: 'proj-1', session: B })).kind).toBe('malformed');
    expect(readMessage('device', sub({ feed: 'channel', project: 'proj-1', view: 'full' })).kind).toBe('malformed');
    expect(readMessage('device', sub({ feed: 'attention', project: 'proj-1' })).kind).toBe('malformed');
    expect(readMessage('device', sub({ feed: 'checkout', session: B, project: 'proj-1' })).kind).toBe('malformed');
    expect(readMessage('device', sub({ session: B, project: 'proj-1' })).kind).toBe('malformed');
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

// 2026-11-06 (`rl2.agent-scope`, RL2 1.11): a lane A session's `full` stream may name one subagent's transcript
// (`agentId`, as sminos spells an agent id) in place of the main one; nothing else names an agent.
describe('sub.agentId', () => {
  const sub = (fields: Record<string, unknown>) => ({ t: 'sub', sub: 's1', cursor: null, credit: 1024, ...fields });
  const A = { lane: 'A', id: 'la-1' };

  it('reads a lane A stream naming a subagent, with or without its view, from a snapshot or an (epoch, seq) cursor', () => {
    expect(readMessage('device', sub({ session: A, agentId: 'ab5e2e00000000001' })).kind).toBe('message');
    expect(readMessage('device', sub({ session: A, view: 'full', agentId: 'a_b-1', cursor: { epoch: 'up-1', seq: 4 } })).kind).toBe('message');
    expect(readMessage('device', sub({ session: A, agentId: 'x'.repeat(128) })).kind).toBe('message');
  });

  it('refuses an agent of a lane B session, of a cards view or a feed, and an id sminos would not take', () => {
    expect(readMessage('device', sub({ session: { lane: 'B', id: 'app-1' }, agentId: 'a1' })).kind).toBe('malformed');
    expect(readMessage('device', sub({ session: A, view: 'cards', agentId: 'a1' })).kind).toBe('malformed');
    expect(readMessage('device', sub({ session: { lane: 'B', id: 'app-1' }, feed: 'checkout', agentId: 'a1' })).kind).toBe('malformed');
    expect(readMessage('device', sub({ feed: 'attention', agentId: 'a1' })).kind).toBe('malformed');
    for (const agentId of [null, '', 'a/b', 'a b', 'x'.repeat(129), 7]) expect(readMessage('device', sub({ session: A, agentId })).kind, String(agentId)).toBe('malformed');
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
    expect(read('device', open({ pty: { ...pty, inputFrom: 3, inputSent: 8 } }))).toBe('message');
    expect(read('device', open({ kind: 'tcp', pty: undefined, tcp: { forward: 'fw-1' } }))).toBe('message');
  });

  it('refuses an open of another kind, with the other kind’s start, without its own, or with an id, op, credit or epoch out of shape', () => {
    for (const bad of [
      open({ kind: 'ssh' }),
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
      open({ pty: { ...pty, inputFrom: 3, inputSent: 2 } }),
      open({ pty: { ...pty, inputSent: -1 } }),
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

});

// P5 O7 M7 (`rl2.pong-clock`; RL2 1.6): `pong` may carry the endpoint's clock at the ping's arrival (`received`) and at
// the pong's send (`sent`), each in milliseconds, for the remote bench's clock offset; a pong without them reads as before.
describe('the pong clock', () => {
  it('reads a pong with or without the endpoint’s two stamps, either way', () => {
    const stamped = { t: 'pong', at: 42, received: 1_799_000_000_001, sent: 1_799_000_000_002 };
    for (const read of [(v: unknown) => readMessage('device', v), (v: unknown) => readMessage('endpoint', v)]) {
      expect(read({ t: 'pong', at: 42 })).toEqual({ kind: 'message', message: { t: 'pong', at: 42 } });
      expect(read(stamped)).toEqual({ kind: 'message', message: stamped });
    }
  });

  it('refuses a stamp that is no count of milliseconds', () => {
    for (const stamp of [-1, 1.5, '7', null, Number.MAX_SAFE_INTEGER + 2]) {
      expect(readMessage('endpoint', { t: 'pong', at: 42, received: stamp, sent: 7 }).kind).toBe('malformed');
      expect(readMessage('endpoint', { t: 'pong', at: 42, received: 7, sent: stamp }).kind).toBe('malformed');
    }
  });

  it('is at minor 14 of major 1 (the UX wave’s session acts: `rl2.session-acts`, after the project registry’s `rl2.project-acts` at 13)', () => {
    expect(RL2_PROTOCOL).toEqual({ major: 1, minor: 14 });
  });
});

// P5 O7 M5b (`rl2.read-open`; RL2 1.5): the read open, a `streamOpen` with no `op` of the kinds `http` and `document`, its
// answer's `http`, and the refusal `read-only`. P5 O17 M9a builds the reserved `browser.screencast` kind on it.
describe('the read open', () => {
  const ID = 'AAAAAAAAAAAAAAAAAAAAAA';
  const URL = 'maws-artifact://11111111-1111-4111-8111-111111111111/live/index.html';
  const http = { url: URL, method: 'GET' };
  const document = { artifactId: '11111111-1111-4111-8111-111111111111', mode: 'edit' };
  const open = (fields: Record<string, unknown>) => ({ t: 'streamOpen', id: ID, credit: 65536, ...fields });
  const read = (from: 'device' | 'endpoint', m: Record<string, unknown>) => readMessage(from as 'device', m).kind;

  it('reads an `http` open of a GET or a HEAD, with or without a range, and a `document` open to edit or view, of the suggestions too', () => {
    expect(read('device', open({ kind: 'http', http }))).toBe('message');
    expect(read('device', open({ kind: 'http', http: { ...http, method: 'HEAD' } }))).toBe('message');
    expect(read('device', open({ kind: 'http', http: { ...http, range: 'bytes=0-99' } }))).toBe('message');
    expect(read('device', open({ kind: 'document', document }))).toBe('message');
    expect(read('device', open({ kind: 'document', document: { ...document, mode: 'view', doc: 'suggestions' } }))).toBe('message');
  });

  it('refuses a read open naming an `op`, carrying another kind’s fields or none of its own, or with fields out of shape', () => {
    for (const bad of [
      open({ kind: 'http', op: OP, http }),
      open({ kind: 'document', op: OP, document }),
      open({ kind: 'http' }),
      open({ kind: 'http', http, document }),
      open({ kind: 'http', http, tcp: { forward: 'fw-1' } }),
      open({ kind: 'document', http }),
      open({ kind: 'http', http: { ...http, method: 'POST' } }),
      open({ kind: 'http', http: { ...http, url: '' } }),
      open({ kind: 'http', http: { ...http, url: 7 } }),
      open({ kind: 'http', http: { ...http, range: '' } }),
      open({ kind: 'document', document: { ...document, mode: 'write' } }),
      open({ kind: 'document', document: { ...document, artifactId: '' } }),
      open({ kind: 'document', document: { ...document, doc: 'other' } }),
    ])
      expect(read('device', bad)).toBe('malformed');
  });

  it('still requires an `op` of a pty or a tcp open (the act open)', () => {
    const pty = { ptyId: 'p1', from: 0, inputEpoch: 'BBBBBBBBBBBBBBBBBBBBBA', inputFrom: 0 };
    expect(read('device', open({ kind: 'pty', pty }))).toBe('malformed');
    expect(read('device', open({ kind: 'tcp', tcp: { forward: 'fw-1' } }))).toBe('malformed');
    expect(read('device', open({ kind: 'pty', op: OP, pty }))).toBe('message');
  });

  // P5 O17 M9a (`rl2.browser-screencast`; RL2 1.8; O17's Interfaces §K): the kind on the read open, its `browser` field,
  // a controlling open naming its done `machine.browserControl` act inside it, never as the stream's `op`.
  it('reads a `browser.screencast` open, read-only or naming its control act, and refuses one with an `op`, another kind’s fields, or its own out of shape', () => {
    const browser = { appSessionId: 'app-1', epoch: 'e1', tabId: 't1' };
    expect(read('device', open({ kind: 'browser.screencast', browser }))).toBe('message');
    expect(read('device', open({ kind: 'browser.screencast', browser: { ...browser, control: { op: OP } } }))).toBe('message');
    for (const bad of [
      open({ kind: 'browser.screencast', op: OP, browser }),
      open({ kind: 'browser.screencast' }),
      open({ kind: 'browser.screencast', browser, http }),
      open({ kind: 'http', http, browser }),
      open({ kind: 'browser.screencast', browser: { ...browser, appSessionId: '' } }),
      open({ kind: 'browser.screencast', browser: { ...browser, epoch: 7 } }),
      open({ kind: 'browser.screencast', browser: { appSessionId: 'app-1', epoch: 'e1' } }),
      open({ kind: 'browser.screencast', browser: { ...browser, control: true } }),
      open({ kind: 'browser.screencast', browser: { ...browser, control: { op: 'short' } } }),
    ])
      expect([bad, read('device', bad)]).toEqual([bad, 'malformed']);
  });

  it('reads a `browser.screencast` answer naming its epoch, tab and whether it controls, and the refusals `engine-changed` and `control-busy`', () => {
    expect(read('endpoint', { t: 'streamOpened', id: ID, credit: 1024, browser: { epoch: 'e1', tabId: 't1', control: false } })).toBe('message');
    for (const bad of [{ epoch: 'e1', tabId: 't1' }, { epoch: '', tabId: 't1', control: true }, { epoch: 'e1', tabId: 't1', control: 'yes' }, []])
      expect(read('endpoint', { t: 'streamOpened', id: ID, credit: 1024, browser: bad })).toBe('malformed');
    for (const reason of ['engine-changed', 'control-busy']) expect(read('endpoint', { t: 'streamRefused', id: ID, reason })).toBe('message');
    for (const reason of ['engine_changed', 'control_busy', 'tab-closed']) expect(read('endpoint', { t: 'streamRefused', id: ID, reason })).toBe('malformed');
  });

  it('reads an answer’s `http` status and headers, and refuses them out of shape', () => {
    expect(read('endpoint', { t: 'streamOpened', id: ID, credit: 1024, http: { status: 206, headers: { 'content-type': 'text/html', 'content-range': 'bytes 0-9/20' } } })).toBe('message');
    for (const bad of [{ status: 99, headers: {} }, { status: 600, headers: {} }, { status: 200.5, headers: {} }, { status: 200 }, { status: 200, headers: { a: 1 } }, { status: 200, headers: [] }])
      expect(read('endpoint', { t: 'streamOpened', id: ID, credit: 1024, http: bad })).toBe('malformed');
  });

  it('reads the refusal `read-only`', () => {
    expect(read('endpoint', { t: 'streamRefused', id: ID, reason: 'read-only' })).toBe('message');
  });
});

// P5 O7 M5c (`rl2.client-port`; RL2 1.6): the client port across the channel, `client` from the endpoint and
// `clientAnswer` from the device, each read from its own side only.
describe('the client port', () => {
  const read = (from: 'device' | 'endpoint', m: Record<string, unknown>) => readMessage(from as 'device', m).kind;

  it('reads a `client` request from the endpoint and a `clientAnswer` from the device', () => {
    expect(read('endpoint', { t: 'client', id: 'cp-1', kind: 'openExternal', request: { url: 'https://example.com/consent' } })).toBe('message');
    expect(read('endpoint', { t: 'client', id: 'cp-2', kind: 'someKindLater', request: null })).toBe('message');
    expect(read('device', { t: 'clientAnswer', id: 'cp-1', answer: { opened: true } })).toBe('message');
    expect(read('device', { t: 'clientAnswer', id: 'cp-1', answer: { noClient: true } })).toBe('message');
  });

  it('refuses either out of shape', () => {
    for (const bad of [
      { t: 'client', id: '', kind: 'openExternal', request: {} },
      { t: 'client', id: 'x'.repeat(129), kind: 'openExternal', request: {} },
      { t: 'client', id: 'cp-1', kind: '', request: {} },
      { t: 'client', id: 'cp-1', kind: 7, request: {} },
      { t: 'client', id: 'cp-1', kind: 'openExternal' },
    ])
      expect(read('endpoint', bad)).toBe('malformed');
    for (const bad of [{ t: 'clientAnswer', id: '', answer: {} }, { t: 'clientAnswer', id: 7, answer: {} }, { t: 'clientAnswer', id: 'cp-1' }]) expect(read('device', bad)).toBe('malformed');
  });

  it('reads each from its own side only: a `client` from a device and a `clientAnswer` from the endpoint are unknown', () => {
    expect(read('device', { t: 'client', id: 'cp-1', kind: 'openExternal', request: {} })).toBe('unknown');
    expect(read('endpoint', { t: 'clientAnswer', id: 'cp-1', answer: {} })).toBe('unknown');
  });
});
