// An answer's action row (UX wave U3b, M3; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md,
// decisions 12 to 15, Interfaces §C and §D, Acceptance 7 to 9): Copy, "Fork from here" and the time under the answer the
// mount placed it on. Copy reads the store's turn at the press, whatever the drawn list holds; Fork calls the mount's act
// with the message to fork from, is disabled while it is out and with the sentence the mount's hook gives, and is drawn
// only where the mount gives an act, for a session's transcript.
import { formatClock } from '@shared/app/date-format';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { SESSION_ACTS_CAPABILITY } from '@shared/ipc/remote-unavailable';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { PreloadBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { act, cleanup, fireEvent, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFERS } from '../../../../../endpoint/offers';
import { remoteRow } from '../../../../../../test/support/builders';
import { fakeClient } from '../../../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { resetRemoteSurfaces } from '../../../artifacts/remote-surfaces';
import { resetRemoteLaneBStore } from '../../../lane-b/remote-session';
import { useForkUnavailable } from '../../../lane-b/remote-unavailable';
import { forkInPlace } from '../../../sessions/record-ops';
import { useMachines } from '../../../stores/machines';
import { useNotices } from '../../../stores/notices';
import { useSessions } from '../../../stores/sessions';
import { answerActionsOf } from '../../model/answer-actions';
import type { Row, RowId, TurnId } from '../../model/rows';
import { builder } from '../../model/test-events';
import { AnswerActionsStore, type TranscriptActions } from '../context';
import { renderRow, spyActions, storeWith } from './test-support';

afterEach(cleanup);

type Answer = Extract<Row, { kind: 'assistant_text' }>;
const AT = '2026-11-15T14:41:00.000Z';
const answerRow = (id = 'text:a1'): Answer => ({ id: id as RowId, turnId: 'turn:u1' as TurnId, at: AT, kind: 'assistant_text', messageUuid: null, blockIndex: 0, markdown: 'All five stations are inside the limit.', live: false, phase: 'answer', model: null });
const placed = (row: Row, entry: { rewindTo: string | null; fork?: boolean }) => {
  const store = new AnswerActionsStore();
  store.publish(new Map([[row.id, { turnId: row.turnId!, rewindTo: entry.rewindTo as MessageUuid | null, fork: entry.fork ?? true }]]));
  return store;
};
const forkWith = (over: Partial<NonNullable<TranscriptActions['forkFrom']>> = {}) => ({ useUnavailable: vi.fn(() => null), run: vi.fn(async () => {}), ...over });
const actionsWith = (forkFrom?: TranscriptActions['forkFrom']): TranscriptActions => ({ ...spyActions(), ...(forkFrom && { forkFrom }) });
const KEY = addressOf(TEST_MACHINE, 'app-here' as AppSessionId);
const fork = () => screen.queryByRole('button', { name: 'Fork from here' }) as HTMLButtonElement | null;

describe('the action row', () => {
  it('draws Copy, Fork from here and the answer’s time, in that order, on the answer the mount placed it on', () => {
    const row = answerRow();
    const { container } = renderRow(row, { storeKey: KEY, actions: actionsWith(forkWith()), answerActions: placed(row, { rewindTo: 'u2' }) });
    const line = container.querySelector('.transcript-answer-actions')!;
    expect([...line.children].map((child) => child.textContent)).toEqual(['Copy', 'Fork from here', formatClock(Date.parse(AT))]);
    expect(fork()!.title).toBe('Starts a new session from this point. This one stays as it is.');
  });

  it('draws nothing on an answer the mount did not place it on', () => {
    const { container } = renderRow(answerRow(), { storeKey: KEY, actions: actionsWith(forkWith()), answerActions: placed(answerRow('text:other'), { rewindTo: null }) });
    expect(container.querySelector('.transcript-answer-actions')).toBeNull();
    cleanup();
    expect(renderRow(answerRow(), { storeKey: KEY }).container.querySelector('.transcript-answer-actions')).toBeNull(); // a mount with no placement
  });

  it('draws Copy and the time and no Fork where the entry forbids it, where the mount gives no act, and in a child’s transcript', () => {
    const row = answerRow();
    for (const options of [
      { actions: actionsWith(forkWith()), answerActions: placed(row, { rewindTo: 'u2', fork: false }) },
      { actions: actionsWith(), answerActions: placed(row, { rewindTo: 'u2' }) },
      { actions: actionsWith(forkWith()), answerActions: placed(row, { rewindTo: 'u2' }), variant: 'child' as const },
    ]) {
      renderRow(row, { storeKey: KEY, ...options });
      expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
      expect(fork()).toBeNull();
      cleanup();
    }
  });
});

// One store per mounted transcript (Interfaces §C): a row reads its own entry, the same object until that entry's value
// changes, so a change of the list re-renders only the rows whose entry changed.
describe('the placement store', () => {
  const entry = (rewindTo: string | null, fork = true) => ({ turnId: 'turn:u1' as TurnId, rewindTo: rewindTo as MessageUuid | null, fork });
  it('keeps an entry’s object while its value holds, and tells its listeners only of a change', () => {
    const store = new AnswerActionsStore();
    const heard = vi.fn();
    store.subscribe(heard);
    store.publish(new Map([['a' as RowId, entry('u2')], ['b' as RowId, entry(null)]]));
    const [a, b] = [store.get('a' as RowId), store.get('b' as RowId)];
    store.publish(new Map([['a' as RowId, entry('u2')], ['b' as RowId, entry(null)]]));
    expect(heard).toHaveBeenCalledTimes(1);
    expect([store.get('a' as RowId), store.get('b' as RowId)]).toEqual([a, b]);
    expect(store.get('a' as RowId)).toBe(a);
    store.publish(new Map([['a' as RowId, entry('u2')], ['b' as RowId, entry('u3')]]));
    expect(heard).toHaveBeenCalledTimes(2);
    expect(store.get('a' as RowId)).toBe(a);
    expect(store.get('b' as RowId)).not.toBe(b);
    store.publish(new Map([['b' as RowId, entry('u3')]]));
    expect(heard).toHaveBeenCalledTimes(3);
    expect(store.get('a' as RowId)).toBeUndefined();
  });
});

describe('Copy', () => {
  it('copies every answer block of the turn from the store, the same text whether or not a block of it is drawn', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const b = builder();
    b.turn('u1', 'Check the gauges.');
    b.text('m1', 0, 'All five stations are inside the limit.');
    b.text('m1', 1, 'Old quarry moved the most.');
    b.end(['u1']);
    const store = await storeWith(b.events);
    const rows = store.rows();
    const [first, second] = rows.filter((row): row is Answer => row.kind === 'assistant_text');
    for (const drawn of [rows, rows.filter((row) => row !== second)]) {
      const answers = new AnswerActionsStore();
      answers.publish(answerActionsOf(drawn));
      const holder = drawn.includes(second!) ? second! : first!;
      expect(answers.get(holder.id)).toBeDefined();
      renderRow(holder, { storeKey: store.key, answerActions: answers });
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      cleanup();
    }
    expect(writeText.mock.calls).toEqual([['All five stations are inside the limit.\n\nOld quarry moved the most.'], ['All five stations are inside the limit.\n\nOld quarry moved the most.']]);
  });
});

