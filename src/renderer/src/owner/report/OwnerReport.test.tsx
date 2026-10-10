// The report module's cards (the P2-C document, Design §8), drawn from main's state for each mark (M5: state only, no
// action wired; a control without its handler is disabled).
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { markIdOf } from '@shared/owner/marks';
import type { OwnerChannelState, OwnerMark, QuestionState } from '@shared/owner/state';
import { record } from '../../../../../test/support/builders';
import { resetOwnerChannelStore, useOwnerChannelStore } from '../../stores/owner-channel';
import { useSessions } from '../../stores/sessions';
import { OwnerReport } from './OwnerReport';
import { answerOf } from './QuestionCard';

const APP = 'app-owner' as AppSessionId;
const UUID = 'm-1' as MessageUuid;
const anchor = { messageUuid: UUID, blockIndex: 0 };

afterEach(() => {
  cleanup();
  resetOwnerChannelStore();
  useSessions.setState({ records: new Map() });
});

const question = (span: number, state: QuestionState, item = true): OwnerMark => ({
  id: markIdOf(APP, 'need-input', { ...anchor, span }), kind: 'need-input', anchor: { ...anchor, span }, head: 'Which?', at: '2026-10-09T10:00:00.000Z', item, question: state,
});
const essential = (span: number, state: 'unread' | 'read', item = true): OwnerMark => ({
  id: markIdOf(APP, 'essential', { ...anchor, span }), kind: 'essential', anchor: { ...anchor, span }, head: 'Mind it.', at: '2026-10-09T10:00:00.000Z', item, essential: { state, readAt: state === 'read' ? '2026-10-09T10:01:00.000Z' : null },
});
function withMarks(marks: OwnerMark[]) {
  const state: OwnerChannelState = { appSessionId: APP, lane: { on: true, override: 'inherit', applied: 'maws-contract', pending: null, mismatch: null }, marks };
  useOwnerChannelStore.setState({ bySession: new Map([[APP, state]]) });
}
const draw = (text: string, over: { showRecord?: boolean; live?: boolean } = {}) =>
  render(<OwnerReport appSessionId={APP} text={text} live={over.live ?? false} showRecord={over.showRecord ?? true} recordKey="k" anchor={anchor} />);
const labels = (container: HTMLElement) => [...container.querySelectorAll('.owner-card-label')].map((label) => label.textContent);

const QUESTION = '<need-input>Which backend?\n<choice recommended>Postgres</choice>\n<choice>SQLite</choice>\n</need-input>';

