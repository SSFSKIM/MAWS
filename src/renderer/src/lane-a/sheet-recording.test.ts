// The question sheet's recorded session (test/fixtures/sheet-live/, from the live check of
// docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md M6): a real terminal session's transcript, as the
// engine wrote it while the sheet's steps ran, drawn through the session plane's fresh load (the rows desk-web and a
// remote lane A draw). From the transcript alone (S8): each call's head line and its lines, the receipts of the answers
// delivered by the plugin's prompt and by a prompt's added context, the withdrawn question, and the three answers of one
// Send arriving together.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonObject } from 'desk-hub/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../stores/transcript';
import { sheetHead } from '../transcript/model/copy';
import type { Row } from '../transcript/model/rows';
import { freshSource, subagentLookupOf } from './plane-transcript';

type SheetRowData = Extract<Row, { kind: 'sheet' }>;
const rows = readFileSync(join(__dirname, '../../../../test/fixtures/sheet-live/session.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => JSON.parse(line) as JsonObject);
const session = String(rows.find((row) => typeof row.sessionId === 'string')!.sessionId);

let drawn: Row[] = [];
beforeAll(async () => {
  const store = createTranscriptStore();
  await store.getState().attach('recording', freshSource(rows, session, subagentLookupOf([])), { agentId: null });
  drawn = store.getState().entries.recording!.rows;
});
const sheets = () => drawn.filter((row): row is SheetRowData => row.kind === 'sheet');
const lines = (row: SheetRowData) => row.lines.map((line) => [line.id, line.header, line.outcome === null ? null : line.outcome.how === 'answered' ? `→ ${line.outcome.receipt}` : line.outcome.how]);

describe('a recorded terminal session that asked on its sheet and was answered in MAWS', () => {
  it('draws each call of the tool as its head line: three asked, two asked, one withdrawn, one asked', () => {
    expect(sheets().map(sheetHead)).toEqual(['Asked 3 questions', 'Asked 2 questions', 'Withdrew q4', 'Asked a question']);
  });

  it('reads every delivered answer’s receipt and the withdrawal from the transcript alone, no record read', () => {
    const [three, two, withdrawal, one] = sheets();
    expect(lines(three!)).toEqual([
      ['q1', 'Untracked files', '→ Commit them to main'],
      ['q2', 'README content', '→ Keep the README as it is.'],
      ['q3', 'Workspace context', '→ Start with the North Quay route.'],
    ]);
    // q5 was answered while the session was stopped and went with the next prompt, in its added context
    expect(lines(two!)).toEqual([['q4', 'Beta scope', 'withdrawn'], ['q5', 'Target branch', '→ New beta branch']]);
    expect(withdrawal!).toMatchObject({ lines: [], withdrew: ['q4'] });
    expect(lines(one!)).toEqual([['q6', 'Question', '→ Option A']]);
  });

  it('draws each delivery as one notice: the three answers of one Send together, the stopped session’s with its next prompt, and the answer the second window lost to the first', () => {
    const notices = drawn.flatMap((row) => (row.kind === 'notice' && row.class === 'answer' ? [row.text] : []));
    expect(notices).toEqual(['answered: q1, q2, q3', 'answered: q5', 'answered: q6']);
  });
});