describe('Fork from here', () => {
  it('forks this session from before the next prompt, or the whole conversation under the last answer', () => {
    const run = vi.fn(async () => {});
    const row = answerRow();
    renderRow(row, { storeKey: KEY, actions: actionsWith(forkWith({ run })), answerActions: placed(row, { rewindTo: 'u2' }) });
    fireEvent.click(fork()!);
    cleanup();
    renderRow(row, { storeKey: KEY, actions: actionsWith(forkWith({ run })), answerActions: placed(row, { rewindTo: null }) });
    fireEvent.click(fork()!);
    expect(run.mock.calls).toEqual([[KEY, 'u2'], [KEY, null]]);
  });

  it('is disabled and busy while its act is out, a second press calls nothing, and it is enabled again once the act settles', async () => {
    let settle: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    const row = answerRow();
    renderRow(row, { storeKey: KEY, actions: actionsWith(forkWith({ run })), answerActions: placed(row, { rewindTo: 'u2' }) });
    fireEvent.click(fork()!);
    expect(fork()!.disabled).toBe(true);
    expect(fork()!.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(fork()!);
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => settle());
    expect(fork()!.disabled).toBe(false);
    expect(fork()!.hasAttribute('aria-busy')).toBe(false);
  });

  it('is disabled with the mount’s sentence as its title and description, and a press does nothing', () => {
    const run = vi.fn(async () => {});
    const sentence = 'Fork is unavailable while mini is offline.';
    const row = answerRow();
    renderRow(row, { storeKey: KEY, actions: actionsWith(forkWith({ run, useUnavailable: () => sentence })), answerActions: placed(row, { rewindTo: 'u2' }) });
    expect(fork()!.disabled).toBe(true);
    expect(fork()!.title).toBe(sentence);
    expect(fork()!.getAttribute('aria-description')).toBe(sentence);
    fireEvent.click(fork()!);
    expect(run).not.toHaveBeenCalled();
  });
});

