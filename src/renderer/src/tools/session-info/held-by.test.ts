import { describe, expect, it } from 'vitest';
import { record } from '../../../../../test/support/builders';
import { drivenSection, heldByRow } from './model';

// W7 (charter §4.3 as amended 2026-10-01): Session info names who holds the session through the glyph's derivation.
describe("Session info's Held by row", () => {
  it('reads MAWS, MAWS and the contesting process, the foreign holder alone, or no process', () => {
    expect(heldByRow(record('s', { holder: { kind: 'self' } }))).toEqual({ label: 'Held by', value: 'MAWS' });
    expect(heldByRow(record('s', { holder: { kind: 'self', contestedBy: { kind: 'terminal', pid: 96367 } } }))).toEqual({
      label: 'Held by',
      value: 'MAWS and Terminal · pid 96367',
      note: 'Contested: MAWS yields once the other process writes',
    });
    expect(heldByRow(record('s', { holder: { kind: 'background_job', pid: 4, jobId: 'abcd1234' } }))).toEqual({ label: 'Held by', value: 'bg · abcd1234', note: 'Read-only here' });
    expect(heldByRow(record('s', { holder: { kind: 'none' } }))).toEqual({ label: 'Held by', value: 'No process' });
  });
});

// P5 O9 M5 (the owner's Q1 and Q2): a terminal session MAWS drives through its bridge says so where it is held, and the
// panel lists every control it can't reach here with its reason.
describe("Session info for a session driven through its terminal's bridge", () => {
  it('names the bridge beside the terminal holder', () => {
    expect(heldByRow(record('s', { holder: { kind: 'terminal', pid: 7 } }), { bridged: true })).toEqual({ label: 'Held by', value: 'Terminal · pid 7', note: 'Driven through sminos’s bridge' });
  });

  it('lists each unavailable control with its reason, in the controls’ order', () => {
    const closed: Record<string, string> = { mode: 'A terminal session’s mode is changed in the terminal', queue: 'The terminal keeps its own queue', tell: 'Not in sminos 1.25.0' };
    const capability = (key: string) => (key in closed ? { available: false as const, reason: closed[key]! } : { available: true as const });
    expect(drivenSection(capability)).toEqual({
      title: 'Not available here',
      rows: [
        { label: 'Permission mode', value: closed.mode },
        { label: 'Message a subagent', value: closed.tell },
        { label: 'Queue', value: closed.queue },
      ],
    });
    expect(drivenSection(() => ({ available: true }))).toBeNull();
  });
});
