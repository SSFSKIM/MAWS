import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../../../test/support/fake-client';
import { status } from '../../../../../../test/support/builders';
import { resetSurfaceRegistry } from '../../../engine-surface/registry';
import { useSessions } from '../../../stores/sessions';
import { useTranscriptStore } from '../../../stores/transcript';
import { Disclosures, NO_ACTIONS, TranscriptProvider } from '../context';
import { RowView } from './Row';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rowId } from '../../model/keys';
import { api, builder, uuid } from '../../model/test-events';
import { renderRow, rowOf, storeWith } from './test-support';

afterEach(() => { cleanup(); resetSurfaceRegistry(); });

const caret = (container: HTMLElement) => container.querySelector('[style*="--streamdown-caret"]') !== null;

function streaming() {
  const b = builder();
  b.turn('u1');
  const delta = (text: string) =>
    b.emit('assistant.block.delta', { apiMessageId: api('m1'), blockIndex: 0, blockType: 'text', textDelta: text, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
  return { b, delta };
}

describe('assistant text row', () => {
  it.each(['light', 'dark'])('renders commentary at the answer’s contrast and type scale in %s', async (theme) => {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(__dirname, '../../../styles/tokens.css'), 'utf8') + readFileSync(resolve(__dirname, '../transcript.css'), 'utf8');
    document.head.append(style);
    const previousTheme = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = theme;
    try {
      const b = builder();
      b.turn('u1');
      b.text('m1', 0, 'The edits are ready; running the suite.');
      const store = await storeWith(b.events);
      const row = rowOf(store.rows(), 'assistant_text');
      const view = renderRow({ ...row, phase: 'answer' }, { storeKey: store.key });
      const typography = () => {
        const css = getComputedStyle(view.container.querySelector('p')!);
        return { color: css.color, size: css.fontSize, weight: css.fontWeight, lineHeight: css.lineHeight };
      };
      const answer = typography();
      expect(answer.color).not.toBe('');
      view.rerenderRow({ ...row, phase: 'commentary' });
      expect(typography()).toEqual(answer);
    } finally {
      style.remove();
      if (previousTheme === undefined) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = previousTheme;
    }
  });

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
      expect(container.querySelector('[onerror]')).toBeNull();
      expect([...container.querySelectorAll('[href]')].some((a) => /^javascript:/i.test(a.getAttribute('href') ?? ''))).toBe(false);
      expect(container.textContent).toContain('go');
      expect(container.textContent).toContain('<img src="x" onerror="alert(2)">'); // shown as written, never parsed (W1)
    });
  });
});

it('keeps extension presentation when it rewrites the native text to empty', async () => {
  const b = builder(); b.turn('u'); b.text('answer', 0, 'Visible answer.'); b.end(['u']);
  const store = await storeWith(b.events);
  const id = store.key as AppSessionId;
  const fake = fakeClient(); window.maws = fake.client;
  useSessions.setState({ engine: new Map([[id, { ...status(id), uiSurface: { clientId: 'maws-main' } }]]) });
  function View() {
    const rows = useTranscriptStore((s) => s.entries[store.key].rows);
    return <TranscriptProvider value={{ storeKey: store.key, variant: 'session', actions: NO_ACTIONS, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 'd1' }}>
      {rows.map((row) => <RowView key={row.id} row={row} />)}
    </TranscriptProvider>;
  }
  const view = render(<View />);
  const asks = fake.invoked('session.ui.render') as { component: string; props: { text?: string } }[];
  expect(asks.filter((ask) => ask.component === 'AssistantMessage').map((ask) => ask.props.text)).toEqual(['Visible answer.']);
  for (const ask of asks) await act(() => fake.reply('session.ui.render', {
    hooked: ask.component === 'AssistantMessage', rewritten: ask.component === 'AssistantMessage', props: ask.component === 'AssistantMessage' ? { ...ask.props, text: '' } : ask.props,
    tree: ask.component === 'AssistantMessage' ? { type: 'Box', children: [{ type: 'Text', children: ['Extension supplied presentation'] }, { type: 'engine', ref: 0 }] } : { type: 'engine', ref: 0 },
  }));
  expect([...view.container.querySelectorAll('[data-kind="assistant_text"]')].map((frame) => frame.textContent)).toEqual(['Extension supplied presentation']);
  expect(view.container.querySelectorAll('.transcript-commentary, .transcript-answer')).toHaveLength(0);
});
