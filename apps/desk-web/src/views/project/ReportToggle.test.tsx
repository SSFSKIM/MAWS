// @vitest-environment happy-dom
// The session view's Report · Transcript toggle (DC9's M3): the desk's own, since MAWS's `ReportBar` draws nothing
// without its owner-channel store; it calls the transcript store's `setView`, and the reader's choice is kept per
// session as MAWS keeps it per tab — through a reset of the transcript (which starts the store's state over) and a
// return to the session (whose key was dropped when the view went).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { TranscriptSource } from '../../../../../src/renderer/src/transcript/source/types';
import { ReportToggle } from './ReportToggle';

const EMPTY: TranscriptSource = { subscribe: () => () => {}, snapshot: async () => [] };
const viewOf = (key: string) => useTranscriptStore.getState().entries[key]?.state.ui.view;
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

afterEach(() => {
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
});

it('starts on the report, switches the store to the transcript and back, and keeps the choice per session', async () => {
  const key = 'desk:proj:sess-1';
  await act(() => useTranscriptStore.getState().attach(key, EMPTY, { agentId: null }));
  const view = render(<ReportToggle storeKey={key} />);
  expect(pressed('Report')).toBe('true');
  expect(pressed('Transcript')).toBe('false');

  fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
  expect(viewOf(key)).toBe('transcript');
  expect(pressed('Transcript')).toBe('true');

  // The view goes (its key dropped) and comes back: the store starts the key afresh, and the choice is applied again.
  view.unmount();
  useTranscriptStore.getState().drop(key);
  await act(() => useTranscriptStore.getState().attach(key, EMPTY, { agentId: null }));
  render(<ReportToggle storeKey={key} />);
  expect(viewOf(key)).toBe('transcript');
  expect(pressed('Transcript')).toBe('true');

  fireEvent.click(screen.getByRole('button', { name: 'Report' }));
  expect(viewOf(key)).toBe('report');
  cleanup();

  // Another session opens on its report.
  const other = 'desk:proj:sess-2';
  await act(() => useTranscriptStore.getState().attach(other, EMPTY, { agentId: null }));
  render(<ReportToggle storeKey={other} />);
  expect(pressed('Report')).toBe('true');
  expect(viewOf(other)).toBeUndefined();
});
