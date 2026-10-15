// @vitest-environment happy-dom
// A link in a message opens in a new tab, cut off from this page (`noopener`), through the browser's own TranscriptActions
// around MAWS's Markdown — never MAWS's IPC defaults, which the desk does not load.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LogEvent } from 'desk-hub/protocol';
import { VECTOR_PROJECT as PROJECT } from '../../../test/vectors';
import { memoryLogRecord } from '../../log/record';
import { ProjectConnection } from '../../project/connection';
import { DeskContext } from './desk-context';
import { StreamView } from './StreamView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('opens a link in a message in a new tab, without opener', async () => {
  const connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  const event = { ts: '2026-10-15T08:00:00.000Z', writer: 'mini/67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', seq: 1, kind: 'message', mac: { nonce: 'n', value: 'v' } } as LogEvent;
  render(
    <DeskContext.Provider value={{ connection, member: 'm', sessions: new Map() }}>
      <StreamView items={[{ kind: 'message', key: 'm', offset: 1, event, session: null, from: 'maws-45', text: 'see [the PR](https://github.com/SSFSKIM/MAWS/pull/1)' }]} outbox={[]} />
    </DeskContext.Provider>,
  );
  const link = await waitFor(() => screen.getByRole('link', { name: 'the PR' }));
  fireEvent.click(link);
  expect(open).toHaveBeenCalledWith('https://github.com/SSFSKIM/MAWS/pull/1', '_blank', 'noopener,noreferrer');
  connection.stop();
});
