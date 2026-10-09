// The cards' actions (the P2-C document, Design §6 and §8; M6): a choice and a Reply through a fake seam per
// disposition, each result reported to main whatever it was; Sending… and Starting…; Reply's field, its keys and the
// composer's focus after it; Cancel's outcomes; Retry; Answer again; Take over; Mark read and Mark all read.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { CommandInput } from '@shared/ipc/schema';
import { markIdOf } from '@shared/owner/marks';
import type { OwnerChannelState, OwnerMark, QuestionState } from '@shared/owner/state';
import { fakeClient } from '../../../../../test/support/fake-client';
import { record } from '../../../../../test/support/builders';
import type { HumanPromptOptions, HumanPromptResult } from '../../composer/submit/send-human-prompt';
import { resetOwnerChannelStore, useOwnerChannelStore } from '../../stores/owner-channel';
import { useComposerStore } from '../../stores/composer';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { OwnerReport } from './OwnerReport';
import { ReportBar } from './ReportBar';
import { reportOf } from './answering';

const hold = vi.hoisted(() => ({
  client: null as ReturnType<typeof import('../../../../../test/support/fake-client').fakeClient>['client'] | null,
  seam: null as null | ((appSessionId: string, content: unknown, options: HumanPromptOptions) => Promise<HumanPromptResult>),
  takeOver: vi.fn(),
}));
vi.mock('../../ipc/client', () => ({ ipc: { invoke: (...args: unknown[]) => (hold.client!.invoke as (...a: unknown[]) => unknown)(...args), on: (...args: unknown[]) => (hold.client!.on as (...a: unknown[]) => unknown)(...args) } }));
vi.mock('../../composer/submit/send-human-prompt', () => ({ sendHumanPrompt: (id: string, content: unknown, options: HumanPromptOptions) => hold.seam!(id, content, options) }));
vi.mock('../../sessions/record-ops', () => ({ canTakeOver: () => true, takeOverSession: (...args: unknown[]) => hold.takeOver(...args) }));

const APP = 'app-answer' as AppSessionId;
const UUID = 'm-1' as MessageUuid;
const anchor = { messageUuid: UUID, blockIndex: 0 };
const Q = markIdOf(APP, 'need-input', { ...anchor, span: 0 });
const QUESTION = '<need-input>Which backend?\n<choice recommended>Postgres</choice>\n<choice>SQLite</choice>\n</need-input>';
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

let fake: ReturnType<typeof fakeClient>;
let sends: { content: unknown; options: HumanPromptOptions }[];
let focusFrame: ReturnType<typeof vi.fn>;
let insertText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fake = fakeClient({ 'ownerChannel.answered': undefined, 'ownerChannel.markRead': undefined });
  hold.client = fake.client;
  sends = [];
  hold.takeOver.mockReset();
  focusFrame = vi.fn();
  insertText = vi.fn();
  useComposerStore.setState({ focusTargets: new Map([[APP, { focusEditor: vi.fn(), focusFrame, insertText } as never]]) });
  useSessions.setState({ records: new Map([[APP, record(APP)]]), engine: new Map([[APP, { process: 'ready' } as never]]) });
});
afterEach(() => {
  cleanup();
  resetOwnerChannelStore();
  useSessions.setState({ records: new Map(), engine: new Map() });
  useComposerStore.setState({ focusTargets: new Map() });
});

const question = (state: QuestionState, id = Q): OwnerMark => ({ id, kind: 'need-input', anchor: { ...anchor, span: 0 }, head: 'Which backend?', at: '2026-10-09T10:00:00.000Z', item: true, question: state });
function withMarks(marks: OwnerMark[]) {
  const state: OwnerChannelState = { appSessionId: APP, lane: { on: true, override: 'inherit', applied: 'maws-contract', pending: null, mismatch: null }, marks };
  useOwnerChannelStore.setState({ bySession: new Map([[APP, state]]) });
}
// The seam answers each send with `result`, at once or when the test releases it.
function seam(result: HumanPromptResult | (() => Promise<HumanPromptResult>)) {
  hold.seam = (_id, content, options) => {
    sends.push({ content, options });
    return typeof result === 'function' ? result() : Promise.resolve(result);
  };
}
const draw = (text = QUESTION) => render(<OwnerReport appSessionId={APP} text={text} live={false} showRecord recordKey="k" anchor={anchor} />);
const reports = () => fake.invoked('ownerChannel.answered') as CommandInput<'ownerChannel.answered'>[];
const choice = (name: RegExp) => within(screen.getByRole('group', { name: 'Choices' })).getByRole('button', { name });

