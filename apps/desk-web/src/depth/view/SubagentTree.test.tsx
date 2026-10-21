// @vitest-environment happy-dom
// The depth column's subagent tree says how long ago each finished agent ended in the desk's one display locale,
// English (P4 Decision Log 4), whatever the browser's: the owner's Korean browser read "finished · 3분 전" there while
// the stream beside it read English. This project runs under a Korean system locale (vitest.config.ts), where a
// formatter on the default locale writes Korean.
import { cleanup, render } from '@testing-library/react';
import type { SubagentMeta, SubagentStatusFacts } from 'desk-hub/protocol';
import { afterEach, expect, it } from 'vitest';
import { setAgentsClock } from '../../../../../src/renderer/src/tools/agents/subagents/shared';
import { taskGraphOf, withStatuses } from '../agents/task-feed';
import { INITIAL_TREE_VIEW, SubagentTree } from './SubagentTree';

const NOW = Date.parse('2026-10-17T10:00:00.000Z');
const MINUTE = 60_000;
const ended = (agentId: string, description: string, status: 'completed' | 'failed' | 'stopped', agoMs: number, summary?: string): SubagentMeta =>
  ({
    agentId,
    meta: { agentType: 'general-purpose', description, toolUseId: `toolu_${agentId}`, spawnDepth: 1 },
    status,
    evidence: 'rows',
    outcome: { status, raw: status, at: new Date(NOW - agoMs).toISOString(), ...(summary && { summary }) },
  }) as SubagentMeta & SubagentStatusFacts;

afterEach(() => {
  setAgentsClock(null);
  cleanup();
});

it('runs where the system writes Korean', () => {
  expect(new Intl.DateTimeFormat().resolvedOptions().locale).toBe('ko-KR');
  expect(new Intl.RelativeTimeFormat(undefined, { style: 'narrow' }).format(-3, 'minute')).toBe('3분 전');
});

it("writes a finished agent's age in English, as the stream beside it does", () => {
  const metas = [ended('a1', 'reader', 'completed', 3 * MINUTE, 'read it'), ended('a2', 'builder', 'failed', 2 * 60 * MINUTE), ended('a3', 'scout', 'stopped', 26 * 60 * MINUTE)];
  setAgentsClock(NOW);
  const { container } = render(
    <SubagentTree tasks={withStatuses(taskGraphOf(metas, []), metas)} view={{ ...INITIAL_TREE_VIEW, expanded: { agents: true, done: true, disk: true } }} onView={() => {}} onOpen={() => {}} statusesKnown />,
  );
  const line = (agentId: string) => container.querySelector(`[data-agent-row="${agentId}"] [data-part="line"]`)?.textContent;
  expect([line('a1'), line('a2'), line('a3')]).toEqual(['finished · 3m ago · read it', 'finished with errors · 2h ago', 'stopped · 1d ago']);
});
