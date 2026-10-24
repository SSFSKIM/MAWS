import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, EventId } from '@shared/graph/ids';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { useTranscriptStore } from '../../stores/transcript';
import { afterAccepted } from '../../composer/editor/submit';
import { fakeClient } from '../../../../../test/support/fake-client';
import type { Serialized } from '../../composer/editor/serialize';
import { cellId, rowId, turnId } from '../model/keys';
import { loadJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { BASH_RESULT, builder, request, tool, uuid } from '../model/test-events';
import type { TranscriptSource } from '../source/types';
import { Transcript } from './Transcript';
import { markTranscriptCarry, recordTranscriptScroll, scrollSignature, takeTranscriptCarry } from './scroll-carry'; // P4-B3

// happy-dom has no layout: give the scroller a viewport and every row a height so the virtualiser mounts rows.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-transcript-scroller')) return 2000;
      if (this.hasAttribute('data-index')) return 40;
      return 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));
afterEach(cleanup);

let keys = 0;
const sourceOf = (events: SessionEvent[]): TranscriptSource => ({
  key: `transcript-test-${++keys}`,
  subscribe: () => () => {},
  snapshot: () => Promise.resolve(events),
});

// A closed turn whose single, denied Bash call is a standalone cell, and a second turn with an answer.
function deniedThenAnswer() {
  const b = builder();
  b.turn('u1');
  b.toolUse('t1', 'Bash', { command: 'rm -rf x' }, 'm1', 0);
  b.result('t1', 'Probe denial', { isError: true, denial: 'permission-rule' });
  b.text('m2', 0, 'Denied. Stopping.');
  b.end(['u1']);
  b.turn('u2');
  b.toolUse('t2', 'Bash', { command: 'ls' }, 'm3', 0);
  b.result('t2', 'a', { structured: BASH_RESULT('a') });
  b.text('m4', 0, 'Done.');
  b.end(['u2']);
  return b.events;
}

async function mounted(events: SessionEvent[]) {
  const source = sourceOf(events);
  render(<Transcript source={source} variant="session" />);
  await waitFor(() => expect(useTranscriptStore.getState().entries[source.key!]?.phase).toBe('live'));
  return source.key!;
}

const acceptedPrompt = (key: string) => {
  const prompt: Serialized = { mode: 'send', text: 'Next instruction', content: 'Next instruction', display: 'Next instruction', pastedContents: {}, omitted: 0, empty: false };
  afterAccepted(fakeClient().client, key as AppSessionId, prompt);
};