describe('a choice is sent through the seam and its result reported to main, whatever it was', () => {
  const cases: [string, HumanPromptResult, Partial<CommandInput<'ownerChannel.answered'>>][] = [
    ['sent', { disposition: 'sent', started: false, messageUuid: 'u-1' as MessageUuid }, { disposition: 'sent', started: false, messageUuid: 'u-1' as MessageUuid }],
    ['steered', { disposition: 'steered', started: false, messageUuid: 'u-2' as MessageUuid }, { disposition: 'steered', messageUuid: 'u-2' as MessageUuid }],
    ['queued', { disposition: 'queued', started: false, queueId: 'q-1' }, { disposition: 'queued', queueId: 'q-1' }],
    ['started (a send that acquired the session)', { disposition: 'sent', started: true, messageUuid: 'u-3' as MessageUuid }, { disposition: 'sent', started: true, messageUuid: 'u-3' as MessageUuid }],
    ['refused', { disposition: 'refused', started: false, reason: 'Held by a terminal' }, { disposition: 'refused', reason: 'Held by a terminal' }],
  ];
  it.each(cases)('%s', async (_name, result, reported) => {
    withMarks([question({ state: 'unanswered' })]);
    seam(result);
    draw();
    fireEvent.click(choice(/^Postgres/));
    await settle();
    expect(sends).toEqual([{ content: 'Answering "Which backend?": Postgres', options: { origin: 'answer' } }]);
    expect(reports()).toEqual([{ appSessionId: APP, markId: Q, text: 'Answering "Which backend?": Postgres', origin: 'answer', ...{ started: false }, ...reported }]);
  });

  it('a seam that throws is reported as a refusal in its words; `held`, the composer’s alone, reads as one too', async () => {
    withMarks([question({ state: 'unanswered' })]);
    seam(() => Promise.reject(new Error('main is unreachable')));
    draw();
    fireEvent.click(choice(/^SQLite/));
    await settle();
    expect(reports()[0]).toMatchObject({ disposition: 'refused', started: false, reason: 'main is unreachable', text: 'Answering "Which backend?": SQLite' });
    expect(reportOf(APP, Q, { text: 't', origin: 'answer' }, { disposition: 'held', started: false, reason: 'trust' })).toMatchObject({ disposition: 'refused', reason: 'trust' });
  });

  it('reads Sending… while the seam answers, offers nothing meanwhile, and one click is one answer', async () => {
    withMarks([question({ state: 'unanswered' })]);
    let release!: (result: HumanPromptResult) => void;
    seam(() => new Promise((resolve) => (release = resolve)));
    draw();
    fireEvent.click(choice(/^Postgres/));
    await settle();
    expect(screen.getByRole('status').textContent).toBe('Sending…');
    expect(choice(/^SQLite/)).toHaveProperty('disabled', true);
    fireEvent.click(choice(/^Postgres/));
    expect(sends).toHaveLength(1);
    await act(async () => release({ disposition: 'sent', started: false, messageUuid: 'u-1' as MessageUuid }));
    await settle();
    expect(screen.queryByText('Sending…')).toBeNull();
    expect(reports()).toHaveLength(1);
  });

  it('reads Starting… when the session has no ready process, since the send starts it first', async () => {
    useSessions.setState({ engine: new Map() });
    withMarks([question({ state: 'unanswered' })]);
    seam(() => new Promise(() => {}));
    draw();
    fireEvent.click(choice(/^Postgres/));
    await settle();
    expect(screen.getByRole('status').textContent).toBe('Starting…');
  });

  it('a question main has no row for yet (still streaming) offers nothing to send', () => {
    seam({ disposition: 'sent', started: false });
    draw();
    expect(choice(/^Postgres/)).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Reply' })).toHaveProperty('disabled', true);
  });
});

