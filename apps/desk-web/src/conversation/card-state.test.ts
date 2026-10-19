// What a request card draws: open (with Allow / Deny or the answer), in flight, uncertain (with Retry), failed with its
// reason, settled by its winner (a late decision refused naming the winner draws as that settlement, not as an error),
// waiting in the terminal, or shown but not answerable while the machine is offline.
import { describe, expect, it } from 'vitest';
import type { Raised, Settled } from 'desk-hub/protocol';
import type { RequestRecord, RpcEntry } from '../project/conversation';
import { cardState, isAsyncQuestion, isQuestion } from './card-state';

const raised: Raised = { request: 'toolu_1', session: 's', tool: 'Bash', input: { command: 'pnpm e2e' }, mac: { nonce: 'n', value: 'v' } };
const record = (over: Partial<RequestRecord> = {}): RequestRecord => ({ key: 'k1', request: 'toolu_1', machine: 'mini', raised, at: 0, pending: true, terminalOnly: false, settled: null, ...over });
const rpc = (state: RpcEntry['state'], outcome?: RpcEntry['outcome']): RpcEntry => ({ nonce: 'r', rpc: {} as RpcEntry['rpc'], state, outcome });
const settled = (winner: Settled['winner'], outcome: Settled['outcome'], by: string): Settled => ({ request: 'toolu_1', winner, outcome, by, mac: { nonce: 'n', value: 'v' } });
const can = { can: true, reason: null };

describe('cardState', () => {
  it('is open while pending and answerable, and marks a background subagent\'s window', () => {
    expect(cardState(record(), null, can)).toEqual({ kind: 'open', window: false });
    expect(cardState(record({ raised: { ...raised, deadline: '2026-10-15T08:00:03.000Z' } }), null, can)).toEqual({ kind: 'open', window: true });
  });

  it('follows the RPC it sent: in flight, uncertain, failed with its reason, sent', () => {
    expect(cardState(record(), rpc('sending'), can)).toEqual({ kind: 'sending' });
    expect(cardState(record(), rpc('forwarded'), can)).toEqual({ kind: 'sending' });
    expect(cardState(record(), rpc('uncertain'), can)).toEqual({ kind: 'uncertain', offline: false });
    expect(cardState(record(), rpc('failed', { state: 'failed', error: { code: 'digest-mismatch', message: '' } }), can)).toEqual({ kind: 'failed', code: 'digest-mismatch', message: '' });
    expect(cardState(record(), rpc('done', { state: 'done', result: {} }), can)).toEqual({ kind: 'sent' });
  });

  it('draws a late decision refused naming who decided as settled by them, reading `by` (which may come without `winner`)', () => {
    const late = rpc('failed', { state: 'failed', error: { code: 'not-pending', message: 'answered in the terminal', winner: 'terminal', by: 'terminal' } });
    expect(cardState(record(), late, can)).toEqual({ kind: 'settled', winner: 'terminal', outcome: null, by: 'terminal' });
    const byAlone = rpc('failed', { state: 'failed', error: { code: 'not-pending', message: 'already settled', by: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' } });
    expect(cardState(record(), byAlone, can)).toEqual({ kind: 'settled', winner: null, outcome: null, by: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' });
    const winnerAlone = rpc('failed', { state: 'failed', error: { code: 'not-pending', message: '', winner: 'web' } });
    expect(cardState(record(), winnerAlone, can)).toEqual({ kind: 'settled', winner: 'web', outcome: null, by: '' });
    const nearDeadline = rpc('failed', { state: 'failed', error: { code: 'not-pending', message: '', terminalOnly: true } });
    expect(cardState(record(), nearDeadline, can)).toEqual({ kind: 'terminal', why: 'window' });
  });

  it('is settled once a verified settlement came, whatever else holds', () => {
    expect(cardState(record({ pending: false, settled: settled('web', 'deny', 'm') }), rpc('done'), can)).toEqual({ kind: 'settled', winner: 'web', outcome: 'deny', by: 'm' });
  });

  it('waits in the terminal when the hub says only it can answer, or the session has no bridge', () => {
    expect(cardState(record({ terminalOnly: true }), null, can)).toEqual({ kind: 'terminal', why: 'window' });
    expect(cardState(record(), null, { can: false, reason: 'terminal only: maws-45 runs without the bridge' })).toEqual({ kind: 'terminal', why: 'terminal only: maws-45 runs without the bridge' });
  });

  it('keeps an uncertain decision uncertain, with its retry, while the machine is offline', () => {
    const off = { can: false, reason: 'mini is offline: shown, not answerable' };
    expect(cardState(record(), rpc('uncertain'), off, false)).toEqual({ kind: 'uncertain', offline: true });
  });

  it('is shown, not answerable, while the machine is offline; closed once it left the set unsettled', () => {
    expect(cardState(record(), null, { can: false, reason: 'mini is offline: shown, not answerable' }, false)).toEqual({ kind: 'offline' });
    expect(cardState(record({ pending: false }), null, can)).toEqual({ kind: 'closed' });
  });

  it('keeps an uncertain decision uncertain, with its retry, when the request left the pending set unsettled', () => {
    // A daemon's republished set can drop a request with no settlement: that says nothing of whether the decision ran.
    expect(cardState(record({ pending: false }), rpc('uncertain'), can)).toEqual({ kind: 'uncertain', offline: false });
  });

  it('follows its Retry to the end once the request left the set unsettled: in flight, then its result; never a new decision', () => {
    const gone = record({ pending: false });
    const states = (['uncertain', 'sending', 'forwarded', 'done'] as const).map((s) => cardState(gone, rpc(s, s === 'done' ? { state: 'done', result: {} } : undefined), can).kind);
    expect(states).toEqual(['uncertain', 'sending', 'sending', 'sent']);
    // A decision that failed on a request no longer waiting offers no other: the request is gone.
    expect(cardState(gone, rpc('failed', { state: 'failed', error: { code: 'not-pending', message: '' } }), can)).toEqual({ kind: 'closed' });
  });
});

describe('while the project socket is not connected', () => {
  it('is shown, not answerable; an uncertain decision keeps its Retry', () => {
    const off = { can: false, reason: 'not connected to the hub' };
    expect(cardState(record(), null, off, true, false)).toEqual({ kind: 'disconnected' });
    expect(cardState(record(), rpc('uncertain'), off, true, false)).toEqual({ kind: 'uncertain', offline: false });
  });

  it('draws a decision refused in the browser for want of a connection as failed, so another can follow', () => {
    expect(cardState(record(), rpc('not-connected'), can)).toEqual({ kind: 'failed', code: 'not-connected', message: 'not connected to the hub: nothing was sent' });
  });
});

describe('the kind of request', () => {
  it('tells a question from a permission prompt, and an async question (`raised.async`) from a native one', () => {
    expect(isQuestion('AskUserQuestion')).toBe(true);
    expect(isQuestion('mcp__doperpowers__AskUserQuestion')).toBe(true);
    expect(isQuestion('mcp__sminos__AskUserQuestion')).toBe(true); // the ask once it moved to the sminos plugin
    expect(isQuestion('Bash')).toBe(false);
    expect(isAsyncQuestion({ ...raised, tool: 'mcp__doperpowers__AskUserQuestion', input: { questions: [] }, async: true } as Raised)).toBe(true);
    expect(isAsyncQuestion({ ...raised, tool: 'mcp__sminos__AskUserQuestion', input: { questions: [] }, async: true } as Raised)).toBe(true);
    expect(isAsyncQuestion({ ...raised, tool: 'AskUserQuestion', input: { questions: [] } })).toBe(false);
  });
});