describe('Transcript', () => {
  it('an accepted send returns to following after the reader scrolled up', async () => {
    const key = await mounted(deniedThenAnswer());
    fireEvent.wheel(document.querySelector('[data-transcript-scroller]')!, { deltaY: -100 });
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
    expect(useTranscriptStore.getState().entries[key].following).toBe(false);
    act(() => acceptedPrompt(key));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull());
  });

  async function sharedChildViews() {
    const source = sourceOf(deniedThenAnswer());
    const view = render(
      <>
        <section aria-label="First child view"><Transcript source={source} variant="child" /></section>
        <section aria-label="Second child view"><Transcript source={source} variant="child" /></section>
      </>,
    );
    await waitFor(() => expect(useTranscriptStore.getState().entries[source.key!]?.phase).toBe('live'));
    const views = ['First child view', 'Second child view'].map((name) => {
      const root = view.getByRole('region', { name });
      const region = within(root);
      const scroller = root.querySelector<HTMLElement>('[data-transcript-scroller]')!;
      let top = 18_000;
      Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => void (top = value) });
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 20_000 });
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 2_000 });
      const scroll = vi.fn((options?: ScrollToOptions | number, y?: number) => {
        const offset = typeof options === 'number' ? y : options?.top;
        top = Math.min(offset ?? top, 18_000);
      });
      scroller.scrollTo = scroll;
      const moveTo = (offset: number) => act(() => { top = offset; fireEvent.scroll(scroller); });
      moveTo(18_000);
      fireEvent.wheel(scroller, { deltaY: -100 });
      moveTo(1_000);
      return { region, scroll, moveTo, offset: () => top };
    });
    for (const { region, scroll } of views) {
      expect(region.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
      scroll.mockClear();
    }
    return { key: source.key!, views };
  }

  for (const method of ['Jump to latest', 'scrolling to the bottom'] as const) {
    it(`${method} in one live child view leaves another view of the same child in place`, async () => {
      const { views: [first, second] } = await sharedChildViews();
      if (method === 'Jump to latest') fireEvent.click(first.region.getByRole('button', { name: 'Jump to latest' }));
      else first.moveTo(18_000);
      await waitFor(() => expect(first.region.queryByRole('button', { name: 'Jump to latest' })).toBeNull());
      expect(second.region.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
      expect(second.offset()).toBe(1_000);
      expect(second.scroll).not.toHaveBeenCalled();
    });
  }

  it('an accepted-send request reaches a released view even when another shared child view already follows', async () => {
    const { key, views: [first, second] } = await sharedChildViews();
    fireEvent.click(first.region.getByRole('button', { name: 'Jump to latest' }));
    expect(useTranscriptStore.getState().entries[key].following).toBe(true);
    expect(second.region.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
    expect(second.scroll).not.toHaveBeenCalled();
    act(() => acceptedPrompt(key));
    await waitFor(() => expect(second.region.queryByRole('button', { name: 'Jump to latest' })).toBeNull());
    expect(second.offset()).toBe(18_000);
    expect(second.scroll).toHaveBeenCalled();
  });

  it('a jump to a standalone cell in a collapsed turn opens the turn and focuses the cell', async () => {
    const key = await mounted(deniedThenAnswer());
    const target = cellId.tool(tool('t1'));
    expect(document.querySelector(`[data-cell-id="${target}"]`)).toBeNull(); // the turn is collapsed
    act(() => useTranscriptStore.getState().jumpTo(key, target));
    await waitFor(() => expect(useTranscriptStore.getState().entries[key].jump).toBeNull());
    const cell = document.querySelector<HTMLElement>(`[data-cell-id="${target}"]`)!;
    expect(cell).not.toBeNull();
    // The cell takes focus through its own focus target (its disclosure until M4 makes the cell focusable), never
    // through the generic row wrapper.
    expect(cell.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.hasAttribute('data-row-id')).toBe(false);
    expect(document.activeElement?.classList.contains('transcript-row')).toBe(false);
  });

  // Whole-branch review P3 (rebase task): the view handles a jump asked for during a staged restart on the old rows
  // before the fresh snapshot lands; installing the fresh state must not undo it (the turn it opened stays open and
  // the target keeps focus).
  it('a jump the view handled during a staged restart still holds once the fresh history is installed', async () => {
    const events = deniedThenAnswer();
    const key = `transcript-test-${++keys}`;
    const first = render(<Transcript source={{ key, subscribe: () => () => {}, snapshot: () => Promise.resolve(events) }} variant="session" />);
    await waitFor(() => expect(useTranscriptStore.getState().entries[key]?.phase).toBe('live'));
    first.unmount(); // the last holder detaches; the key's rows stay
    let resolve: (events: SessionEvent[]) => void = () => {};
    render(<Transcript source={{ key, subscribe: () => () => {}, snapshot: () => new Promise((r) => (resolve = r)) }} variant="session" />);
    await waitFor(() => expect(useTranscriptStore.getState().entries[key].phase).toBe('hydrating'));
    const target = cellId.tool(tool('t1'));
    act(() => useTranscriptStore.getState().jumpTo(key, target));
    await waitFor(() => expect(useTranscriptStore.getState().entries[key].jump).toBeNull()); // handled on the old rows
    expect(document.querySelector(`[data-cell-id="${target}"]`)).not.toBeNull();
    await act(async () => resolve(events.map((event) => ({ ...event, id: `disk:${event.id}` as EventId, seq: null }))));
    await waitFor(() => expect(useTranscriptStore.getState().entries[key].phase).toBe('live'));
    await waitFor(() => expect(useTranscriptStore.getState().entries[key].jump).toBeNull());
    const cell = document.querySelector<HTMLElement>(`[data-cell-id="${target}"]`);
    expect(cell).not.toBeNull();
    expect(cell!.contains(document.activeElement)).toBe(true);
  });

  // The same jump when the reader moved on during the round trip: the re-resolved jump leaves them where they are,
  // whether they put focus elsewhere or scrolled the transcript.
  for (const [how, moveOn] of [
    ['focused another control', (outside: HTMLElement) => outside.focus()],
    ['scrolled the transcript', () => {
      fireEvent.wheel(document.querySelector('[data-transcript-scroller]')!, { deltaY: 400 });
      (document.activeElement as HTMLElement | null)?.blur();
    }],
  ] as const) {
    it(`a jump re-resolved at install does not take the reader back once they ${how}`, async () => {
      const events = deniedThenAnswer();
      const key = `transcript-test-${++keys}`;
      const outside = document.body.appendChild(document.createElement('button'));
      onTestFinished(() => outside.remove());
      const first = render(<Transcript source={{ key, subscribe: () => () => {}, snapshot: () => Promise.resolve(events) }} variant="session" />);
      await waitFor(() => expect(useTranscriptStore.getState().entries[key]?.phase).toBe('live'));
      first.unmount();
      let resolve: (events: SessionEvent[]) => void = () => {};
      render(<Transcript source={{ key, subscribe: () => () => {}, snapshot: () => new Promise((r) => (resolve = r)) }} variant="session" />);
      await waitFor(() => expect(useTranscriptStore.getState().entries[key].phase).toBe('hydrating'));
      const target = cellId.tool(tool('t1'));
      act(() => useTranscriptStore.getState().jumpTo(key, target));
      await waitFor(() => expect(useTranscriptStore.getState().entries[key].jump).toBeNull());
      expect(document.querySelector(`[data-cell-id="${target}"]`)!.contains(document.activeElement)).toBe(true);
      act(() => moveOn(outside));
      const focused = document.activeElement;
      await act(async () => resolve(events.map((event) => ({ ...event, id: `disk:${event.id}` as EventId, seq: null }))));
      await waitFor(() => expect(useTranscriptStore.getState().entries[key].phase).toBe('live'));
      await waitFor(() => expect(useTranscriptStore.getState().entries[key].jump).toBeNull());
      await new Promise((r) => requestAnimationFrame(r));
      expect(document.activeElement).toBe(focused);
      expect(document.querySelector(`[data-cell-id="${target}"]`)).not.toBeNull(); // what the jump opened stays open
    });
  }

  // A jump whose target the old rows did not hold (a notification opening an item the fresh history brings) was never
  // shown, so the re-resolved jump is performed even though focus sits outside the transcript.
  it('a jump this view never handled lands at install, focus elsewhere notwithstanding', async () => {
    const events = deniedThenAnswer();
    const later = events.findIndex((event) => event.kind === 'turn.started' && event.userMessageUuid === uuid('u2'));
    const key = `transcript-test-${++keys}`;
    const outside = document.body.appendChild(document.createElement('button'));
    onTestFinished(() => outside.remove());
    const first = render(<Transcript source={{ key, subscribe: () => () => {}, snapshot: () => Promise.resolve(events.slice(later)) }} variant="session" />);
    await waitFor(() => expect(useTranscriptStore.getState().entries[key]?.phase).toBe('live'));
    first.unmount();
    let resolve: (events: SessionEvent[]) => void = () => {};
    render(<Transcript source={{ key, subscribe: () => () => {}, snapshot: () => new Promise((r) => (resolve = r)) }} variant="session" />);
    await waitFor(() => expect(useTranscriptStore.getState().entries[key].phase).toBe('hydrating'));
    const target = cellId.tool(tool('t1'));
    act(() => useTranscriptStore.getState().jumpTo(key, target)); // absent from the old rows: nothing to show yet
    expect(useTranscriptStore.getState().entries[key].jump).toBeNull();
    act(() => outside.focus());
    await act(async () => resolve(events.map((event) => ({ ...event, id: `disk:${event.id}` as EventId, seq: null }))));
    await waitFor(() => expect(useTranscriptStore.getState().entries[key].phase).toBe('live'));
    await waitFor(() => expect(document.querySelector(`[data-cell-id="${target}"]`)?.contains(document.activeElement)).toBe(true));
  });

  // P3-F (tracker row 199, the must-read): the jump's focus waits a frame; a staged restart's install can reissue the jump
  // before that frame comes, cancelling it. The reissue still owes the focus, since none was given: the reader is not
  // taken to have moved on because focus sits on the control that asked for the jump (the Needs-you row).
  describe('a jump whose frame the install cancelled', () => {
    // The frames requested from here on are held until `run`; a cancelled one never runs.
    function holdFrames() {
      const frames = new Map<number, FrameRequestCallback>();
      let next = 0;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((frame) => {
        frames.set(++next, frame);
        return next;
      });
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void frames.delete(id));
      onTestFinished(() => {
        vi.restoreAllMocks();
      });
      return {
        run: () =>
          act(() => {
            const due = [...frames.values()];
            frames.clear();
            due.forEach((frame) => frame(performance.now()));
          }),
      };
    }
    const disk = (events: SessionEvent[]) => events.map((event) => ({ ...event, id: `disk:${event.id}` as EventId, seq: null }));

    it('focuses its target on the next frame, the asking control focused meanwhile', async () => {
      const events = deniedThenAnswer();
      const key = `transcript-test-${++keys}`;
      const asker = document.body.appendChild(document.createElement('button'));
      onTestFinished(() => asker.remove());
      const first = render(<Transcript source={{ key, subscribe: () => () => {}, snapshot: () => Promise.resolve(events) }} variant="session" />);
      await waitFor(() => expect(useTranscriptStore.getState().entries[key]?.phase).toBe('live'));
      first.unmount(); // the tab left: the key's rows stay
      act(() => asker.focus());
      const frames = holdFrames();
      const target = cellId.tool(tool('t1'));
      act(() => useTranscriptStore.getState().jumpTo(key, target)); // asked on the kept rows, before the view remounts
      let resolve: (events: SessionEvent[]) => void = () => {};
      render(<Transcript source={{ key, subscribe: () => () => {}, snapshot: () => new Promise((r) => (resolve = r)) }} variant="session" />);
      await waitFor(() => expect(useTranscriptStore.getState().entries[key].phase).toBe('hydrating'));
      await act(async () => resolve(disk(events))); // the install reissues the jump before its frame came
      await waitFor(() => expect(useTranscriptStore.getState().entries[key].phase).toBe('live'));
      expect(document.activeElement).toBe(asker);
      frames.run();
      expect(document.querySelector(`[data-cell-id="${target}"]`)?.contains(document.activeElement)).toBe(true);
      expect(useTranscriptStore.getState().entries[key].jump).toBeNull();
    });

    it('focuses it when the same target was focused before and the reader asked for it again', async () => {
      const events = deniedThenAnswer();
      const key = `transcript-test-${++keys}`;
      const asker = document.body.appendChild(document.createElement('button'));
      onTestFinished(() => asker.remove());
      const first = render(<Transcript source={{ key, subscribe: () => () => {}, snapshot: () => Promise.resolve(events) }} variant="session" />);
      await waitFor(() => expect(useTranscriptStore.getState().entries[key]?.phase).toBe('live'));
      first.unmount();
      let resolve: (events: SessionEvent[]) => void = () => {};
      render(<Transcript source={{ key, subscribe: () => () => {}, snapshot: () => new Promise((r) => (resolve = r)) }} variant="session" />);
      await waitFor(() => expect(useTranscriptStore.getState().entries[key].phase).toBe('hydrating'));
      const target = cellId.tool(tool('t1'));
      act(() => useTranscriptStore.getState().jumpTo(key, target)); // the first request lands on the old rows
      await waitFor(() => expect(useTranscriptStore.getState().entries[key].jump).toBeNull());
      expect(document.querySelector(`[data-cell-id="${target}"]`)!.contains(document.activeElement)).toBe(true);
      act(() => asker.focus()); // the reader went elsewhere, then asked for the same place again
      const frames = holdFrames();
      act(() => useTranscriptStore.getState().jumpTo(key, target));
      await act(async () => resolve(disk(events))); // its frame cancelled by the install's reissue
      await waitFor(() => expect(useTranscriptStore.getState().entries[key].phase).toBe('live'));
      expect(document.activeElement).toBe(asker);
      frames.run();
      expect(document.querySelector(`[data-cell-id="${target}"]`)?.contains(document.activeElement)).toBe(true);
      expect(useTranscriptStore.getState().entries[key].jump).toBeNull();
    });
  });

  it('the denied count of a collapsed turn opens its work area and focuses the standalone denied cell itself', async () => {
    const key = await mounted(deniedThenAnswer());
    const turn = turnId.ofMessage(uuid('u1'));
    const divider = document.querySelector(`[data-row-id="${rowId.divider(turn)}"]`)!;
    expect(divider.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(within(divider as HTMLElement).getByRole('link', { name: '1 denied' }));
    await waitFor(() => expect(useTranscriptStore.getState().entries[key].jump).toBeNull());
    const target = cellId.tool(tool('t1'));
    const cell = document.querySelector<HTMLElement>(`[data-cell-id="${target}"]`)!;
    expect(document.activeElement).toBe(cell);
    expect(cell.closest('[data-kind]')?.getAttribute('data-kind')).toBe('cell');
    expect(document.querySelector(`[data-row-id="${rowId.divider(turn)}"] button[aria-expanded]`)?.getAttribute('aria-expanded')).toBe('true');
  });

  it('an open divider names a mounted element in aria-controls', async () => {
    await mounted(deniedThenAnswer());
    const divider = document.querySelector(`[data-row-id="${rowId.divider(turnId.ofMessage(uuid('u2')))}"]`)!;
    const toggle = divider.querySelector<HTMLElement>('button[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getAllByRole('button', { expanded: true }).length).toBeGreaterThan(0));
    const open = document.querySelector(`[data-row-id="${rowId.divider(turnId.ofMessage(uuid('u2')))}"] button[aria-expanded]`)!;
    expect(open.getAttribute('aria-expanded')).toBe('true');
    const controls = open.getAttribute('aria-controls')!.split(' ');
    expect(controls.length).toBeGreaterThan(0);
    for (const id of controls) expect(document.getElementById(id), `#${id} is in the DOM`).not.toBeNull();
  });

  // W8 (T3): the divider's click moves the work area: its rows grow in from nothing, and a fold closes them away
  // before the turn leaves the list.
  it('the divider’s click grows the work area’s rows in, and a fold closes them before the turn folds', async () => {
    await mounted(deniedThenAnswer());
    const turn = turnId.ofMessage(uuid('u2'));
    const toggle = () => document.querySelector<HTMLElement>(`[data-row-id="${rowId.divider(turn)}"] button[aria-expanded]`)!;
    const work = () => document.querySelector<HTMLElement>(`[data-turn-id="${turn}"][data-kind="cell"]`);
    expect(work()).toBeNull();
    fireEvent.click(toggle());
    await waitFor(() => expect(work()).not.toBeNull());
    expect(work()!.style.transition).toContain('height 300ms');
    await waitFor(() => expect(work()!.getAttribute('style')).toBeNull()); // at rest
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(work()!.style.height).toBe('0px'); // closing, still in the list
    expect(work()!.style.transition).toContain('height 150ms');
    await waitFor(() => expect(work()).toBeNull()); // the turn folded
    expect(document.querySelector(`[data-row-id="${rowId.divider(turn)}"]`)).not.toBeNull();
  });

  it('a jump into a turn whose fold is running calls the fold off, so its target stays in the list (W8)', async () => {
    const key = await mounted(deniedThenAnswer());
    const turn = turnId.ofMessage(uuid('u2'));
    const toggle = () => document.querySelector<HTMLElement>(`[data-row-id="${rowId.divider(turn)}"] button[aria-expanded]`)!;
    const target = cellId.tool(tool('t2')); // the turn's standalone cell, its own row
    fireEvent.click(toggle());
    await waitFor(() => expect(document.querySelector(`[data-cell-id="${target}"]`)).not.toBeNull());
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    act(() => useTranscriptStore.getState().jumpTo(key, target));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    await act(() => new Promise((resolve) => setTimeout(resolve, 200))); // past the close
    expect(useTranscriptStore.getState().rows(key).some((row) => row.id === target)).toBe(true);
    expect(document.querySelector(`[data-cell-id="${target}"]`)).not.toBeNull();
  });

  it('a history that failed to load says why and offers Retry, which hydrates it', async () => {
    let attempts = 0;
    const source: TranscriptSource = {
      key: `transcript-test-${++keys}`,
      subscribe: () => () => {},
      snapshot: () => (++attempts === 1 ? Promise.reject(new Error('engine-host is not running')) : Promise.resolve(deniedThenAnswer())),
    };
    render(<Transcript source={source} variant="session" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load this transcript · engine-host is not running');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(useTranscriptStore.getState().entries[source.key!].phase).toBe('live'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('[data-kind="user"]')).toHaveLength(2);
  });

  it('docks C7’s card through renderRequest in a pending request’s slot', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('q1', 'AskUserQuestion', { questions: [] });
    b.emit('question.requested', { requestId: request('r1'), toolUseId: tool('q1'), questions: [] });
    const source = sourceOf(b.events);
    render(<Transcript source={source} variant="session" renderRequest={(slot) => <div data-card="">{`Card ${slot.requestKind}`}</div>} />);
    await waitFor(() => expect(document.querySelector('[data-card]')?.textContent).toBe('Card question'));
    expect(document.querySelector('[data-kind="request_slot"]')?.textContent).toBe('Card question');
  });

  it('pass2/rewind: Show reveals the hidden branch muted and not in context, Hide removes it, and the boundary stays put', async () => {
    const key = await mounted(journalToEvents(loadJournal('pass2', 'rewind')));
    const boundaryId = useTranscriptStore.getState().rows(key).find((row) => row.kind === 'boundary')!.id;
    const place = () => {
      const element = document.querySelector<HTMLElement>(`[data-row-id="${boundaryId}"]`)!;
      return { transform: element.style.transform, index: useTranscriptStore.getState().rows(key).findIndex((row) => row.id === boundaryId) };
    };
    const before = place();
    expect(document.querySelectorAll('[data-muted]')).toHaveLength(0);
    const boundary = document.querySelector<HTMLElement>(`[data-row-id="${boundaryId}"]`)!;
    fireEvent.click(within(boundary).getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(document.querySelectorAll('[data-muted]').length).toBeGreaterThan(0));
    const muted = [...document.querySelectorAll<HTMLElement>('[data-muted]')];
    expect(muted.map((row) => row.dataset.kind)).toEqual(['user', 'assistant_text']);
    expect(muted[0].textContent).toContain('Not in context');
    expect(place()).toEqual(before);
    fireEvent.click(within(document.querySelector<HTMLElement>(`[data-row-id="${boundaryId}"]`)!).getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(document.querySelectorAll('[data-muted]')).toHaveLength(0));
    expect(place()).toEqual(before);
  });

  // A turn the owner did not start opens with its divider (no user row), a peer turn as much as an engine turn.
  it('a revealed peer turn without a user row says Not in context on its divider', async () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'One');
    b.end(['u1']);
    b.turn('u2');
    b.text('m2', 0, 'Two');
    b.end(['u2']);
    b.emit('turn.started', { userMessageUuid: null, origin: null });
    b.text('m3', 0, 'Peer again');
    b.end([], { origin: 'peer' });
    b.emit('boundary.rewind', { targetMessageUuid: uuid('u2'), precedingAssistantUuid: uuid('m1-u0'), prefillText: 'prompt u2' });
    const key = await mounted(b.events);
    const boundaryId = useTranscriptStore.getState().rows(key).find((row) => row.kind === 'boundary')!.id;
    fireEvent.click(within(document.querySelector<HTMLElement>(`[data-row-id="${boundaryId}"]`)!).getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(document.querySelectorAll('[data-muted]').length).toBeGreaterThan(0));
    const labelled = [...document.querySelectorAll<HTMLElement>('[data-muted]')].filter((row) => row.textContent?.includes('Not in context')).map((row) => row.dataset.kind);
    expect(labelled).toEqual(['user', 'divider']);
  });
});

