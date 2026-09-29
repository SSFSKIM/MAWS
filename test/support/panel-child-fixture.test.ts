import { readFileSync, writeFileSync } from 'node:fs';
import { SessionEventSchema } from '@shared/graph/events';
import { describe, expect, it } from 'vitest';
import { derivePanelChildFixture, firstChildOf, measurePanelChild, PANEL_CHILD_FILE, PANEL_CHILD_TAIL, PANEL_CHILD_UNITS, serializePanelChild } from './panel-child-fixture';

// Regenerate the committed fixture after a deliberate change with:
//   MAWS_WRITE_PANEL_CHILD=1 pnpm test -- test/support/panel-child-fixture
describe('panel-child fixture is reproducible', () => {
  const events = derivePanelChildFixture();
  const measured = measurePanelChild(events);

  it('regenerates the committed file byte for byte', () => {
    if (process.env.MAWS_WRITE_PANEL_CHILD === '1') writeFileSync(PANEL_CHILD_FILE, serializePanelChild(events));
    expect(readFileSync(PANEL_CHILD_FILE, 'utf8')).toBe(serializePanelChild(events));
  });

  it('is valid X1 with unique ids, and the tail belongs to the first child, whose finish is withheld', () => {
    for (const event of events) SessionEventSchema.parse(event);
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    const child = firstChildOf(events);
    const tail = events.filter((event) => event.id.startsWith('panel-child:'));
    expect(tail.every((event) => (event.parentToolUseId as string | null) === (child.toolUseId as string))).toBe(true);
    expect(events.some((event) => event.kind === 'subagent.finished' && (event.taskId as string) === (child.agentId as string))).toBe(false);
    expect(tail.filter((event) => event.kind === 'tool.use' && event.toolName === 'Read')).toHaveLength(PANEL_CHILD_UNITS);
    expect(tail.at(-1)).toMatchObject({ kind: 'permission.requested', toolName: 'Bash' });
    expect(events.some((event) => event.kind === 'permission.resolved')).toBe(false);
  });

  it('holds back exactly the tail below `first` and covers it with three batches', () => {
    const firstIndex = events.findIndex((event) => event.id.startsWith('panel-child:'));
    expect(events.slice(0, firstIndex).every((event) => (event.seq ?? 0) < PANEL_CHILD_TAIL.first)).toBe(true);
    expect(events[firstIndex].seq).toBe(PANEL_CHILD_TAIL.first);
    expect(PANEL_CHILD_TAIL.batches.reduce((sum, count) => sum + count, 0)).toBe(events.length - firstIndex);
  });

  it('records the child’s row counts the tail grows to, ending on one pending request', () => {
    expect({ first: measured.first, batches: measured.batches, rows: measured.rows }).toEqual({
      first: PANEL_CHILD_TAIL.first,
      batches: [...PANEL_CHILD_TAIL.batches],
      rows: [...PANEL_CHILD_TAIL.rows],
    });
    const [one, two, three] = measured.rows;
    expect(measured.before).toBeLessThan(one);
    expect(one).toBeLessThan(two);
    expect(two).toBeLessThan(three);
    expect(three - measured.before, 'two top-level rows per unit, at least').toBeGreaterThanOrEqual(2 * PANEL_CHILD_UNITS);
    expect(measured.pendingRequests).toBe(1);
  });
});
