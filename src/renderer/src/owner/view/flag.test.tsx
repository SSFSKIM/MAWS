// @vitest-environment happy-dom
// The flag (UX wave U2b; the execution document, M1's "The flag", ruling R5): the to-human view is in force once the
// session holds a message, wherever that message is: in the store's events, in a streaming block of the store, or in
// rows the mount hands the transcript from outside the store (lane A's streamed reply here; the desk's in its own
// `TranscriptPane.test.tsx`). Each route stages the same scene: the only mark is in the stream, an earlier turn is
// closed, and opening that turn's record at once shows its work, so no pass drew rows a closed turn withheld; then the
// stream resets, or an interrupt cuts the reply, and the turn fold is back. Every text is invented.
import type { SessionEvent } from '@shared/graph/events';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { at } from '../../../../../test/support/machine';
import { resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { api, BASH_RESULT, builder } from '../../transcript/model/test-events';
import type { Row } from '../../transcript/model/rows';
import type { TranscriptSource } from '../../transcript/source/types';
import { Transcript } from '../../transcript/view/Transcript';
import type { StreamBlock } from '../../lane-a/stream/layer';
import { latestTurn, streamingRows } from '../../lane-a/view/streaming-rows';

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
afterEach(() => {
  cleanup();
  resetSurfaceRegistry();
  useSessions.setState({ engine: new Map() });
});

const WORK = 'Listed the notes first.'; // the closed turn's commentary: its work, which the turn fold withholds
const STREAMED = '<message>Starting the second part';

/** A closed turn of work (commentary, a command, an answer), then a turn still running a command: no message yet. */
function history() {
  const b = builder();
  b.turn('u1', 'Tidy the notes');
  b.text('m1', 0, WORK);
  b.toolUse('t1', 'Bash', { command: 'ls notes' });
  b.result('t1', 'notes.md', { structured: BASH_RESULT('notes.md') });
  b.text('m2', 0, 'The notes are tidy.');
  b.end(['u1']);
  b.turn('u2', 'And the rest?');
  b.toolUse('t2', 'Bash', { command: 'ls rest' });
  b.result('t2', 'rest.md', { structured: BASH_RESULT('rest.md') });
  return b;
}

let keys = 0;
function sourceOf(events: () => SessionEvent[]) {
  let listener: ((batch: SessionEvent[]) => void) | null = null;
  let reset: (() => void) | null = null;
  const source: TranscriptSource = {
    key: at(`flag-${++keys}`),
    subscribe(l) {
      listener = l;
      return () => (listener = null);
    },
    snapshot: () => Promise.resolve(events()),
    onReset(l) {
      reset = l;
      return () => (reset = null);
    },
  };
  return { source, push: (batch: SessionEvent[]) => act(() => listener?.(batch)), reset: () => act(() => reset?.()) };
}

const recordLines = () => screen.queryAllByRole('button', { name: '› working record' });
const foldingTurnLines = () => [...document.querySelectorAll('[data-kind="divider"] .transcript-divider > .transcript-disclosure')] as HTMLElement[];

/** The scene's first half on any route: the first record opens at once onto the closed turn's work. */
async function opensTheClosedTurnsWork() {
  await waitFor(() => expect(recordLines().length).toBeGreaterThan(0));
  expect(screen.queryByText(WORK)).toBeNull();
  expect(foldingTurnLines()).toEqual([]); // no turn folds while the view is in force
  fireEvent.click(recordLines()[0]);
  await waitFor(() => expect(screen.getByText(WORK)).toBeTruthy());
  expect(screen.getByRole('button', { name: '‹ fold to report' })).toBeTruthy();
}

/** Its second half: no message anywhere any more, so the plain transcript with MAWS's turn fold is back. */
async function theTurnFoldIsBack() {
  await waitFor(() => expect(recordLines()).toEqual([]));
  expect(screen.queryByRole('button', { name: '‹ fold to report' })).toBeNull();
  await waitFor(() => expect(foldingTurnLines().map((line) => line.getAttribute('aria-expanded'))).toContain('false'));
  expect(screen.queryByText(WORK)).toBeNull(); // the closed turn folded again
}

describe('the first streamed mark puts the view in force on every route, and its end takes it out', () => {
  describe("the store's own live block", () => {
    const delta = (b: ReturnType<typeof builder>, text: string) =>
      b.emit('assistant.block.delta', { apiMessageId: api('m3'), blockIndex: 0, blockType: 'text', textDelta: text, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });

    it('a reset: the snapshot holds the stream, then the source starts over without it', async () => {
      const b = history();
      const plain = [...b.events];
      delta(b, STREAMED);
      let events = b.events;
      const { source, reset } = sourceOf(() => events);
      render(<Transcript source={source} variant="session" ownerLane />);
      await opensTheClosedTurnsWork();
      events = plain;
      reset();
      await theTurnFoldIsBack();
    });

    it('an interruption: the turn ends with its reply cut inside the open mark', async () => {
      const b = history();
      delta(b, STREAMED);
      const { source, push } = sourceOf(() => b.events);
      render(<Transcript source={source} variant="session" ownerLane />);
      await opensTheClosedTurnsWork();
      const before = b.events.length;
      b.end(['u2'], { terminalReason: 'aborted_streaming' });
      push(b.events.slice(before));
      await theTurnFoldIsBack();
    });
  });

  describe("lane A's streamed tail", () => {
    const block = (text: string): StreamBlock => ({ turnId: 'bridge-turn', agentId: null, step: 2, index: 0, kind: 'text', text, toolName: null, toolUseId: null, settledBy: null });
    const since = () => '2026-09-28T10:00:30.000Z';

    async function mounted() {
      const { source } = sourceOf(() => history().events);
      const tail = (blocks: StreamBlock[], kept = false): Row[] => {
        const rows = useTranscriptStore.getState().entries[source.key!]?.rows ?? [];
        return streamingRows(blocks, since, { turn: latestTurn(rows), kept });
      };
      const view = render(<Transcript source={source} variant="session" ownerLane />);
      await waitFor(() => expect(useTranscriptStore.getState().entries[source.key!]?.phase).toBe('live'));
      const draw = (rows: Row[]) => view.rerender(<Transcript source={source} variant="session" ownerLane tail={rows} />);
      return { tail, draw };
    }

    it('a reset: the stream starts over with nothing in it', async () => {
      const { tail, draw } = await mounted();
      draw(tail([block(STREAMED)]));
      await opensTheClosedTurnsWork();
      draw(tail([]));
      await theTurnFoldIsBack();
    });

    it('an interruption: the reply is cut inside the open mark, and the session kept none of it', async () => {
      const { tail, draw } = await mounted();
      draw(tail([block(STREAMED)]));
      await opensTheClosedTurnsWork();
      draw(tail([block(STREAMED)], true));
      await theTurnFoldIsBack();
    });
  });
});
