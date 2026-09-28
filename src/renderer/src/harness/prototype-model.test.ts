// The spike's throwaway derivation (deleted in M3 with prototype-rows.tsx); these checks pin what G1 measures through it.
import { describe, expect, it } from 'vitest';
import { synthesise } from '../../../../test/support/synth-transcript';
import { PrototypeTranscript } from './prototype-model';

describe('prototype transcript model', () => {
  const events = synthesise({ turns: 500, seed: 1, streamLast: true });

  it('derives at least seven thousand rows and cells for synthetic/500 with every work area expanded', () => {
    const model = new PrototypeTranscript();
    model.apply(events);
    model.expandAll();
    const rows = model.rows();
    const cells = rows.reduce((sum, row) => sum + (row.kind === 'group' ? row.cells.length : 0), 0);
    expect(rows.length + cells).toBeGreaterThanOrEqual(7_000);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it('shows a closed turn as user, divider and answer until its work area is expanded', () => {
    const model = new PrototypeTranscript();
    model.apply(synthesise({ turns: 3, seed: 2 }));
    const first = model.turnId(1);
    const collapsed = model.rows().filter((row) => row.turnId === first && row.kind !== 'time').map((row) => row.kind);
    expect(collapsed.slice(0, 2)).toEqual(['user', 'divider']);
    expect(collapsed).toContain('assistant_text');
    expect(collapsed).not.toContain('thinking');
    model.toggleTurn(first);
    const expanded = model.rows().filter((row) => row.turnId === first && row.kind !== 'time').map((row) => row.kind);
    expect(expanded).toContain('thinking');
    expect(expanded.length).toBeGreaterThan(collapsed.length);
  });

  it('never renders child-agent events as rows of the parent', () => {
    const model = new PrototypeTranscript();
    model.apply(synthesise({ turns: 10, seed: 3 }));
    model.expandAll();
    const tenth = model.rows().filter((row) => row.turnId === model.turnId(10));
    expect(tenth.filter((row) => row.kind === 'subagent')).toHaveLength(2);
    const cells = tenth.flatMap((row) => (row.kind === 'group' ? row.cells : []));
    expect(cells.some((cell) => cell.toolName === 'Agent')).toBe(false);
    expect(cells.every((cell) => !String(cell.toolUseId).includes('_c'))).toBe(true);
  });

  it('keeps a streaming row under one id from its first delta to its completion, and a delta changes no row', () => {
    const model = new PrototypeTranscript();
    const lastDelta = events.findLastIndex((event) => event.kind === 'assistant.block.delta');
    const api = (events[lastDelta] as Extract<(typeof events)[number], { kind: 'assistant.block.delta' }>).apiMessageId;
    const first = events.findIndex((event) => event.kind === 'assistant.block.delta' && event.apiMessageId === api);
    model.apply(events.slice(0, first + 1));
    const live = model.rows().find((row) => row.kind === 'assistant_text' && row.live)!;
    expect(live.id).toMatch(/^text:msg_500_/);
    const before = model.rows();
    model.apply(events.slice(first + 1, first + 3));
    expect(model.rows()).toBe(before);
    expect(model.liveText(live.id).length).toBeGreaterThan(0);
    model.apply(events.slice(first + 3));
    const done = model.rows().find((row) => row.id === live.id)!;
    expect(done).toMatchObject({ kind: 'assistant_text', live: false });
  });
});
