// The actions registry and the TranscriptSlot (C8's ask, Public surface): each later child contributes its callbacks
// from its own block; the slot mounts one Transcript over the session's IPC source with those callbacks merged over the
// defaults, and re-renders when they change.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACTIONS, registerTranscriptActions, TranscriptSlot, useTranscriptStore } from '../index';
import { builder } from '../model/test-events';
import { registeredActions } from './registry';

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  // happy-dom has no layout: a viewport for the scroller and a height per row, so the virtualiser mounts rows.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-transcript-scroller') ? 2000 : this.hasAttribute('data-index') ? 40 : 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

const disposers: (() => void)[] = [];
const register = (partial: Parameters<typeof registerTranscriptActions>[0]) => {
  const dispose = registerTranscriptActions(partial);
  disposers.push(dispose);
  return dispose;
};
afterEach(() => {
  cleanup();
  for (const dispose of disposers.splice(0)) dispose();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  delete (window as { maws?: MawsBridge }).maws;
});

describe('registerTranscriptActions', () => {
  it('merges registrations over the defaults: a later registration of a key wins, its disposer restores the earlier one, a disposed key falls back to the default', () => {
    expect(registeredActions()).toEqual(DEFAULT_ACTIONS);
    const openFile = vi.fn();
    const openSubagent = vi.fn();
    const later = vi.fn();
    register({ openFile });
    register({ openSubagent });
    expect(registeredActions()).toMatchObject({ openFile, openSubagent, loadSpill: DEFAULT_ACTIONS.loadSpill });
    const disposeLater = register({ openFile: later });
    expect(registeredActions().openFile).toBe(later);
    disposeLater();
    disposeLater(); // a disposer runs once
    expect(registeredActions().openFile).toBe(openFile);
    disposers.shift()!();
    expect(registeredActions().openFile).toBe(DEFAULT_ACTIONS.openFile);
    expect(registeredActions().openSubagent).toBe(openSubagent);
    expect(registeredActions()).toBe(registeredActions()); // stable between changes
  });
});

describe('TranscriptSlot', () => {
  const APP = 'app-slot' as AppSessionId;
  function history(): SessionEvent[] {
    const b = builder();
    b.turn('u1', 'Open the file');
    b.text('m1', 0, 'See [the file](src/a.ts).');
    b.end(['u1']);
    return b.events;
  }

  it('renders the session’s rows from its IPC source, with every registered action reaching the rendered Transcript', async () => {
    const invoke = vi.fn((name: string) =>
      Promise.resolve(name === 'session.events' ? { ok: true, value: { events: history(), lastSeq: 3, complete: true } } : { ok: false, error: { code: 'internal', message: 'unexpected' } }),
    );
    (window as { maws?: MawsBridge }).maws = { invoke, on: vi.fn(() => () => {}) } as unknown as MawsBridge;
    render(<TranscriptSlot appSessionId={APP} className="slot" />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Your message' })).toBeTruthy());
    expect(invoke).toHaveBeenCalledWith('session.events', { appSessionId: APP, afterSeq: null, limit: null });
    expect(document.querySelector('[data-kind="assistant_text"]')?.textContent).toContain('See the file');

    const editAndResubmit = vi.fn();
    const openFile = vi.fn();
    act(() => {
      register({ editAndResubmit });
      register({ openFile });
    });
    fireEvent.click(screen.getByTitle('Edit and resubmit forks history'));
    expect(editAndResubmit).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector<HTMLElement>('[data-chip="path"]')!);
    expect(openFile).toHaveBeenCalledWith('src/a.ts', undefined);

    const again = vi.fn();
    let dispose = () => {};
    act(() => {
      dispose = register({ openFile: again });
    });
    fireEvent.click(document.querySelector<HTMLElement>('[data-chip="path"]')!);
    expect(again).toHaveBeenCalledTimes(1);
    act(() => dispose());
    fireEvent.click(document.querySelector<HTMLElement>('[data-chip="path"]')!);
    expect(openFile).toHaveBeenCalledTimes(2);
  });
});
