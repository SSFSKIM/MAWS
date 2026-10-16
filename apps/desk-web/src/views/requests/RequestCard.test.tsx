// @vitest-environment happy-dom
// A request card is its request's alone: two sessions whose bridges raised a question under the same id each keep their
// own draft (MAWS's question stepper keeps drafts by the id the card hands it).
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Raised } from 'desk-hub/protocol';
import { VECTOR_PROJECT as PROJECT } from '../../../test/vectors';
import { memoryLogRecord } from '../../log/record';
import { ProjectConnection } from '../../project/connection';
import { requestKey, type RequestRecord } from '../../project/conversation';
import type { DeskSession } from '../../shell/sessions';
import { DeskContext } from '../conversation/desk-context';
import { RequestCard } from './RequestCard';

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
  group: 'waiting',
  presence: { record: { status: 'waiting' }, bridge: true },
  machineOnline: true,
});
const QUESTIONS = [{ question: 'Which column do we keep?', header: 'Column', options: [{ label: 'user_id' }, { label: 'owner_id' }], multiSelect: false }];
const record = (id: string): RequestRecord => {
  const raised = { request: 'request-1', session: id, tool: 'AskUserQuestion', input: { questions: QUESTIONS }, mac: { nonce: 'n', value: 'v' } } as unknown as Raised;
  const key = requestKey({ machine: 'mini', session: id, request: 'request-1' });
  return { key, request: 'request-1', machine: 'mini', raised, at: 0, pending: true, terminalOnly: false, settled: null };
};

let connection: ProjectConnection;
beforeEach(() => {
  connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  connection.live.setState({ connected: true });
});
afterEach(() => {
  cleanup();
  connection.stop();
});

it("keeps each session's draft of a question raised under the same id as another session's", () => {
  const [a, b] = [record(A), record(B)];
  connection.conversation.store.setState({ requests: { [a.key]: a, [b.key]: b } });
  const sessions = new Map([
    [A, session(A, 'maws-45')],
    [B, session(B, 'maws-fe')],
  ]);
  const view = render(
    <DeskContext.Provider value={{ connection, member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', sessions }}>
      <RequestCard request={a.key} />
      <RequestCard request={b.key} />
    </DeskContext.Provider>,
  );
  const [cardA, cardB] = view.getAllByRole('article');
  const picked = (card: HTMLElement) => within(card).getByRole('radio', { name: /user_id/ }).getAttribute('aria-checked');
  fireEvent.click(within(cardA).getByRole('radio', { name: /user_id/ }));
  expect(picked(cardA)).toBe('true');
  expect(picked(cardB)).toBe('false');
});
