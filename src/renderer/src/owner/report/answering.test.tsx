// The cards' actions (the P2-C document, Design §6 and §8; M6): a choice and a Reply through a fake seam per
// disposition, each result reported to main whatever it was; Sending… and Starting…; Reply's field, its keys and the
// composer's focus after it; Cancel's outcomes; Retry; Answer again; Take over; Mark read and Mark all read; a held
// send in the held words; a report or a command that fails, as an envelope or a rejected invoke, said where it was asked.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { CommandInput, CommandName, MawsBridge } from '@shared/ipc/schema';
import { markIdOf } from '@shared/owner/marks';
import type { OwnerChannelState, OwnerMark, QuestionState } from '@shared/owner/state';
import { fakeClient } from '../../../../../test/support/fake-client';
import { record } from '../../../../../test/support/builders';
import type { HumanPromptOptions, HumanPromptResult } from '../../composer/submit/send-human-prompt';
import { resetOwnerChannelStore, useOwnerChannelStore } from '../../stores/owner-channel';
import { useComposerStore } from '../../stores/composer';
import { useNotices } from '../../stores/notices';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { TRUST_FIRST } from '../../sessions/acquire';
import { OwnerReport } from './OwnerReport';
import { ReportBar } from './ReportBar';
import { reportOf, resetUnreportedAnswers } from './answering';

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
  resetUnreportedAnswers();
  useSessions.setState({ records: new Map(), engine: new Map() });
  useComposerStore.setState({ focusTargets: new Map() });
  useNotices.setState({ notices: [] });
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
// The next `times` invocations of `name` fail: main's failure envelope, or the bridge's rejected invoke.
function failing(name: CommandName, how: 'envelope' | 'reject', message = 'the index is unavailable', times = 1) {
  let left = times;
  hold.client = {
    ...fake.client,
    invoke: (n: CommandName, input: unknown) => {
      const answered = (fake.client.invoke as (n: CommandName, i: unknown) => Promise<unknown>)(n, input);
      if (n !== name || left <= 0) return answered;
      left -= 1;
      return how === 'reject' ? Promise.reject(new Error(message)) : Promise.resolve({ ok: false, error: { code: 'internal', message } });
    },
  } as MawsBridge;
}

