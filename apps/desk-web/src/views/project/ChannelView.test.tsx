// @vitest-environment happy-dom
// A direct channel's local state belongs to its session: moving from one session's channel to another's carries over
// no draft, no RPC status, and no Retire confirmation, so a confirmation begun for A can never retire B.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { importOrgKey } from 'desk-hub/protocol';
import { VECTOR_KEY, VECTOR_PROJECT as PROJECT } from '../../../test/vectors';
import { memoryLogRecord } from '../../log/record';
import { ProjectConnection } from '../../project/connection';
import type { DeskSession } from '../../shell/sessions';
import { DeskContext } from '../conversation/desk-context';
import { ChannelView } from './ChannelView';

const A = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const B = '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a';
const session = (id: string, alias: string): DeskSession => ({
  project: PROJECT,
  session: id,
  alias,
  machine: 'mini',
  cwd: '/w',
  worktree: null,
  seat: '',
  member: true,
  ended: null,
  charge: null,
  status: null,
  state: null,
  joinedAt: 1,
  group: 'working',
  presence: { record: { status: 'busy' }, bridge: true },
  machineOnline: true,
});

let connection: ProjectConnection;
beforeEach(async () => {
  connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  connection.setKey(await importOrgKey(VECTOR_KEY));
});
afterEach(() => {
  cleanup();
  connection.stop();
});

it("carries none of one session's draft or confirmation into another's channel, and retires only the session it was confirmed for", async () => {
  const sessions = new Map([
    [A, session(A, 'maws-45')],
    [B, session(B, 'maws-fe')],
  ]);
  const view = (id: string) => (
    <DeskContext.Provider value={{ connection, member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', sessions }}>
      <ChannelView name="MAWS" channel={{ kind: 'session', session: id }} session={sessions.get(id)!} events={[]} />
    </DeskContext.Provider>
  );
  const { rerender } = render(view(A));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message maws-45' }), { target: { value: 'for maws-45 only' } });
  fireEvent.click(screen.getByRole('button', { name: 'Retire…' }));
  expect(screen.getByRole('button', { name: 'Retire' })).toBeTruthy();

  rerender(view(B));
  expect((screen.getByRole('textbox', { name: 'Message maws-fe' }) as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByRole('button', { name: 'Retire' })).toBeNull(); // the confirmation stayed with maws-45
  fireEvent.click(screen.getByRole('button', { name: 'Retire…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
  await waitFor(() => expect(Object.values(connection.conversation.store.getState().rpcs)).toHaveLength(1));
  expect(Object.values(connection.conversation.store.getState().rpcs)[0].rpc.args).toEqual({ session: B });
});