describe('Reply', () => {
  it('opens a field on the card: Enter sends the text under the question’s head, the field closes and the composer takes the keyboard, its draft untouched', async () => {
    withMarks([question({ state: 'unanswered' })]);
    seam({ disposition: 'queued', started: false, queueId: 'q-9' });
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const field = screen.getByRole('textbox', { name: 'Your answer' });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: 'SQLite, and\nkeep it small' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true }); // Shift-Enter breaks the line: nothing sent
    expect(sends).toHaveLength(0);
    fireEvent.keyDown(field, { key: 'Enter' });
    await settle();
    expect(sends).toEqual([{ content: 'Answering "Which backend?": SQLite, and\nkeep it small', options: { origin: 'reply' } }]);
    expect(reports()[0]).toMatchObject({ origin: 'reply', disposition: 'queued', queueId: 'q-9' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(focusFrame).toHaveBeenCalledTimes(1);
    expect(insertText).not.toHaveBeenCalled(); // the composer's draft is never written
  });

  it('a refused reply keeps the field and its text, and says why; Escape closes the field', async () => {
    withMarks([question({ state: 'delivered', answer: { text: 'Answering "Which backend?": Postgres', origin: 'answer', at: '2026-10-09T10:02:00.000Z' } })]);
    seam({ disposition: 'refused', started: false, reason: 'Trust this folder in the session to continue' });
    draw();
    expect(screen.queryByRole('group', { name: 'Choices' })).toBeNull(); // answered: a follow-up is a Reply
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const field = screen.getByRole('textbox', { name: 'Your answer' });
    fireEvent.change(field, { target: { value: 'Actually SQLite' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await settle();
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('Actually SQLite');
    expect(screen.getByText('Trust this folder in the session to continue')).toBeTruthy();
    expect(focusFrame).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your answer' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('the other actions', () => {
  it('Retry sends the last answer again after main reported its refusal', async () => {
    withMarks([question({ state: 'unanswered' })]);
    seam({ disposition: 'refused', started: false, reason: 'The relay is unreachable' });
    const view = draw();
    fireEvent.click(choice(/^SQLite/));
    await settle();
    withMarks([question({ state: 'unanswered', failed: { reason: 'The relay is unreachable' } })]);
    view.rerender(<OwnerReport appSessionId={APP} text={QUESTION} live={false} showRecord recordKey="k" anchor={anchor} />);
    expect(screen.getAllByText('The relay is unreachable')).toHaveLength(1); // said once, on the state line
    seam({ disposition: 'sent', started: false, messageUuid: 'u-5' as MessageUuid });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(sends.map((s) => s.content)).toEqual(['Answering "Which backend?": SQLite', 'Answering "Which backend?": SQLite']);
  });

  it('Answer again on an unconfirmed answer offers the choices and Reply again, and sends a new answer', async () => {
    withMarks([question({ state: 'unconfirmed', text: 'Answering "Which backend?": Postgres', origin: 'answer', members: [] })]);
    seam({ disposition: 'sent', started: false, messageUuid: 'u-6' as MessageUuid });
    draw();
    expect(screen.queryByRole('group', { name: 'Choices' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Answer again' }));
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
    fireEvent.click(choice(/^SQLite/));
    await settle();
    expect(reports()[0]).toMatchObject({ text: 'Answering "Which backend?": SQLite', disposition: 'sent', messageUuid: 'u-6' });
  });

  it.each([
    ['cancelled', null],
    ['not_queued', null],
    ['already_delivering', 'Already on its way'],
  ] as const)('Cancel answered %s', async (outcome, note) => {
    withMarks([question({ state: 'queued', text: 'Answering "Which backend?": Postgres', origin: 'answer', members: [] })]);
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fake.invoked('ownerChannel.cancel')).toEqual([{ appSessionId: APP, markId: Q }]);
    await act(() => fake.reply('ownerChannel.cancel', { outcome }));
    expect(screen.queryByText('Already on its way') === null).toBe(note === null);
  });

  it('a failed Cancel says why and leaves the answer queued', async () => {
    withMarks([question({ state: 'queued', text: 'Answering "Which backend?": Postgres', origin: 'answer', members: [] })]);
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(() => fake.fail('ownerChannel.cancel', 'the host is unreachable'));
    expect(screen.getByText('the host is unreachable')).toBeTruthy();
    expect(screen.getByText(/Queued — sends when the agent reaches a pause/)).toBeTruthy();
  });

  it('a session held in a terminal offers Take over and nothing to answer', () => {
    const holder = { kind: 'terminal', pid: 42 } as const;
    useSessions.setState({ records: new Map([[APP, record(APP, { holder } as never)]]) });
    withMarks([question({ state: 'unanswered' })]);
    draw();
    expect(screen.queryByRole('group', { name: 'Choices' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Take over here' }));
    expect(hold.takeOver).toHaveBeenCalledWith(APP, holder);
  });

  it('Mark read reads one essential; the report’s top reads them all', () => {
    const essential = (span: number): OwnerMark => ({ id: markIdOf(APP, 'essential', { ...anchor, span }), kind: 'essential', anchor: { ...anchor, span }, head: 'x', at: '2026-10-09T10:00:00.000Z', item: true, essential: { state: 'unread', readAt: null } });
    withMarks([essential(0), essential(1)]);
    draw('<essential>One.</essential><essential>Two.</essential>');
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark read' })[1]!);
    expect(fake.invoked('ownerChannel.markRead')).toEqual([{ appSessionId: APP, markIds: [markIdOf(APP, 'essential', { ...anchor, span: 1 })] }]);
    cleanup();
    useTranscriptStore.setState({ entries: { [APP]: { state: { ui: { ownerLane: true } } } as never } });
    render(<ReportBar appSessionId={APP} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(fake.invoked('ownerChannel.markRead').at(-1)).toEqual({ appSessionId: APP, markIds: 'all' });
    useTranscriptStore.setState({ entries: {} });
  });
});