describe('a choice is sent through the seam and its result reported to main, whatever it was', () => {
  const cases: [string, HumanPromptResult, Partial<CommandInput<'ownerChannel.answered'>>][] = [
    ['sent', { disposition: 'sent', started: false, messageUuid: 'u-1' as MessageUuid }, { disposition: 'sent', started: false, messageUuid: 'u-1' as MessageUuid }],
    ['steered', { disposition: 'steered', started: false, messageUuid: 'u-2' as MessageUuid }, { disposition: 'steered', messageUuid: 'u-2' as MessageUuid }],
    ['queued', { disposition: 'queued', started: false, queueId: 'q-1' }, { disposition: 'queued', queueId: 'q-1' }],
    ['started (a send that acquired the session)', { disposition: 'sent', started: true, messageUuid: 'u-3' as MessageUuid }, { disposition: 'sent', started: true, messageUuid: 'u-3' as MessageUuid }],
    ['refused', { disposition: 'refused', started: false, reason: 'Held by a terminal' }, { disposition: 'refused', reason: 'Held by a terminal' }],
    ['held', { disposition: 'held', started: false, reason: 'trust' }, { disposition: 'held', reason: 'trust' }],
  ];
  it.each(cases)('%s', async (_name, result, reported) => {
    withMarks([question({ state: 'unanswered' })]);
    seam(result);
    draw();
    fireEvent.click(choice(/^Postgres/));
    await settle();
    expect(sends).toEqual([{ content: 'Answering "Which backend?": Postgres', options: { origin: 'answer' } }]);
    expect(reports()).toEqual([{ appSessionId: APP, markId: Q, text: 'Answering "Which backend?": Postgres', origin: 'answer', ...{ started: false }, ...reported, sentAt: expect.any(String) }]);
  });

  it('a seam that throws is reported as a refusal in its words; `held` is reported as held, never as a refusal', async () => {
    withMarks([question({ state: 'unanswered' })]);
    seam(() => Promise.reject(new Error('main is unreachable')));
    draw();
    fireEvent.click(choice(/^SQLite/));
    await settle();
    expect(reports()[0]).toMatchObject({ disposition: 'refused', started: false, reason: 'main is unreachable', text: 'Answering "Which backend?": SQLite' });
    expect(reportOf(APP, Q, { text: 't', origin: 'answer' }, { disposition: 'held', started: false, reason: 'trust' })).toMatchObject({ disposition: 'held', reason: 'trust' });
  });

  it('a held send says the card holding it, in its words, with Retry, and never reads as sent', async () => {
    withMarks([question({ state: 'unanswered' })]);
    seam({ disposition: 'held', started: false, reason: 'trust' });
    const view = draw();
    fireEvent.click(choice(/^Postgres/));
    await settle();
    expect(screen.getByText(TRUST_FIRST)).toBeTruthy(); // the card's own note until main's state arrives
    withMarks([question({ state: 'unanswered', held: { reason: 'trust' } })]);
    view.rerender(<OwnerReport appSessionId={APP} text={QUESTION} live={false} showRecord recordKey="k" anchor={anchor} />);
    expect(screen.getAllByText(TRUST_FIRST)).toHaveLength(1); // said once, on the state line
    expect(screen.queryByText('Sent — not confirmed')).toBeNull();
    seam({ disposition: 'sent', started: true, messageUuid: 'u-7' as MessageUuid });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(reports().map((r) => r.disposition)).toEqual(['held', 'sent']);
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

  it('Escape and Close each close the field and give the keyboard back to the card’s Reply', () => {
    withMarks([question({ state: 'unanswered' })]);
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your answer' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();
    fireEvent.click(close);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reply' }));
  });

  it('an open field and its unsent text survive opening and closing the working record around the question', () => {
    withMarks([question({ state: 'unanswered' })]);
    const text = `Working notes.\n${QUESTION}`;
    const view = render(<OwnerReport appSessionId={APP} text={text} live={false} showRecord={false} recordKey="k" anchor={anchor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Half a thought' } });
    view.rerender(<OwnerReport appSessionId={APP} text={text} live={false} showRecord recordKey="k" anchor={anchor} />);
    expect(view.container.textContent).toContain('Working notes.');
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('Half a thought');
    view.rerender(<OwnerReport appSessionId={APP} text={text} live={false} showRecord={false} recordKey="k" anchor={anchor} />);
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('Half a thought');
  });

  it('Escape while an input method composes leaves the field open for the input method to cancel', () => {
    withMarks([question({ state: 'unanswered' })]);
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const field = screen.getByRole('textbox', { name: 'Your answer' });
    fireEvent.change(field, { target: { value: '한' } });
    const composing = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true });
    field.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('한');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your answer' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
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

describe('a report main never got is said on the card and can be made again, without sending the prompt again', () => {
  it.each(['envelope', 'reject'] as const)('a choice whose report failed (%s)', async (how) => {
    withMarks([question({ state: 'unanswered', failed: { reason: 'The relay is unreachable' } })]);
    seam({ disposition: 'sent', started: false, messageUuid: 'u-8' as MessageUuid });
    failing('ownerChannel.answered', how);
    draw();
    fireEvent.click(choice(/^Postgres/));
    await settle();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Sent, but MAWS couldn’t record it: the index is unavailable');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull(); // the answer went out: nothing to resend
    fireEvent.click(within(alert).getByRole('button', { name: 'Record again' }));
    await settle();
    expect(sends).toHaveLength(1); // the prompt is never sent again
    expect(reports()).toHaveLength(2);
    expect(reports()[1]).toEqual(reports()[0]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('while Record again is out, the failed state stays and nothing offers to send the answer again', async () => {
    withMarks([question({ state: 'unanswered', failed: { reason: 'The relay is unreachable' } })]);
    seam({ disposition: 'sent', started: false, messageUuid: 'u-10' as MessageUuid });
    let release!: (result: unknown) => void;
    let calls = 0;
    hold.client = {
      ...fake.client,
      invoke: (n: CommandName, input: unknown) => {
        const answered = (fake.client.invoke as (n: CommandName, i: unknown) => Promise<unknown>)(n, input);
        if (n !== 'ownerChannel.answered') return answered;
        calls += 1;
        return calls === 1 ? Promise.resolve({ ok: false, error: { code: 'internal', message: 'the index is unavailable' } }) : new Promise<unknown>((resolve) => (release = resolve));
      },
    } as MawsBridge;
    draw();
    fireEvent.click(choice(/^Postgres/));
    await settle();
    expect(reports()[0]!.sentAt).toMatch(/^\d{4}-\d\d-\d\dT/); // the seam's call time, for main to reach back to
    fireEvent.click(screen.getByRole('button', { name: 'Record again' }));
    await settle();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull(); // the recording is still out
    expect(screen.getByRole('button', { name: 'Record again' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Record again' }));
    expect(reports()).toHaveLength(2);
    await act(async () => release({ ok: true, value: undefined }));
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(sends).toHaveLength(1);
    expect(reports()[1]).toEqual(reports()[0]); // the same report, its sentAt included
  });

  it('a reply whose report failed closes its field (the prompt left) and keeps the keyboard on the card', async () => {
    withMarks([question({ state: 'unanswered' })]);
    seam({ disposition: 'steered', started: false, messageUuid: 'u-9' as MessageUuid });
    failing('ownerChannel.answered', 'reject', 'the bridge is gone');
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'SQLite' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your answer' }), { key: 'Enter' });
    await settle();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(focusFrame).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reply' }));
    expect(screen.getByRole('alert').textContent).toContain('Sent, but MAWS couldn’t record it: the bridge is gone');
  });

  it('outlives its card: a card scrolled out of the transcript and back still says it and can make it again', async () => {
    withMarks([question({ state: 'unanswered' })]);
    seam({ disposition: 'queued', started: false, queueId: 'q-7' });
    failing('ownerChannel.answered', 'envelope');
    const first = draw();
    fireEvent.click(choice(/^Postgres/));
    await settle();
    first.unmount(); // the transcript mounts only the rows in view
    draw();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Sent, but MAWS couldn’t record it: the index is unavailable');
    fireEvent.click(within(alert).getByRole('button', { name: 'Record again' }));
    await settle();
    expect(sends).toHaveLength(1);
    expect(reports()).toHaveLength(2);
    expect(reports()[1]).toEqual(reports()[0]); // its queueId included, for main to follow and Cancel
    expect(reports()[1]!.queueId).toBe('q-7');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a send still out when its card leaves the view is kept when its report fails', async () => {
    withMarks([question({ state: 'unanswered' })]);
    let answer!: (result: HumanPromptResult) => void;
    seam(() => new Promise<HumanPromptResult>((resolve) => (answer = resolve)));
    failing('ownerChannel.answered', 'reject', 'the bridge is gone');
    const first = draw();
    fireEvent.click(choice(/^Postgres/));
    first.unmount();
    await act(async () => answer({ disposition: 'sent', started: false, messageUuid: 'u-11' as MessageUuid }));
    await settle();
    draw();
    expect(screen.getByRole('alert').textContent).toContain('Sent, but MAWS couldn’t record it: the bridge is gone');
    expect(screen.getByRole('button', { name: 'Record again' })).toBeTruthy();
  });

  it('a refusal whose report failed is still said on the card, with nothing to record', async () => {
    withMarks([question({ state: 'unanswered' })]);
    seam({ disposition: 'refused', started: false, reason: 'The session has ended' });
    failing('ownerChannel.answered', 'envelope');
    draw();
    fireEvent.click(choice(/^Postgres/));
    await settle();
    expect(screen.getByText('The session has ended')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record again' })).toBeNull();
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

  it('a Cancel whose invoke is rejected says why', async () => {
    withMarks([question({ state: 'queued', text: 'Answering "Which backend?": Postgres', origin: 'answer', members: [] })]);
    failing('ownerChannel.cancel', 'reject', 'the bridge is gone');
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(screen.getByText('the bridge is gone')).toBeTruthy();
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

describe('a Mark read that failed says so', () => {
  const essential: OwnerMark = { id: markIdOf(APP, 'essential', { ...anchor, span: 0 }), kind: 'essential', anchor: { ...anchor, span: 0 }, head: 'x', at: '2026-10-09T10:00:00.000Z', item: true, essential: { state: 'unread', readAt: null } };

  it.each(['envelope', 'reject'] as const)('on the card, which keeps Mark read (%s)', async (how) => {
    withMarks([essential]);
    failing('ownerChannel.markRead', how);
    draw('<essential>One.</essential>');
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Not marked read: the index is unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' })); // the action is the retry
    await settle();
    expect(fake.invoked('ownerChannel.markRead')).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(['envelope', 'reject'] as const)('Mark all read, which has no card, as a toast with Retry (%s)', async (how) => {
    withMarks([essential, { ...essential, id: markIdOf(APP, 'essential', { ...anchor, span: 1 }), anchor: { ...anchor, span: 1 } }]);
    useTranscriptStore.setState({ entries: { [APP]: { state: { ui: { ownerLane: true } } } as never } });
    failing('ownerChannel.markRead', how);
    render(<ReportBar appSessionId={APP} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await settle();
    const [notice] = useNotices.getState().notices;
    expect(notice).toMatchObject({ kind: 'toast', text: 'Must-reads not marked read: the index is unavailable', actions: [{ label: 'Retry' }] });
    await act(async () => notice!.actions[0]!.run());
    await settle();
    expect(fake.invoked('ownerChannel.markRead')).toEqual([{ appSessionId: APP, markIds: 'all' }, { appSessionId: APP, markIds: 'all' }]);
    useTranscriptStore.setState({ entries: {} });
  });
});
