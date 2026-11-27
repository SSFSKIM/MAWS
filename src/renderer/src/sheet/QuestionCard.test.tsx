// One open question (the composite's §8, "The card"; the C3 plan's §G): its states from its inputs alone, the person's
// edits handed back as a draft, and a carried draft that counts for nothing until kept or edited.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SheetQuestion } from '@shared/sheet/model';
import type { QuestionDraft } from '@shared/sheet/words';
import { QuestionCard, type QuestionCardProps } from './QuestionCard';
import { fixtureHost } from './test-support/fixture-host';
import { CLASH, CLASH_REVISED, FIXTURE, NOTICES, SEASON } from './test-support/questions';

afterEach(cleanup);
const SESSION = '5eed0000-0000-4000-8000-0000000000aa';
const draft = (revision: number, extra: Partial<QuestionDraft> = {}): QuestionDraft => ({ revision, picks: [], text: '', images: [], ...extra });

// `onDraft` is handed an update of the draft as it stands when applied: here, the card's own `draft`, whose result each
// call returns.
function card(question: SheetQuestion, props: Partial<QuestionCardProps> = {}) {
  const handlers = { onDraft: vi.fn((update: (current: QuestionDraft | undefined) => QuestionDraft | null) => update(props.draft)), onDismiss: vi.fn(), onRetract: vi.fn(), onAttach: vi.fn() };
  const view = render(<QuestionCard session={SESSION} question={question} draft={undefined} mark="none" busy={false} host={fixtureHost()} {...handlers} {...props} />);
  return { ...handlers, ...view };
}
const option = (label: string) => screen.getByRole('radio', { name: new RegExp(label) });