// Acceptance 9 (UC-7): the app's adapter, U9's own two names, for a session MAWS runs on another machine.
describe('Fork from here for a session on another machine', () => {
  const R = addressOf(OTHER_MACHINE, 'app-far' as AppSessionId);
  const MINI: MachineState = { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-11-15T10:00:00.000Z', generation: 1, carrier: 'relay' };
  const roster = (over: Partial<MachineState>) => useMachines.getState().applyRoster([{ ...MINI, ...over }]);
  const listing = (state: string) => useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-far', { state }), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
  const SERVES = { capabilities: [SESSION_ACTS_CAPABILITY], owner: true };
  const adapter = { useUnavailable: useForkUnavailable, run: forkInPlace };
  const row = answerRow();
  const draw = () => renderRow(row, { storeKey: R, actions: actionsWith(adapter), answerActions: placed(row, { rewindTo: 'u-next' }) });
  let client = fakeClient();
  beforeEach(() => {
    client = fakeClient();
    window.maws = client.client as unknown as PreloadBridge;
    resetRemoteSurfaces();
    resetRemoteLaneBStore();
    listing('idle');
  });
  afterEach(() => {
    cleanup();
    useNotices.setState({ notices: [] });
    useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    delete (window as { maws?: unknown }).maws;
  });

  const states: [string, () => void][] = [
    ['offline', () => roster({ ...SERVES, state: 'down', generation: 0, since: new Date().toISOString() })],
    ['connecting', () => roster({ ...SERVES, state: 'connecting', generation: 0 })],
    ['on an older build', () => roster({ capabilities: [], owner: true })],
    ['not an owner', () => roster({ ...SERVES, owner: false })],
    ['a turn running', () => (roster(SERVES), listing('busy'))],
  ];
  for (const [name, arrange] of states) {
    it(`is disabled and described by U9’s sentence: ${name}`, () => {
      arrange();
      const sentence = renderHook(() => useForkUnavailable(R)).result.current;
      expect(sentence).not.toBeNull();
      draw();
      expect(fork()!.disabled).toBe(true);
      expect(fork()!.title).toBe(sentence);
      expect(fork()!.getAttribute('aria-description')).toBe(sentence);
    });
  }

  it('is enabled where U9 gives no sentence, and sends what the machine’s offer of session.fork accepts', async () => {
    roster(SERVES);
    draw();
    expect(fork()!.disabled).toBe(false);
    fireEvent.click(fork()!);
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const [input] = client.invoked('session.fork');
    expect(input).toEqual({ appSessionId: 'app-far', target: { kind: 'inPlace' }, message: null, rewindTo: 'u-next' });
    expect(OFFERS.commands['session.fork']!.accepts!(input)).toBe(true);
    await act(() => client.fail('session.fork', 'The session is working; try again when it’s done.'));
    expect(useNotices.getState().notices.map((notice) => notice.text)).toContain('The session is working; try again when it’s done.'); // a refusal is the act's toast
    expect(fork()!.disabled).toBe(false);
  });
});
