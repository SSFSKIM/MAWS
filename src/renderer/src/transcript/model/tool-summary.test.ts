import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import type { JournalRow } from '@shared/wire/journal';
import { SessionEventSchema } from '@shared/graph/events';
import { journalToEvents } from '../dev/journal';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';

it('attaches the recorded late summary to its named tool, not to the final answer that precedes it', () => {
  const journal: JournalRow[] = readFileSync(resolve('spikes/protocol-probe/fixtures/p4/p4-ux1c-tool-use-summary.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const events = journalToEvents(journal);
  const summaries = events.filter((event) => (event.kind as string) === 'tool.summary');
  expect(summaries).toHaveLength(1);
  expect(SessionEventSchema.safeParse(summaries[0]).success).toBe(true);
  const rows = rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
  const cells = rows.flatMap((row) => row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []);
  expect(cells.find((cell) => cell.toolUseId === 'toolu_01DsKEEUbP7jApwdkNZxykf1')).toMatchObject({ summary: 'Read initialize.ts' });
  expect(rows.filter((row) => row.kind === 'assistant_text').some((row) => row.markdown === 'Read initialize.ts')).toBe(false);
});