describe('QuestionCard', () => {
  it.each(['full', 'compact'] as const)("carries its question's id on its root (%s)", (density) => {
    const { container } = card(CLASH, { density });
    expect(container.firstElementChild?.getAttribute('data-sheet-question')).toBe('q4');
  });

  // The card the side sheet opens at shows where the keyboard is (L5's ruling): the app's focus outline on the root
  // whenever the root itself holds focus, from the open-at request or the keyboard's own moves; a pointer's click inside
  // the card draws none, and focus moving on inside the card takes it away.
  it.each(['full', 'compact'] as const)('draws the focus outline on its root while the root holds focus, and none for a pointer’s click inside (%s)', (density) => {
    const { container } = card(CLASH, { density });
    const root = container.firstElementChild as HTMLElement;
    const ringed = () => root.hasAttribute('data-focus-ring') && root.className.includes('data-[focus-ring]:outline-2') && root.className.includes('outline-accent');
    act(() => root.focus());
    expect(ringed()).toBe(true);
    act(() => root.blur());
    expect(ringed()).toBe(false);
    const inside = root.querySelector('p')!; // the question's sentence: no control of its own, so a click there focuses the root
    fireEvent.pointerDown(inside);
    act(() => root.focus());
    fireEvent.pointerUp(inside);
    fireEvent.click(inside);
    expect(root.hasAttribute('data-focus-ring')).toBe(false);
    act(() => root.blur());
    act(() => root.focus()); // the keyboard back on it: drawn again
    expect(ringed()).toBe(true);
    fireEvent.pointerDown(inside); // a click on the root that already holds focus: the pointer took over
    expect(root.hasAttribute('data-focus-ring')).toBe(false);
    fireEvent.pointerUp(inside);
    act(() => root.focus());
    act(() => root.querySelector<HTMLElement>('button')!.focus()); // on inside the card: the root no longer holds focus
    expect(root.hasAttribute('data-focus-ring')).toBe(false);
  });

  it('draws the head, the question, the numbered options with the recommended mark, the text field and Dismiss', () => {
    card(FIXTURE);
    expect(screen.getByText('q7')).toBeTruthy();
    expect(screen.getByText('Fixture')).toBeTruthy();
    expect(screen.getByText('· from reviewer')).toBeTruthy();
    expect(screen.getByText(FIXTURE.question)).toBeTruthy();
    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe('Type your own answer');
    cleanup();
    card(CLASH);
    expect(option('Keep the earlier sailing').textContent).toMatch(/^1Keep the earlier sailingRecommended/);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('hands back each edit as a draft at the question’s revision: a pick, a multi-select toggle, typed text', () => {
    const { onDraft } = card(CLASH);
    fireEvent.click(option('Keep the longer route'));
    expect(onDraft).toHaveLastReturnedWith(draft(1, { picks: ['Keep the longer route'] }));
    cleanup();
    const multi = card(NOTICES, { draft: draft(1, { picks: ['Tidal restrictions'] }) });
    fireEvent.click(screen.getByRole('checkbox', { name: /Vehicle deck limits/ }));
    expect(multi.onDraft).toHaveLastReturnedWith(draft(1, { picks: ['Tidal restrictions', 'Vehicle deck limits'] }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Tidal restrictions/ }));
    expect(multi.onDraft).toHaveLastReturnedWith(null);
    cleanup();
    const text = card(SEASON);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'From 1 November.' } });
    expect(text.onDraft).toHaveLastReturnedWith(draft(1, { text: 'From 1 November.' }));
  });

  it('dismisses through its handler', () => {
    const { onDismiss } = card(CLASH);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('reads "Updated" when marked; refused as stale it also says why and keeps the draft', () => {
    card(CLASH_REVISED, { mark: 'updated' });
    expect(screen.getByText('Updated')).toBeTruthy();
    expect(screen.queryByText(/The question changed before your answer arrived/)).toBeNull();
    cleanup();
    card(CLASH_REVISED, { mark: 'stale', draft: draft(1, { picks: ['Keep the earlier sailing'], text: 'Shuttle times are the ones people check.' }) });
    expect(screen.getByText('Updated')).toBeTruthy();
    expect(screen.getByText('The question changed before your answer arrived. Your draft is kept.')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Shuttle times are the ones people check.');
  });

  it('draws a draft typed against an earlier revision as carried: not picked, kept only by the person', () => {
    const carried = draft(1, { picks: ['Keep the earlier sailing'], text: 'Shuttle times are the ones people check.' });
    const { onDraft } = card(CLASH_REVISED, { mark: 'updated', draft: carried });
    expect(screen.getByText('You wrote this before the question changed.')).toBeTruthy();
    expect(option('Keep the earlier sailing').getAttribute('aria-checked')).toBe('false');
    expect(option('Keep the earlier sailing').hasAttribute('data-carried')).toBe(true);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(carried.text);
    fireEvent.click(screen.getByRole('button', { name: 'Keep my answer' }));
    expect(onDraft).toHaveLastReturnedWith({ ...carried, revision: 2 });
  });

  it('confirms a carried draft with any edit of the card', () => {
    const { onDraft } = card(CLASH_REVISED, { draft: draft(1, { picks: ['Keep the earlier sailing'], text: 'x' }) });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'xy' } });
    expect(onDraft).toHaveLastReturnedWith(draft(2, { picks: ['Keep the earlier sailing'], text: 'xy' }));
  });

  // The composite's writer (2026-11-27): the stopped sentence only where the session is known stopped
  it.each([
    [true, 'Queued. The session has not picked it up yet.'],
    [undefined, 'Queued. The session has not picked it up yet.'],
    [null, 'Queued. The session has not picked it up yet.'],
    [false, 'Queued. The session is stopped and gets this when it resumes.'],
  ] as const)('says of a queued answer, with the session’s live %s: %s', (live, words) => {
    const queued = { key: 'page-1601a001', kind: 'answer' as const, picks: ['Keep the earlier sailing'], text: '', images: [], revision: 1, by: 'page' as const };
    card({ ...CLASH, queued }, live === undefined ? {} : { live });
    expect(screen.getByText(words)).toBeTruthy();
  });

  it('reads back a queued answer with Take back and Edit; Edit opens a draft that replaces it', () => {
    const queued = { key: 'page-1601a001', kind: 'answer' as const, picks: ['Keep the earlier sailing'], text: 'Shuttle times are the ones people check.', images: [], revision: 1, by: 'page' as const };
    const { onRetract, onDraft } = card({ ...CLASH, queued }, { live: false });
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('Keep the earlier sailing')).toBeTruthy();
    expect(screen.getByText('Queued. The session is stopped and gets this when it resumes.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take back' }));
    expect(onRetract).toHaveBeenCalledWith('page-1601a001');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onDraft).toHaveLastReturnedWith({ revision: 1, picks: queued.picks, text: queued.text, images: [], replaces: 'page-1601a001' });
    cleanup();
    card({ ...CLASH, queued }, { draft: { ...draft(1, { picks: ['Keep the longer route'] }), replaces: 'page-1601a001' } });
    expect(option('Keep the longer route').getAttribute('aria-checked')).toBe('true');
  });

  it('shows the focused option’s preview, else the picked one’s, else the recommended one’s', () => {
    const preview = () => document.querySelector('[data-sheet-preview]')?.getAttribute('data-sheet-preview');
    card(CLASH);
    expect(preview()).toBe('Keep the earlier sailing');
    fireEvent.focus(option('Keep the longer route'));
    expect(preview()).toBe('Keep the longer route');
    fireEvent.blur(option('Keep the longer route'));
    expect(preview()).toBe('Keep the earlier sailing');
    cleanup();
    card(CLASH, { draft: draft(1, { picks: ['Keep the longer route'] }) });
    expect(preview()).toBe('Keep the longer route');
  });

  it('opens a reference when its context links to it', async () => {
    const host = fixtureHost({ body: () => Promise.resolve({ kind: 'text', text: 'x\n' }) });
    card(SEASON, { host });
    expect(screen.getByRole('button', { name: /src\/auth\.ts/ }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByText('the auth notes'));
    await waitFor(() => expect(screen.getByRole('button', { name: /src\/auth\.ts/ }).getAttribute('aria-expanded')).toBe('true'));
  });

  it('takes no image without the host’s saveImage, and saves a pasted one through it', async () => {
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
    const plain = card(SEASON);
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [image], types: ['Files'] } });
    await Promise.resolve();
    expect(plain.onAttach).not.toHaveBeenCalled();
    cleanup();
    const host = fixtureHost({ saveImage: true });
    const saving = card(SEASON, { host });
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [image], types: ['Files'] } });
    await waitFor(() => expect(saving.onAttach).toHaveBeenLastCalledWith('uploads/maws-fixture-1.png'));
    expect(saving.onDraft).not.toHaveBeenCalled(); // the image joins the draft as it is when saved: the consumer's to do
    expect(host.images.map((saved) => saved.mediaType)).toEqual(['image/png']);
  });

  it('keeps every image of one paste', async () => {
    const shot = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
    const { onAttach } = card(SEASON, { host: fixtureHost({ saveImage: true }) });
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [shot('a.png'), shot('b.png')], types: ['Files'] } });
    await waitFor(() => expect(onAttach.mock.calls).toEqual([['uploads/maws-fixture-1.png'], ['uploads/maws-fixture-2.png']]));
  });

  it('hands back each edit as an update of the draft as it stands, so an image that landed since stays', () => {
    const { onDraft } = card(SEASON, { draft: draft(1, { text: 'From 1' }) });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'From 1 November.' } });
    const update = onDraft.mock.calls.at(-1)![0];
    expect(update(draft(1, { text: 'From 1', images: ['uploads/maws-late.png'] }))).toEqual(draft(1, { text: 'From 1 November.', images: ['uploads/maws-late.png'] }));
  });

  it('leaves untouched a draft newer than its own question: an edit from a card behind a rewrite', () => {
    const { onDraft } = card(CLASH);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Typed on the older card.' } });
    const newer = draft(2, { picks: ['Keep the shuttle on Sundays'] }); // a pick only revision 2 offers
    expect(onDraft.mock.calls.at(-1)![0](newer)).toBe(newer);
  });

  it('takes nothing while an act on it is in flight', () => {
    const { onDraft } = card(CLASH, { busy: true });
    fireEvent.click(option('Keep the longer route'));
    expect(onDraft).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps two references that share a hash apart, each opened on its own', () => {
    const twin = { ...SEASON.references[0], path: 'src/auth-copy.ts', abs: '/work/harbour/src/auth-copy.ts' };
    card({ ...SEASON, references: [SEASON.references[0], twin] });
    fireEvent.click(screen.getByRole('button', { name: /src\/auth-copy\.ts/ }));
    expect(screen.getByRole('button', { name: /src\/auth-copy\.ts/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /src\/auth\.ts/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('never shows an earlier capture’s body for a rewrite that captured the same path again', async () => {
    const bodies = new Map<string, (text: string) => void>();
    const host = fixtureHost({ body: (_session, of) => new Promise((resolve) => bodies.set('ref' in of ? of.ref : '', (text) => resolve({ kind: 'text', text }))) });
    const view = card(SEASON, { host });
    fireEvent.click(screen.getByRole('button', { name: /src\/auth\.ts/ }));
    await waitFor(() => expect(bodies.size).toBe(1));
    await act(async () => bodies.get(SEASON.references[0].sha256)!('the earlier capture\n'));
    expect(screen.getByText('the earlier capture')).toBeTruthy();
    const recaptured = { ...SEASON, revision: 2, references: [{ ...SEASON.references[0], sha256: 'd'.repeat(64) }] };
    view.rerender(<QuestionCard session={SESSION} question={recaptured} draft={undefined} mark="none" busy={false} host={host} onDraft={vi.fn()} onDismiss={vi.fn()} onRetract={vi.fn()} onAttach={vi.fn()} />);
    expect(screen.queryByText('the earlier capture')).toBeNull();
    expect(screen.getByText('Loading…')).toBeTruthy();
    await waitFor(() => expect(bodies.has('d'.repeat(64))).toBe(true));
  });

  it('turns its chevron in compact form: the chevron is the fold button’s own child', () => {
    card(FIXTURE, { density: 'compact' });
    const line = screen.getByRole('button', { name: /q7/ });
    expect(line.querySelector(':scope > .transcript-chevron')).not.toBeNull();
  });

  it("measures the preview's breakpoint on the card's own width: its container has no padding or border of its own", () => {
    const { container } = card(CLASH);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className.split(' ')).toContain('@container');
    expect(root.className).not.toMatch(/(^|\s)(p|px|py|border)(-|\s|$)/);
  });

  it('is folded to its row line in compact form until chosen', () => {
    card(FIXTURE, { density: 'compact' });
    const line = screen.getByRole('button', { name: /q7/ });
    expect(line.getAttribute('aria-expanded')).toBe('false');
    expect(within(line).getByText('May I replace it with this season’s sailings?')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(line);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });
});
