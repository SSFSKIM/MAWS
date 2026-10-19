// @vitest-environment happy-dom
// A request card is its request's alone: two sessions whose bridges raised a question under the same id each keep their
// own draft (MAWS's question stepper keeps drafts by the id the card hands it). A question's Skip sends only what DX6
// takes: the answers given, or — every question skipped — the native question declined; an async one, never declined,
// sends nothing.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  title: null,
  member: true,
  ended: null,
  charge: null,
  status: null,
  state: null,
  joinedAt: 1,
  joinedTs: '',
  group: 'waiting',
  presence: { record: { status: 'waiting' }, bridge: true },
  machineOnline: true,
});
const QUESTIONS = [{ question: 'Which column do we keep?', header: 'Column', options: [{ label: 'user_id' }, { label: 'owner_id' }], multiSelect: false }];
const record = (id: string, request = 'request-1', more: { questions?: unknown[]; tool?: string; async?: true } = {}): RequestRecord => {
  const raised = { request, session: id, tool: more.tool ?? 'AskUserQuestion', input: { questions: more.questions ?? QUESTIONS }, ...(more.async && { async: true }), mac: { nonce: 'n', value: 'v' } } as unknown as Raised;
  const key = requestKey({ machine: 'mini', session: id, request });
  return { key, request, machine: 'mini', raised, at: 0, pending: true, terminalOnly: false, settled: null };
};
const MEMBER = '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c';

let connection: ProjectConnection;
beforeEach(() => {
  connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  connection.live.setState({ connected: true });
});
afterEach(() => {
  cleanup();
  connection.stop();
  vi.restoreAllMocks();
});

it("keeps each session's draft of a question raised under the same id as another session's", () => {
  const [a, b] = [record(A), record(B)];
  connection.conversation.store.setState({ requests: { [a.key]: a, [b.key]: b } });
  const sessions = new Map([
    [A, session(A, 'maws-45')],
    [B, session(B, 'maws-fe')],
  ]);
  const view = render(
    <DeskContext.Provider value={{ connection, member: MEMBER, sessions }}>
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

it('names a titled session on one line: the title truncating, whole on hover, its alias and machine beside it', () => {
  const long = 'Codex native Computer Use internals, its approval prompts, and the native helper';
  const r = record(A);
  connection.conversation.store.setState({ requests: { [r.key]: r } });
  render(
    <DeskContext.Provider value={{ connection, member: MEMBER, sessions: new Map([[A, { ...session(A, 'maws-45'), title: long }]]) }}>
      <RequestCard request={r.key} />
    </DeskContext.Provider>,
  );
  const [name, ...meta] = [...screen.getByTestId('card-who').children] as HTMLElement[];
  expect(name.textContent).toBe(long);
  expect(name.className).toContain('truncate');
  expect(name.title).toBe(long);
  expect(meta.map((e) => [e.textContent, e.className.includes('shrink-0')])).toEqual([
    ['maws-45', true],
    ['@mini', true],
  ]);
});

describe('Skip', () => {
  /** One card, its RPCs caught before they are sealed. */
  function card(r: RequestRecord) {
    connection.conversation.store.setState({ requests: { [r.key]: r } });
    const answer = vi.spyOn(connection, 'answer').mockResolvedValue('nonce');
    const decide = vi.spyOn(connection, 'decide').mockResolvedValue('nonce');
    render(
      <DeskContext.Provider value={{ connection, member: MEMBER, sessions: new Map([[A, session(A, 'maws-45')]]) }}>
        <RequestCard request={r.key} />
      </DeskContext.Provider>,
    );
    return { answer, decide };
  }

  it('declines a native question whose every question was skipped, as Esc in the terminal does, and never sends an empty answer', () => {
    const r = record(A, 'request-skip-native');
    const { answer, decide } = card(r);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(answer).not.toHaveBeenCalled();
    expect(decide).toHaveBeenCalledWith(MEMBER, r, 'deny');
  });

  it('sends the answers given when some questions were skipped', () => {
    const questions = [...QUESTIONS, { question: 'Rename the index too?', header: 'Index', options: [{ label: 'yes' }, { label: 'no' }], multiSelect: false }];
    const r = record(A, 'request-skip-one', { questions });
    const { answer, decide } = card(r);
    fireEvent.click(screen.getByRole('radio', { name: /user_id/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(answer).toHaveBeenCalledWith(MEMBER, r, { 'Which column do we keep?': 'user_id' });
    expect(decide).not.toHaveBeenCalled();
  });

  it('sends nothing for an async question whose every question was skipped, and says why', () => {
    const r = record(A, 'request-skip-async', { tool: 'mcp__doperpowers__AskUserQuestion', async: true });
    const { answer, decide } = card(r);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(answer).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(screen.getByTestId('skip-note').textContent).toBe('Nothing was sent: an async question waits for an answer to at least one of its questions, and cannot be declined.');
  });
});