// E11 (W-C; E1's blocking-ask screenshots): the viewport changing height with no scroll and no row change (the composer
// below growing with an attention notice) moves the end out of view; a following reader is kept at the end.
describe('follow mode across a change of the viewport’s height', () => {
  const resized: ((height: number) => void)[] = [];
  const Native = globalThis.ResizeObserver;
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      private readonly targets: Element[] = [];
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.targets.push(target);
        if (target.hasAttribute('data-transcript-scroller')) resized.push((height) => this.callback([{ target, contentRect: { height } } as ResizeObserverEntry], this));
      }
      unobserve() {}
      disconnect() {
        resized.length = 0;
      }
    };
  });
  afterAll(() => {
    globalThis.ResizeObserver = Native;
  });

  const rows = () => {
    const b = builder();
    for (let i = 0; i < 80; i++) {
      b.turn(`u${i}`);
      b.text(`m${i}`, 0, `Answer ${i}`);
      b.end([`u${i}`]);
    }
    return b.events;
  };

  it('a following reader is scrolled back to the end; one who scrolled up is left where they are', async () => {
    await mounted(rows());
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    const scrolls: unknown[] = [];
    scroller.scrollTo = ((options: ScrollToOptions) => void scrolls.push(options)) as typeof scroller.scrollTo;
    act(() => resized.forEach((fire) => fire(2000))); // the first report: the height it opened at
    expect(scrolls).toEqual([]);
    act(() => resized.forEach((fire) => fire(1800))); // the composer grew
    expect(scrolls).not.toEqual([]); // following: pinned to the end again

    let top = 18_000; // happy-dom has no scroll metrics: the scroller's, by hand, the reader at the end
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => void (top = value) });
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 20_000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 2_000 });
    act(() => void fireEvent.scroll(scroller)); // at the end
    act(() => {
      fireEvent.wheel(scroller, { deltaY: -1 });
      top = 0; // the reader scrolls up: follow mode ends
      fireEvent.scroll(scroller);
    });
    await screen.findByRole('button', { name: 'Jump to latest' });
    scrolls.length = 0;
    act(() => resized.forEach((fire) => fire(1600)));
    expect(scrolls).toEqual([]);
  });
});

