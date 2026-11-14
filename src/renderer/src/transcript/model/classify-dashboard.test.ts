// P3-E (E2 M2; ledger X25): the dashboard's `artifact_dataset` is classed as the namespace's other writers are; UX wave
// U2 (l6-artifacts-12): a step of its run, as they all are.
import { describe, expect, it } from 'vitest';
import { classifyTool, presentationOf, type ClassifyContext } from './classify';

const base: ClassifyContext = { denial: null, turn: { closed: false, stopped: false }, continued: false, humanDecision: false, safeguard: 'not_evaluated', imageResult: false, isError: false };

describe('artifact_dataset in the transcript', () => {
  it('is a cell that joins its run', () => {
    const c = classifyTool('mcp__maws__artifact_dataset', {}, base);
    expect([c.category, c.groupable]).toEqual(['other', true]);
    expect(presentationOf('mcp__maws__artifact_dataset')).toBe('cell');
  });
});
