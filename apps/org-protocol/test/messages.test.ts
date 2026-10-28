// RL2's channel messages as each side reads the other's (O10 M7's addition): a `queried` may say why the endpoint said
// nothing of an operation (`reason`, with `state: 'refused'`), as a short text.
import { describe, expect, it } from 'vitest';
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