// P4-B3 (its Decision Log 14; Claude's rule): a session moved between a pane and a floating card is a remount, and a
// transcript mounts at its end. Each mount records where the reader was as it goes; a card's float or dock marks the
// next mount, which comes back there: at the end when the reader followed, else at the same row when the content is
// unchanged, else at the end. An unmarked mount (an ordinary tab switch) opens at the end as before.
describe('the scroll carried across a card’s float and dock', () => {
  const turns = () => {
    const b = builder();
    for (let i = 0; i < 80; i++) {
      b.turn(`u${i}`);
      b.text(`m${i}`, 0, `Answer ${i}`);
      b.end([`u${i}`]);
    }
    return b.events;
  };
  const scroller = () => document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
  const rendered = () => [...document.querySelectorAll<HTMLElement>('[data-row-id]')];
  const startOf = (row: HTMLElement) => Number(/translateY\((-?[\d.]+)px\)/.exec(row.style.transform)![1]);
  // happy-dom has no scroll metrics: the scroller's, by hand, and every scroll the list makes kept
  function scrollMetrics() {
    let top = 0;
    const scrolls: number[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(function (this: HTMLElement, options?: ScrollToOptions | number) {
      if (typeof options === 'object' && options.top !== undefined && this.hasAttribute('data-transcript-scroller')) scrolls.push((top = options.top));
    });
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-transcript-scroller') ? top : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (this: HTMLElement, value: number) {
      if (this.hasAttribute('data-transcript-scroller')) top = value;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(20_000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(2_000);
    onTestFinished(() => void vi.restoreAllMocks());
    return { scrolls, scrollTo: (value: number) => act(() => void ((top = value), fireEvent.scroll(scroller()))) };
  }
  async function mount(key: string, events: SessionEvent[]) {
    const view = render(<Transcript source={{ key, subscribe: () => () => {}, snapshot: () => Promise.resolve(events) }} variant="session" />);
    await waitFor(() => expect(useTranscriptStore.getState().entries[key]?.phase).toBe('live'));
    return view;
  }

  it('records, as it unmounts, whether the reader followed, the offset, the content’s signature and the first visible row', async () => {
    const metrics = scrollMetrics();
    const key = `transcript-test-${++keys}`;
    const view = await mount(key, turns());
    metrics.scrollTo(18_000); // at the end
    act(() => { fireEvent.wheel(scroller(), { deltaY: -1 }); });
    metrics.scrollTo(410); // the reader scrolls up: follow mode ends
    const first = rendered().find((row) => startOf(row) <= 410 && 410 < startOf(row) + 40)!;
    const ids = useTranscriptStore.getState().entries[key].rows.map((row) => row.id);
    view.unmount();
    markTranscriptCarry(key);
    expect(takeTranscriptCarry(key)).toEqual({ following: false, offset: 410, signature: `${ids.length}:${ids.at(-1)}`, anchor: first.dataset.rowId });
  });

  it('a marked mount of unchanged content comes back with the same row at the top, not following', async () => {
    const metrics = scrollMetrics();
    const key = `transcript-test-${++keys}`;
    const events = turns();
    (await mount(key, events)).unmount();
    const ids = useTranscriptStore.getState().entries[key].rows.map((row) => row.id);
    const anchor = ids[3];
    recordTranscriptScroll(key, { following: false, offset: 999, signature: scrollSignature(ids.map((id) => ({ id }))), anchor });
    markTranscriptCarry(key);
    metrics.scrolls.length = 0;
    await mount(key, events);
    const row = rendered().find((r) => r.dataset.rowId === anchor)!;
    expect(metrics.scrolls.at(-1), 'the row at the top, where the rows measured put it').toBe(startOf(row));
    expect(metrics.scrolls.every((top) => top < 2_000), 'never to the end').toBe(true);
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
  });

  it('a marked mount goes to the end when the reader followed, or when the content changed; an unmarked one always does', async () => {
    const metrics = scrollMetrics();
    const events = turns();
    const ends = async (key: string) => {
      metrics.scrolls.length = 0;
      const view = await mount(key, events);
      expect(metrics.scrolls.at(-1), 'at the end').toBeGreaterThan(2_000);
      expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
      view.unmount();
    };
    const key = `transcript-test-${++keys}`;
    (await mount(key, events)).unmount();
    const ids = useTranscriptStore.getState().entries[key].rows.map((row) => row.id);
    const same = scrollSignature(ids.map((id) => ({ id })));
    recordTranscriptScroll(key, { following: true, offset: 18_000, signature: same, anchor: ids[3] });
    markTranscriptCarry(key);
    await ends(key);
    recordTranscriptScroll(key, { following: false, offset: 120, signature: `${ids.length - 1}:${ids.at(-2)}`, anchor: ids[3] });
    markTranscriptCarry(key);
    await ends(key);
    recordTranscriptScroll(key, { following: false, offset: 120, signature: same, anchor: ids[3] });
    await ends(key); // not marked
  });

  // M2 review (P2): a dock renders the pane's transcript in the same commit that removes the card's, so the new mount
  // must take the place the removed one recorded in that commit, not an older record. Both directions, each one commit.
  describe('a mount swapped for another in one commit (a dock, a float)', () => {
    function Swap({ source, at }: { source: TranscriptSource; at: 'pane' | 'card' }) {
      return at === 'pane' ? (
        <section data-at="pane">
          <Transcript source={source} variant="session" />
        </section>
      ) : (
        <aside data-at="card">
          <Transcript source={source} variant="session" />
        </aside>
      );
    }
    const rowAt = (top: number) => rendered().find((row) => startOf(row) <= top && top < startOf(row) + 40)!.dataset.rowId!;
    const shownAt = (id: string) => startOf(rendered().find((row) => row.dataset.rowId === id)!);

    async function swapScene() {
      const metrics = scrollMetrics();
      const key = `transcript-test-${++keys}`;
      const source: TranscriptSource = { key, subscribe: () => () => {}, snapshot: () => Promise.resolve(turns()) };
      const view = render(<Swap source={source} at="pane" />);
      await waitFor(() => expect(useTranscriptStore.getState().entries[key]?.phase).toBe('live'));
      const ids = useTranscriptStore.getState().entries[key].rows.map((row) => row.id);
      // an older record of this session (the last float's), which the swap must not restore
      recordTranscriptScroll(key, { following: false, offset: 120, signature: scrollSignature(ids.map((id) => ({ id }))), anchor: ids[3] });
      const swap = (at: 'pane' | 'card') =>
        act(() => {
          markTranscriptCarry(key);
          view.rerender(<Swap source={source} at={at} />);
        });
      return { metrics, ids, swap, inCard: () => document.querySelector('[data-at="card"] [data-transcript-scroller]') !== null };
    }

    it('a reader scrolled up comes back at the row the removed mount showed, pane to card and card to pane', async () => {
      const { metrics, ids, swap, inCard } = await swapScene();
      metrics.scrollTo(18_000);
      act(() => { fireEvent.wheel(scroller(), { deltaY: -1 }); });
      metrics.scrollTo(410);
      const there = rowAt(410);
      expect(there).not.toBe(ids[3]);
      swap('card');
      expect(inCard()).toBe(true);
      // the virtualiser re-aims at the row over the next frames, as the rows above it measure
      await waitFor(() => expect(metrics.scrolls.at(-1)).toBe(shownAt(there)));
      expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
      metrics.scrollTo(810);
      const back = rowAt(810);
      expect(back).not.toBe(there);
      swap('pane');
      expect(inCard()).toBe(false);
      await waitFor(() => expect(metrics.scrolls.at(-1)).toBe(shownAt(back)));
      expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
    });

    it('a reader at the end stays pinned: the swapped-in mount follows at the end', async () => {
      const { metrics, swap } = await swapScene();
      metrics.scrollTo(18_000);
      swap('card');
      expect(metrics.scrolls.at(-1), 'at the end').toBeGreaterThan(2_000);
      expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    });
  });
});
