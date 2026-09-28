import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { rowId } from '../../model/keys';
import { api, builder, uuid } from '../../model/test-events';
import { renderRow, rowOf, storeWith } from './test-support';

afterEach(cleanup);

const caret = (container: HTMLElement) => container.querySelector('[style*="--streamdown-caret"]') !== null;

function streaming() {
  const b = builder();
  b.turn('u1');
  const delta = (text: string) =>
    b.emit('assistant.block.delta', { apiMessageId: api('m1'), blockIndex: 0, blockType: 'text', textDelta: text, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
  return { b, delta };
}

describe('assistant text row', () => {
  it('streams from the live buffer with a caret, then renders the completed block without one under the same key', async () => {
    const { b, delta } = streaming();
    delta('Hello');
    const store = await storeWith(b.events);
    const live = rowOf(store.rows(), 'assistant_text');
    expect(live.id).toBe(rowId.text(api('m1'), 0));
    expect(live.live).toBe(true);
    const view = renderRow(live, { storeKey: store.key });
    expect(view.container.textContent).toContain('Hello');
    expect(caret(view.container)).toBe(true);

    act(() => store.push([delta(' world')]));
    expect(view.container.textContent).toContain('Hello world'); // the buffer, not a re-derived row
    expect(rowOf(store.rows(), 'assistant_text')).toBe(live);

    b.text('m1', 0, 'Hello world, done.');
    act(() => store.push([b.events.at(-1)!]));
    const done = rowOf(store.rows(), 'assistant_text');
    expect(done.id).toBe(live.id); // the virtualiser's key (getItemKey is the row id) survives completion
    expect(done.live).toBe(false);
    expect(done.messageUuid).toBe(uuid('m1-u0'));
    view.rerenderRow(done);
    expect(view.container.textContent).toContain('Hello world, done.');
    expect(caret(view.container)).toBe(false);
  });

  describe.each([true, false])('hostile markdown (live: %s)', (live) => {
    it('leaves no script, no img from raw HTML and no javascript: href', async () => {
      const hostile = 'Hi <script>alert(1)</script> <img src="x" onerror="alert(2)"> [go](javascript:alert(3))';
      const { b, delta } = streaming();
      if (live) delta(hostile);
      else b.text('m1', 0, hostile);
      const store = await storeWith(b.events);
      const row = rowOf(store.rows(), 'assistant_text');
      expect(row.live).toBe(live);
      const { container } = renderRow(row, { storeKey: store.key });
      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('img')).toBeNull();
      expect(container.innerHTML).not.toMatch(/onerror|javascript:/);
      expect(container.textContent).toContain('go');
    });
  });
});
