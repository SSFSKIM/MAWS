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

it('names who posted each human message: you, another member by id, or a human at a machine', () => {
  const me = '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c';
  const other = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  const human = (seq: number, writer: string, member?: string) => {
    const event = { ts: '2026-10-15T08:00:00.000Z', writer, seq, kind: 'human', from: 'human', to: '*', text: `post ${seq}`, ...(member && { member }), mac: { nonce: `n${seq}`, value: 'v' } } as LogEvent;
    return { kind: 'human' as const, key: `h${seq}`, offset: seq, event, text: `post ${seq}`, to: '*' as const, wake: false };
  };
  render(
    <DeskContext.Provider value={{ connection, member: me, sessions: new Map() }}>
      <StreamView items={[human(1, `hub/${me}`, me), human(2, `hub/${other}`, other), human(3, 'mini/human')]} outbox={[]} />
    </DeskContext.Provider>,
  );
  const who = screen.getAllByTestId('said-who');
  expect(who.map((e) => e.textContent)).toEqual(['You', 'Another member (a1b2c3d4)', 'A human']);
  expect(who[2].parentElement!.textContent).toContain('@mini');
  connection.stop();
});
