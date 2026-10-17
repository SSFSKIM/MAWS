// P3-E (E2 M2; ledger X25): the dashboard's `artifact_dataset` is classed as the namespace's other writers are.
import { describe, expect, it } from 'vitest';
import { classifyTool, presentationOf, type ClassifyContext } from './classify';

const base: ClassifyContext = { denial: null, terminalReason: null, turnClosed: false, humanDecision: false, safeguard: 'not_evaluated', imageResult: false, isError: false };

describe('artifact_dataset in the transcript', () => {
  it('is a cell of its own, never folded into a group of MCP calls', () => {
    const c = classifyTool('mcp__maws__artifact_dataset', {}, base);
    expect([c.category, c.groupable, c.hidden]).toEqual(['other', false, false]);
    expect(presentationOf('mcp__maws__artifact_dataset')).toBe('cell');
  });
});
