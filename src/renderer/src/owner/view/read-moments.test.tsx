// @vitest-environment happy-dom
// When a mounted view starts a round of reads of the mod's summaries (UX wave U2b; the execution document, §M, "The
// reads"; M7's review, finding 1): at each close of a stretch and each end of a turn, told by their own identities (a
// stretch newly closed, by its key; a turn newly ended, by its id), so a batch that brings several of them, or one
// that ends a turn and starts the next, still starts a round. Several in one batch start one round. Every text is
// invented.
import type { SessionEvent } from '@shared/graph/events';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { at } from '../../../../../test/support/machine';
import { resetSurfaceRegistry } from '../../engine-surface/registry';
import { useSessions } from '../../stores/sessions';
import { BASH_RESULT, builder, uuid } from '../../transcript/model/test-events';
import type { TranscriptSource } from '../../transcript/source/types';
import { Transcript } from '../../transcript/view/Transcript';

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
beforeAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true; // the pushes are wrapped in act()
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-transcript-scroller')) return 4000;
      if (this.hasAttribute('data-index')) return 40;
      return 0;
    },
  });
});
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
  environment.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
});
afterEach(() => {
  cleanup();
  resetSurfaceRegistry();
  useSessions.setState({ engine: new Map() });
});

let keys = 0;
function sourceOf(events: SessionEvent[]) {
  let listener: ((batch: SessionEvent[]) => void) | null = null;
  const source: TranscriptSource = {
    key: at(`read-moments-${++keys}`),
    subscribe(l) {
      listener = l;
      return () => (listener = null);
    },
    snapshot: () => Promise.resolve(events),
  };
  return { source, push: (batch: SessionEvent[]) => act(() => listener?.(batch)) };
}

const call = (b: ReturnType<typeof builder>, id: string, description: string) => {
  b.toolUse(id, 'Bash', { command: 'true', description });
  b.result(id, 'ok', { structured: BASH_RESULT('ok') });
};

/**
 * A closed turn with its message (so the view is in force), then a turn still running: a call, then (by default) a
 * message, so its stretch has closed; then whatever `next` adds, pushed as one batch once the view is drawn.
 */
async function mounted(
  next: (b: ReturnType<typeof builder>) => void,
  opening: (b: ReturnType<typeof builder>) => void = (b) => b.text('ma', 0, '<message>Read the first notes.</message>'),
  { firstCall = true }: { firstCall?: boolean } = {},
) {
  const b = builder();
  b.turn('u0', 'Find the notes');
  call(b, 't0', 'Find the notes');
  b.text('m0', 0, '<message>Found the notes.</message>');
  b.end(['u0']);
  b.turn('u1', 'Tidy the notes');
  if (firstCall) call(b, 'ta', 'Read the first notes');
  opening(b);
  const history = [...b.events];
  next(b);
  const batch = b.events.slice(history.length);
  const { source, push } = sourceOf(history);
  const moved = vi.fn();
  render(<Transcript source={source} variant="session" ownerLane summaries={{ stored: [], moved }} />);
  await waitFor(() => expect(screen.queryAllByRole('button', { name: /^› / }).length).toBeGreaterThan(0));
  const before = moved.mock.calls.length;
  await push(batch);
  return () => moved.mock.calls.length - before;
}

