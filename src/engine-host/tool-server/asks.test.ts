import { describe, expect, it, vi } from 'vitest';
import type { RequestId } from '@shared/graph/ids';
import type { PendingAsk } from '@shared/maws/ask';
import { TOOL_ERRORS } from '@shared/maws/tools';
import { AskTable } from './asks';
import { toolError, toolText, type McpToolResult } from './server';

const ask = (askId: string, blocking: boolean): PendingAsk => ({
  askId, toolUseId: null, requestId: `r-${askId}` as RequestId, blocking, title: null, context: null,
  questions: [{ id: 'q1', question: 'Proceed?', modality: 'choice', options: [{ label: 'Yes' }] }], openedAt: '2026-10-05T00:00:00.000Z',
});

describe('AskTable (residue 12: pending → answering → removed, or pending again)', () => {
  it('lists pending and answering asks; a claim takes a pending ask once', () => {
    const table = new AskTable();
    table.open(ask('a', true), { blocking: true, resolve: () => {} });
    table.open(ask('b', false), { blocking: false });
    expect(table.list().map((a) => a.askId)).toEqual(['a', 'b']);
    expect(table.get('b')?.askId).toBe('b');
    expect(table.claim('a')?.askId).toBe('a');
    expect(table.claim('a')).toBeNull(); // answering: a second submit is not_pending
    expect(table.claim('zz')).toBeNull();
    expect(table.list().map((a) => a.askId)).toEqual(['a', 'b']); // an ask being answered is still listed
  });

  it('commit removes the ask and settles a blocking call with what was written; release makes it pending again', () => {
    const table = new AskTable();
    const resolve = vi.fn<(result: McpToolResult) => void>();
    table.open(ask('a', true), { blocking: true, resolve });
    table.claim('a');
    table.release('a'); // the write failed
    expect(table.claim('a')?.askId).toBe('a'); // the retry
    const written = toolText({ status: 'answered', askId: 'a', answers: [] });
    table.commit('a', written);
    table.commit('a', written); // idempotent (the flushed row and the write's settle both commit)
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith(written);
    expect(table.list()).toEqual([]);
    table.release('a'); // nothing to release after a commit
    expect(table.list()).toEqual([]);
  });

  it('counts the async asks it holds (the blocking ones are calls in flight, counted by the server)', () => {
    const table = new AskTable();
    table.open(ask('a', true), { blocking: true, resolve: () => {} });
    table.open(ask('b', false), { blocking: false });
    table.open(ask('c', false), { blocking: false });
    expect(table.asyncCount).toBe(2);
    table.claim('b');
    expect(table.asyncCount).toBe(2);
    table.commit('b');
    expect(table.asyncCount).toBe(1);
  });

  it('cancels from either state, settling a blocking call with a text nobody writes', () => {
    const changed = vi.fn();
    const table = new AskTable({ onChange: changed });
    const resolve = vi.fn<(result: McpToolResult) => void>();
    const resolveAtExit = vi.fn<(result: McpToolResult) => void>();
    table.open(ask('a', true), { blocking: true, resolve });
    table.open(ask('b', false), { blocking: false });
    table.open(ask('c', false), { blocking: false });
    table.open(ask('d', true), { blocking: true, resolve: resolveAtExit });
    table.claim('b');
    expect(table.cancel('a', 'withdrawn')?.askId).toBe('a');
    expect(resolve).toHaveBeenCalledWith(toolError('ask: the engine withdrew the call'));
    expect(table.cancel('a', 'withdrawn')).toBeNull();
    expect(table.cancelAll('exit').map((a) => a.askId)).toEqual(['b', 'c', 'd']); // the one being answered too
    expect(resolveAtExit).toHaveBeenCalledWith(toolError(TOOL_ERRORS.sessionEnded));
    expect(table.list()).toEqual([]);
    table.commit('b'); // a write that settles after the exit commits nothing
    expect(changed).toHaveBeenCalled();
  });
});
