import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import type { JournalRow } from '@shared/wire/journal';
import { SessionEventSchema } from '@shared/graph/events';
import { journalToEvents } from '../dev/journal';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';

it('keeps the recorded late summary as an event without replacing the tool’s own facts or adding answer text', () => {
  const journal: JournalRow[] = readFileSync(resolve('spikes/protocol-probe/fixtures/p4/p4-ux1c-tool-use-summary.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const events = journalToEvents(journal);
  const summaries = events.filter((event) => (event.kind as string) === 'tool.summary');
  expect(summaries).toHaveLength(1);
  expect(SessionEventSchema.safeParse(summaries[0]).success).toBe(true);
  const rows = rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
  const cells = rows.flatMap((row) => row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []);
  const read = cells.find((cell) => cell.toolUseId === 'toolu_01DsKEEUbP7jApwdkNZxykf1');
  expect(read).toMatchObject({ label: 'Read initialize.ts', detail: { kind: 'read' } });
  expect(read).not.toHaveProperty('summary');
  expect(rows.filter((row) => row.kind === 'assistant_text').some((row) => row.markdown === 'Read initialize.ts')).toBe(false);
});
