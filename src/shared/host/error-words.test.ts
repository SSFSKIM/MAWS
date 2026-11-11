// P5 O15 M2b §H (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): an error in the words a log line carries,
// its message, its code and, for Node's aggregate of a connect that failed on several addresses, each inner error's code
// and address, where the aggregate's own message is empty.
import { describe, expect, it } from 'vitest';
import { errorWords } from './error-words';

const coded = (message: string, code: string, more: Record<string, unknown> = {}) => Object.assign(new Error(message), { code, ...more });

describe('errorWords', () => {
  it('gives a plain error’s message', () => {
    expect(errorWords(new Error('the socket closed'))).toBe('the socket closed');
  });

  it('adds a code in parentheses', () => {
    expect(errorWords(coded('connect ECONNREFUSED 127.0.0.1:443', 'ECONNREFUSED'))).toBe('connect ECONNREFUSED 127.0.0.1:443 (ECONNREFUSED)');
  });

  it('names each inner error of an aggregate by its code, address and port', () => {
    const inner = [coded('', 'ETIMEDOUT', { address: '192.0.2.1', port: 443 }), coded('', 'ENETUNREACH', { address: '2001:db8::1', port: 443 })];
    expect(errorWords(Object.assign(new AggregateError(inner, 'connect ETIMEDOUT'), { code: 'ETIMEDOUT' }))).toBe('connect ETIMEDOUT (ETIMEDOUT; ETIMEDOUT 192.0.2.1:443, ENETUNREACH 2001:db8::1:443)');
    // Node's own aggregate has an empty message: the words are the parenthesis alone
    expect(errorWords(Object.assign(new AggregateError(inner, ''), { code: 'ETIMEDOUT' }))).toBe('(ETIMEDOUT; ETIMEDOUT 192.0.2.1:443, ENETUNREACH 2001:db8::1:443)');
  });

  it('never answers empty: an error with no words is named by its kind, anything else as a string', () => {
    expect(errorWords(new AggregateError([], ''))).toBe('AggregateError');
    expect(errorWords('a string thrown')).toBe('a string thrown');
    expect(errorWords(undefined)).toBe('undefined');
  });
});
