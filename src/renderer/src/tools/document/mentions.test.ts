// The document's mention source (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; Decision Log 25): the owner,
// the sessions by title, and the artifacts through L's library reads (`library.list` with the query), the document
// itself left out; the library's failure leaves the people and sessions.
import { describe, expect, it, vi } from 'vitest';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import { documentMentions } from './mentions';

const SELF = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const OTHER = '9f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const libraryRow = (id: string, title: string, kind = 'document') => ({ id, kind, title });

function deps(answer: unknown = { rows: [libraryRow(SELF, 'Launch plan'), libraryRow(OTHER, 'Pricing page', 'html')], counts: {} }) {
  const calls: Array<[string, unknown]> = [];
  const ipc: Pick<MawsBridge, 'invoke'> = {
    invoke: (async (name: CommandName, input: unknown) => {
      calls.push([name, input]);
      return answer instanceof Error ? { ok: false, error: { code: 'internal', message: answer.message } } : { ok: true, value: answer };
    }) as MawsBridge['invoke'],
  };
  const sessions = () => [
    { appSessionId: 'app-1', title: 'Fix the build' },
    { appSessionId: 'app-2', title: 'Plan the launch' },
  ];
  const log = vi.fn();
  return { calls, log, source: documentMentions({ artifactId: SELF, ipc, sessions, owner: () => ({ ref: 'human', name: 'Owner' }), log }) };
}

describe('documentMentions', () => {
  it('offers the owner, the sessions and the other artifacts for an empty query', async () => {
    const { source, calls } = deps();
    expect(await source.search('')).toEqual([
      { kind: 'person', ref: 'human', label: 'Owner' },
      { kind: 'session', ref: 'app-1', label: 'Fix the build', detail: 'Session' },
      { kind: 'session', ref: 'app-2', label: 'Plan the launch', detail: 'Session' },
      { kind: 'artifact', ref: OTHER, label: 'Pricing page', detail: 'HTML page' },
    ]);
    expect(calls).toEqual([['library.list', { filter: {} }]]);
  });

  it('narrows the people and sessions by title and asks the library with the query', async () => {
    const { source, calls } = deps({ rows: [libraryRow(OTHER, 'Launch checklist')], counts: {} });
    expect(await source.search('  launch ')).toEqual([
      { kind: 'session', ref: 'app-2', label: 'Plan the launch', detail: 'Session' },
      { kind: 'artifact', ref: OTHER, label: 'Launch checklist', detail: 'Document' },
    ]);
    expect(calls).toEqual([['library.list', { filter: { query: 'launch' } }]]);
  });

  it('keeps the people and sessions when the library cannot answer, and logs why', async () => {
    const { source, log } = deps(new Error('the index is unavailable'));
    expect((await source.search('fix')).map((t) => t.label)).toEqual(['Fix the build']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('the index is unavailable'));
  });
});
