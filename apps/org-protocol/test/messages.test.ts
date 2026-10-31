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

  it('admits each executor RL2 names, `machine` among them', () => {
    for (const executor of ['sminos', 'engine-host', 'endpoint', 'machine']) expect(readMessage('device', query(executor)).kind).toBe('message');
  });

  it('refuses an executor RL2 does not name', () => {
    for (const executor of ['pty-host', 'main', '', 7]) expect(readMessage('device', query(executor)).kind).toBe('malformed');
  });

  it('is at minor 1 of major 1', () => {
    expect(RL2_PROTOCOL).toEqual({ major: 1, minor: 1 });
  });
});
