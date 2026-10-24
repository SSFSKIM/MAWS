// @vitest-environment happy-dom
import { parse } from '@shared/owner/to-human-parser';
import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { liveMarkedRowIds, reportRows } from '../../../../../src/renderer/src/owner/report/project';
import { liveBuffer, useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { api, builder } from '../../../../../src/renderer/src/transcript/model/test-events';
import { renderRow, rowOf, storeWith } from '../../../../../src/renderer/src/transcript/view/rows/test-support';
import type { StreamBlock } from '../stream/layer';
import { latestTurn, streamingRows } from './streaming-rows';

const storeKeys: string[] = [];
afterEach(() => {
  cleanup();
  for (const key of storeKeys.splice(0)) useTranscriptStore.getState().drop(key);
});

const block = (index: number, kind: StreamBlock['kind'], text: string): StreamBlock => ({ turnId: 't1', agentId: null, step: 0, index, kind, text, toolName: null, toolUseId: null, settledBy: null });
const call = (index: number, name: string, input: string, id = `toolu_${index}`): StreamBlock => ({ ...block(index, 'tool', input), toolName: name, toolUseId: id });
const since = () => '2026-10-15T00:00:00.000Z';

describe('the streaming rows', () => {
  it('draws a live answer as its text, live thinking as its label alone, and no tool input', () => {
    const rows = streamingRows([block(0, 'thinking', 'Weigh it.'), block(1, 'text', 'Two.'), block(2, 'tool', '{"a":1}'), call(3, 'Bash', '{"command": "ls')], since);
    expect(rows.map((row) => [row.kind, row.kind === 'thinking' ? row.text : row.kind === 'assistant_text' ? row.markdown : null])).toEqual([
      ['thinking', ''],
      ['assistant_text', 'Two.'],
    ]);
    expect(rows[0]).toMatchObject({ live: true });
  });

  it.each([
    ['open message', 'Checked both.\n\n<message>\nBoth subagents rep'],
    ['open to-human alias', '<to-human>the next'],
    ['open essential alias', '<essential>Merged'],
    ['open need-input alias', '<need-input>Which file?'],
    ['open insight alias', '<insight>The reason'],
    ['partial opening tag', 'Nearly there. <mess'],
    ['partial closing tag', '<message>Both.</mes'],
    ['closed mark before an unfinished alias', '<essential>Merged.</essential> Then <to-human>the next'],
    ['closed message', '<message>Done.</message>'],
    ['tags quoted in fenced and inline code', 'The mark is:\n\n```\n<message>quoted</message>\n```\n\nand `<message>` too.'],
    ['unfinished fence inside an open mark', '<message>\nRun this:\n\n```sh\necho <message>'],
    ['last-line closed fence inside an open mark', '<message>\nRun this:\n\n```sh\necho hi\n```'],
    ['inline code at the end of an open mark', '<message>Use ```x``` here'],
    ['plain text and unrelated tags', 'Plain words <b>and a tag</b>.'],
  ] as const)('preserves exact authored live text for %s (UX1-C)', (_name, text) => {
    const [row] = streamingRows([block(0, 'text', text)], since, { turn: 'turn-9' as never });
    expect(row).toMatchObject({ kind: 'assistant_text', markdown: text, turnId: 'turn-9', live: true });
  });

  it('leaves unfinished marks literal and closed marks recognizable by the shared Presenter', () => {
    const unfinished = '<message>\nBoth subagents rep';
    const [open, closed] = streamingRows([block(0, 'text', unfinished), block(1, 'text', '<message>Done.</message>')], since);
    expect(open.kind === 'assistant_text' && parse(open.markdown)).toEqual([{ kind: 'plain', text: unfinished }]);
    expect(closed.kind === 'assistant_text' && parse(closed.markdown)).toEqual([{ kind: 'to-human', text: 'Done.' }]);
    expect(closed).toMatchObject({ live: true }); // no report turn: keep the transcript's live row
  });

  describe.each(['report', 'transcript'] as const)('native live-row parity in the %s', (mode) => {
    it.each([
      ['unfinished', '<message>\nBoth subagents rep', false],
      ['closed', '<message>\nReady.\n\n- **notes.md:** checked.\n- **words.txt:** checked.\n</message>', true],
    ] as const)('renders %s authored text unchanged, with the same ink and open-mark fold', async (_name, text, closed) => {
      const b = builder();
      b.turn('u1');
      b.toolUse('t1', 'Bash', { command: 'ls' });
      b.result('t1', 'notes.md words.txt');
      b.emit('assistant.block.delta', { apiMessageId: api('m1'), blockIndex: 0, blockType: 'text', textDelta: text, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
      const store = await storeWith(b.events);
      storeKeys.push(store.key);
      useTranscriptStore.getState().setOwnerLane(store.key, true);
      useTranscriptStore.getState().setView(store.key, mode);
      const entry = useTranscriptStore.getState().entries[store.key];
      const native = rowOf(entry.rows, 'assistant_text');
      expect(native.markdown).toBe(text); // the first delta is copied verbatim into the derived row
      expect(liveBuffer(entry, native)).toBe(text);
      const desk = rowOf(streamingRows([block(0, 'text', text)], since, { turn: latestTurn(entry.rows) }), 'assistant_text');
      expect(desk.markdown).toBe(text);
      expect(desk.live).toBe(native.live);

      const visible = (rows: typeof entry.rows) => mode === 'report' ? reportRows(rows, entry.state, entry.state.ui, liveMarkedRowIds(entry.state)) : rows;
      const nativeRows = visible(entry.rows);
      const deskRows = visible([...entry.rows.filter((row) => row.id !== native.id), desk]);
      expect(deskRows.map((row) => row.kind)).toEqual(nativeRows.map((row) => row.kind));
      expect(deskRows).toContain(desk);
      expect(nativeRows).toContain(native);
      if (mode === 'report') {
        expect(nativeRows.find((row) => row.kind === 'owner_record')).toMatchObject({ open: false, working: true });
        expect(deskRows.find((row) => row.kind === 'owner_record')).toMatchObject({ open: false, working: true });
      } else {
        expect(deskRows.some((row) => row.kind === 'owner_record')).toBe(false);
      }

      const nativeView = renderRow(native, { storeKey: store.key });
      const deskView = renderRow(desk, { storeKey: store.key });
      expect(deskView.container.textContent).toBe(nativeView.container.textContent);
      for (const { container } of [nativeView, deskView]) {
        expect(container.querySelector('.owner-message-ink') !== null).toBe(closed);
        if (closed) {
          expect(container.textContent).not.toContain('<message>');
          expect([...container.querySelectorAll('li')].map((node) => node.textContent?.trim())).toEqual(['notes.md: checked.', 'words.txt: checked.']);
          expect([...container.querySelectorAll('[data-streamdown="strong"]')].map((node) => node.textContent)).toEqual(['notes.md:', 'words.txt:']);
        } else {
          expect(container.textContent).toBe('<message>\nBoth subagents rep');
        }
      }
    });
  });

  it('uses the current native live buffer for folding, never a stale marked row snapshot', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    const delta = (text: string) => b.emit('assistant.block.delta', { apiMessageId: api('m1'), blockIndex: 0, blockType: 'text', textDelta: text, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
    delta('<message>Open');
    const store = await storeWith(b.events);
    storeKeys.push(store.key);
    const before = useTranscriptStore.getState().entries[store.key];
    const native = rowOf(before.rows, 'assistant_text');
    expect(reportRows(before.rows, before.state, before.state.ui, liveMarkedRowIds(before.state)).some((row) => row.kind === 'owner_record')).toBe(true);

    act(() => store.push([delta('</insight>')])); // a crossing tag invalidates the open mark
    const after = useTranscriptStore.getState().entries[store.key];
    expect(rowOf(after.rows, 'assistant_text')).toBe(native);
    expect(native.markdown).toBe('<message>Open');
    expect(liveBuffer(after, native)).toBe('<message>Open</insight>');
    expect(liveMarkedRowIds(after.state)).toBe('');
    expect(reportRows(after.rows, after.state, after.state.ui, liveMarkedRowIds(after.state)).some((row) => row.kind === 'owner_record')).toBe(false);
    expect(renderRow(native, { storeKey: store.key }).container.textContent).toBe('<message>Open</insight>');
  });

  it("draws a message tool's call, MAWS's or the to-human plugin's, as the message MAWS draws for it, its text as far as it has come", () => {
    const rows = streamingRows([call(0, 'mcp__maws__message', '{"text": "Stage 1 is done.\\nStage 2 st'), call(1, 'mcp__to-human__message', '{"text": "Both'), call(2, 'mcp__to-human__message', '{"te')], since, { turn: 'turn-9' as never });
    expect(rows).toEqual([
      { id: 'desk-stream:t1:main:0:0', turnId: 'turn-9', at: since(), kind: 'to_human', toolUseId: 'toolu_0', text: 'Stage 1 is done.\nStage 2 st', pending: true },
      { id: 'desk-stream:t1:main:0:1', turnId: 'turn-9', at: since(), kind: 'to_human', toolUseId: 'toolu_1', text: 'Both', pending: true },
    ]); // the third has no text yet
  });
});
