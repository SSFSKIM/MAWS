// @vitest-environment happy-dom
// A reply an interrupt cut off, as drawn (P5 O9, the M10 sitting): muted under the note that the session didn't keep it,
// and, when the sminos bridge kept only a block's tail (1.27.16), saying it starts partway through.
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { Row, RowId } from '../../transcript/model/rows';
import { CUT_NOTE, CutTextRow, PARTWAY_NOTE } from '../../transcript/view/rows/AssistantText';

afterEach(cleanup);

const row = (partway: boolean): Extract<Row, { kind: 'assistant_text' }> => ({
  id: 'cut:e1' as RowId, turnId: null, at: '2026-10-29T18:00:00.000Z', kind: 'assistant_text', messageUuid: null, blockIndex: 0, markdown: '7, 8, 9', live: false, phase: 'commentary', model: null, cut: true, ...(partway && { partway: true as const }),
});

it('draws the cut-off text under its note; the tail-only one says it starts partway through, its text after an ellipsis', () => {
  const whole = render(<CutTextRow row={row(false)} />).container;
  expect(whole.querySelector('.transcript-cut-note')?.textContent).toBe(CUT_NOTE);
  expect(whole.querySelector('[data-cut]')?.textContent).toContain('7, 8, 9');
  expect(whole.querySelector('[data-partway]')).toBeNull();
  cleanup();
  const tail = render(<CutTextRow row={row(true)} />).container;
  expect(tail.querySelector('.transcript-cut-note')?.textContent).toBe(`${CUT_NOTE}. ${PARTWAY_NOTE}`);
  expect(tail.querySelector('[data-partway]')?.textContent).toContain('…7, 8, 9');
});