describe('the report module draws one text’s marks as cards', () => {
  it('in the text’s order, a nested mark splitting its outer one; an insight follows what it explains', () => {
    const view = draw('<to-human>Plan.\n<insight>Why this.</insight>\n<essential>Risk.</essential>\n<need-input>Which?\n<choice>A</choice>\n</need-input>\nAfter.</to-human>');
    expect(labels(view.container)).toEqual(['Message', 'Insight', 'Must read', 'Question', 'Message']);
    const first = view.container.querySelector('.owner-report-item')!;
    expect(first.querySelector('[data-owner-card="to-human"]')?.textContent).toContain('Plan.');
    expect(first.querySelector('.owner-insights')?.getAttribute('data-placement')).toBe('inline'); // no layout here: no measured margin
    expect(view.container.textContent).not.toContain('<');
  });

  it('shows the words outside the marks only while the record is shown', () => {
    expect(draw('Working notes. <to-human>For you.</to-human>').container.textContent).toContain('Working notes.');
    cleanup();
    const folded = draw('Working notes. <to-human>For you.</to-human>', { showRecord: false });
    expect(folded.container.textContent).not.toContain('Working notes.');
    expect(folded.container.textContent).toContain('For you.');
  });

  it('a question with no state yet is unanswered: its choices in order, the recommended one said, none pressed, and Reply', () => {
    draw(QUESTION);
    const group = screen.getByRole('group', { name: 'Choices' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['PostgresRecommended', 'SQLite']);
    expect(within(group).getAllByRole('button').every((b) => b.getAttribute('aria-pressed') === null)).toBe(true);
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
    expect(screen.getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true); // M5: nothing is wired
  });

  it('draws each state main reports for a question', () => {
    withMarks([question(0, { state: 'unanswered', failed: { reason: 'The session has ended.' } })]);
    const failed = draw(QUESTION);
    expect(screen.getByText('The session has ended.')).toBeTruthy();
    failed.unmount();

    withMarks([question(0, { state: 'queued', text: 'Answering "Which backend?": Postgres', origin: 'answer', members: [] })]);
    const queued = draw(QUESTION);
    expect(screen.getByText(/Queued — sends when the agent reaches a pause/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Choices' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
    queued.unmount();

    withMarks([question(0, { state: 'unconfirmed', text: 'Answering "Which backend?": Postgres', origin: 'answer', members: [] })]);
    const unconfirmed = draw(QUESTION);
    expect(screen.getByText(/Sent — not confirmed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Answer again' })).toBeTruthy();
    unconfirmed.unmount();

    withMarks([question(0, { state: 'delivered', answer: { text: 'Answering "Which backend?": SQLite, and keep it small\nplease', origin: 'reply', at: '2026-10-09T10:02:00.000Z' } })]);
    const delivered = draw(QUESTION);
    expect(delivered.container.querySelector('[data-answered]')?.textContent).toBe('Answered: SQLite, and keep it small\nplease');
    expect(screen.queryByRole('group', { name: 'Choices' })).toBeNull(); // answered: the choices go, Reply stays for a follow-up
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
  });

  it('matches each question to its own state by its ordinal, so two identical questions stay distinct', () => {
    withMarks([question(1, { state: 'delivered', answer: { text: 'Answering "Which?": B', origin: 'answer', at: '2026-10-09T10:02:00.000Z' } })]);
    const view = draw('<need-input>Which?\n<choice>A</choice>\n<choice>B</choice>\n</need-input>\n<essential>Between.</essential>\n<need-input>Which?\n<choice>A</choice>\n<choice>B</choice>\n</need-input>');
    expect([...view.container.querySelectorAll('[data-owner-card="need-input"]')].map((card) => card.getAttribute('data-state'))).toEqual(['unanswered', 'delivered']);
  });

  it('a session held in a terminal offers nothing to answer, and says where it is', () => {
    useSessions.setState({ records: new Map([[APP, record(APP, { holder: { kind: 'terminal', pid: 42 } as never })]]) });
    draw(QUESTION);
    expect(screen.getByText('This session is open in a terminal')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('an essential is a must-read until read, then keeps its words and says Read; before the watermark it draws read', () => {
    withMarks([essential(0, 'unread'), essential(1, 'read'), essential(2, 'unread', false)]);
    const view = draw('<essential>One.</essential><essential>Two.</essential><essential>Three.</essential>');
    const cards = [...view.container.querySelectorAll('[data-owner-card="essential"]')];
    expect(cards.map((card) => card.getAttribute('data-state'))).toEqual(['unread', 'read', 'read']);
    expect(within(cards[0] as HTMLElement).getByRole('button', { name: 'Mark read' })).toBeTruthy();
    expect(cards[1].textContent).toBe('Must readTwo.Read');
    expect(cards[2].textContent).toBe('Must readThree.'); // nothing to clear: no action and no Read
  });

  it('a streaming text draws its open mark as it arrives', () => {
    const view = draw('<to-human>Half a mess', { live: true });
    expect(labels(view.container)).toEqual(['Message']);
    expect(view.container.textContent).toContain('Half a mess');
  });
});

describe('answerOf', () => {
  it('is the answer after its header, the whole prompt when it has none', () => {
    expect(answerOf('Answering "Which?": B')).toBe('B');
    expect(answerOf('Answering "": A\nmore')).toBe('A\nmore');
    expect(answerOf('free text')).toBe('free text');
  });
});