describe('a round of reads at each close of a stretch and each end of a turn, in a mounted view', () => {
  it('a batch that closes a second stretch while the first stays closed and the turn runs on starts a round', async () => {
    const rounds = await mounted((b) => {
      call(b, 'tb', 'Read the second notes');
      b.text('mb', 0, '<message>Read the second notes.</message>');
    });
    expect(rounds()).toBe(1);
  });

  it('a batch that ends the turn and starts the next starts a round', async () => {
    const rounds = await mounted((b) => {
      b.end(['u1']);
      b.turn('u2', 'And the rest?');
      call(b, 'tc', 'Read the rest');
    });
    expect(rounds()).toBe(1);
  });

  it('a batch that closes a stretch alone starts one round', async () => {
    const rounds = await mounted(
      (b) => b.text('ma', 0, '<message>Read the first notes.</message>'),
      () => {},
    );
    expect(rounds()).toBe(1);
  });

  it('a batch that ends the turn alone starts one round', async () => {
    const rounds = await mounted((b) => b.end(['u1']));
    expect(rounds()).toBe(1);
  });

  it('a turn of text alone, which draws no turn line, starts a round when it ends', async () => {
    const rounds = await mounted((b) => b.end(['u1']), (b) => b.text('na', 0, 'Checking the notes first.'), { firstCall: false });
    expect(rounds()).toBe(1);
  });

  it('a batch that closes a stretch and ends the turn starts one round', async () => {
    const rounds = await mounted(
      (b) => {
        b.text('ma', 0, '<message>Read the first notes.</message>');
        b.end(['u1']);
      },
      () => {},
    );
    expect(rounds()).toBe(1);
  });

  // A prompt written while a turn runs: its own turn, open and not yet started (accepted), until its `turn.started`.
  const queue = (b: ReturnType<typeof builder>, u: string, text: string) =>
    b.emit('user.message', { messageUuid: uuid(u), content: text, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
  const start = (b: ReturnType<typeof builder>, u: string) => b.emit('turn.started', { userMessageUuid: uuid(u), origin: 'human' });

  /** The closed turn and the running one with its closed stretch, as `mounted` draws them; then batches, each counted. */
  async function sequence(atRest = false) {
    const b = builder();
    b.turn('u0', 'Find the notes');
    call(b, 't0', 'Find the notes');
    b.text('m0', 0, '<message>Found the notes.</message>');
    b.end(['u0']);
    b.turn('u1', 'Tidy the notes');
    call(b, 'ta', 'Read the first notes');
    b.text('ma', 0, '<message>Read the first notes.</message>');
    const { source, push } = sourceOf([...b.events]);
    const moved = vi.fn();
    const view = render(<Transcript source={source} variant="session" ownerLane atRest={atRest} summaries={{ stored: [], moved }} />);
    await waitFor(() => expect(screen.queryAllByRole('button', { name: /^› / }).length).toBeGreaterThan(0));
    const rounds = async (step: () => void | Promise<void>) => {
      const before = moved.mock.calls.length;
      await step();
      return moved.mock.calls.length - before;
    };
    const batch = (add: (b: ReturnType<typeof builder>) => void) => async () => {
      const from = b.events.length;
      add(b);
      await push(b.events.slice(from));
    };
    const rest = (resting: boolean) => () => view.rerender(<Transcript source={source} variant="session" ownerLane atRest={resting} summaries={{ stored: [], moved }} />);
    return { rounds, batch, rest };
  }

  it('a prompt queued while a turn runs has not ended when that turn ends: one round at each turn’s end', async () => {
    const { rounds, batch } = await sequence();
    expect(await rounds(batch((b) => queue(b, 'u2', 'Then the rest')))).toBe(0);
    expect(await rounds(batch((b) => b.end(['u1'])))).toBe(1);
    expect(await rounds(batch((b) => start(b, 'u2')))).toBe(0);
    expect(
      await rounds(
        batch((b) => {
          call(b, 'tb', 'Read the rest');
          b.text('mb', 0, '<message>Read the rest.</message>');
        }),
      ),
    ).toBe(1); // its stretch closed
    expect(await rounds(batch((b) => b.end(['u2'])))).toBe(1);
  });

  it('a session at rest whose started turn the store holds open: that turn’s end is one round; a queued prompt is not ended by it', async () => {
    const { rounds, batch, rest } = await sequence();
    await batch((b) => queue(b, 'u2', 'Then the rest'))();
    expect(await rounds(rest(true))).toBe(1);
    expect(await rounds(rest(false))).toBe(0);
    await batch((b) => {
      b.end(['u1']);
      start(b, 'u2');
    })();
    expect(await rounds(batch((b) => b.end(['u2'])))).toBe(1);
  });
});
