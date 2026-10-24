import type { SessionEvent } from '@shared/graph/events';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useTranscriptStore } from '../../stores/transcript';
import { rowId, turnId } from '../../transcript/model/keys';
import type { Row } from '../../transcript/model/rows';
import { BASH_RESULT, builder, tool, uuid } from '../../transcript/model/test-events';
import type { TranscriptSource } from '../../transcript/source/types';
import { Disclosures, NO_ACTIONS, TranscriptProvider, type TranscriptContextValue } from '../../transcript/view/context';
import { Transcript } from '../../transcript/view/Transcript';
import { ToHumanMessageRow } from './MessageRow';

const KEY = 'app-message';
const ROW: Extract<Row, { kind: 'to_human' }> = {
  id: rowId.toHuman(tool('c1')), turnId: turnId.ofMessage(uuid('u1')), at: '2026-10-20T10:00:00.000Z', kind: 'to_human', toolUseId: tool('c1'), text: 'Stage 1 is done: **37** labels missing.', pending: false,
};

afterEach(() => {
  cleanup();
  useTranscriptStore.setState({ entries: {} });
});

function draw(context: Partial<TranscriptContextValue>, lanes: Record<string, boolean>) {
  useTranscriptStore.setState({ entries: Object.fromEntries(Object.entries(lanes).map(([key, ownerLane]) => [key, { state: { ui: { ownerLane } } }])) as never });
  const value: TranscriptContextValue = { storeKey: KEY, variant: 'session', actions: NO_ACTIONS, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 't', ...context };
  return render(<TranscriptProvider value={value}><ToHumanMessageRow row={ROW} /></TranscriptProvider>).container;
}
describe('ToHumanMessageRow', () => {
  it.each([true, false])('draws unboxed message ink with the lane %s, preserving Markdown and call identity', (lane) => {
    const container = draw({}, { [KEY]: lane });
    expect(container.textContent).toBe('Stage 1 is done: 37 labels missing.');
    expect(container.querySelector('.owner-message-ink [data-streamdown="strong"]')?.textContent).toBe('37');
    expect(container.querySelector('[data-to-human-call]')?.getAttribute('data-to-human-call')).toBe('c1');
    expect(container.querySelector('[data-owner-card], [data-owner-report]')).toBeNull();
  });

  it.each([{ presentation: 'local' }, { variant: 'child' }, { storeKey: '' }] as const)('uses the same unboxed fallback for %j', (context) => {
    const container = draw(context, { [KEY]: true });
    expect(container.querySelector('.owner-message-ink')?.textContent).toBe('Stage 1 is done: 37 labels missing.');
    expect(container.querySelector('[data-owner-card], [data-owner-report]')).toBeNull();
  });
});

// The row through a mounted transcript, as the session view draws it (the report-view suite's mount).
describe('a message tool’s call in a mounted transcript', () => {
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (this.hasAttribute('data-transcript-scroller')) return 4000;
        if (this.hasAttribute('data-index')) return 40;
        return 0;
      },
    });
  });
  afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

  let keys = 0;
  async function mounted(events: SessionEvent[], ownerLane: boolean) {
    const source: TranscriptSource = { key: `message-row-${++keys}`, subscribe: () => () => {}, snapshot: () => Promise.resolve(events) };
    render(<Transcript source={source} variant="session" ownerLane={ownerLane} />);
    await waitFor(() => expect(useTranscriptStore.getState().entries[source.key!]?.phase).toBe('live'));
    await act(() => Promise.resolve());
  }
  function turn() {
    const b = builder();
    b.turn('u1', 'Run the stages');
    b.toolUse('c1', 'mcp__maws__message', { text: 'Stage 1 is done.' }, 'm1', 0);
    b.result('c1', [{ type: 'text', text: 'sent' }]);
    b.toolUse('t1', 'Bash', { command: 'sh stage.sh 2' }, 'm1', 1);
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.text('m2', 0, '<message>Both stages ran.</message>');
    b.end(['u1']);
    return b.events;
  }

  it('the report draws unboxed message ink at level 0, and down to the work rows never as an MCP row', async () => {
    await mounted(turn(), true);
    const cards = () => [...document.querySelectorAll('[data-kind="to_human"] .owner-message-ink')].map((element) => element.textContent);
    const record = () => screen.getByRole('button', { name: /^(Working record|Fold to report)/ });
    await waitFor(() => expect(cards()).toEqual(['Stage 1 is done.']));
    expect(record().textContent).toBe('Working record · 1 tool call'); // the call is the message, not one of the calls
    // level 1, then level 2: the command's cell appears; the call never becomes one
    fireEvent.click(record());
    await waitFor(() => expect(record().textContent).toBe('Fold to report'));
    fireEvent.click(document.querySelector('[data-kind="divider"] .transcript-divider > .transcript-disclosure')!);
    await waitFor(() => expect([...document.querySelectorAll('[data-kind="cell"]')].map((element) => element.id.replace(/^.*-cell:/, ''))).toEqual(['t1']));
    expect(cards()).toEqual(['Stage 1 is done.']);
  });

  it('with the lane off, the message stays in view as a span with its turn folded, as the `<message>` span after it does', async () => {
    await mounted(turn(), false);
    const spans = () => [...document.querySelectorAll('.owner-message-ink')].map((element) => element.textContent);
    await waitFor(() => expect(spans()).toEqual(['Stage 1 is done.', 'Both stages ran.']));
    expect(document.querySelectorAll('[data-kind="cell"]')).toHaveLength(0); // the work folded: the command's cell is out of view
    expect(document.querySelector('[data-owner-card]')).toBeNull();
  });
});
